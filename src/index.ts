interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * GSA Auctions API MCP — US federal government surplus auctions (keyed).
 *
 * Wraps the GSA Auctions v2 API on the api.data.gov umbrella:
 *   https://api.gsa.gov/assets/gsaauctions/v2/auctions
 * GSA Auctions sells federal surplus property to the public — vehicles,
 * machinery, aircraft, vessels, industrial equipment, electronics, and more,
 * contributed by every participating agency.
 *
 * Auth: the endpoint requires an api.data.gov key. The Pipeworx gateway injects
 * the platform key as `args._apiKey`; callers may BYO via `?_apiKey=`. The key is
 * sent both as `?api_key=` (api.data.gov umbrella convention) and the `X-Api-Key`
 * header (the upstream OpenAPI scheme). If no key is present, tools return a
 * clear { error } instructing how to supply one.
 *
 * The upstream API is a single GET that returns ALL current auction listings as
 * one array with NO server-side filter params (only `format`). So state / status /
 * keyword filtering, closing-soon sorting, and single-lot lookup are all done
 * client-side over that array. Tools return shaped, LLM-friendly objects and never
 * throw — fetch/parse failures resolve to { error }.
 */


const BASE = 'https://api.gsa.gov/assets/gsaauctions/v2/auctions';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';

const tools: McpToolExport['tools'] = [
  {
    name: 'gsa_search_auctions',
    description:
      'Search current US federal government surplus auctions from GSA Auctions (api.data.gov). GSA Auctions sells government surplus to the public — vehicles, machinery, aircraft, vessels, industrial equipment, electronics, etc. Filter active lots by property state (2-letter, e.g. "TX"), a free-text keyword matched against the item name (e.g. "truck", "forklift", "boat"), and/or auction status. Returns each lot with sale/lot number, item name, property location, sale location, start/end dates, status, high bid, reserve, number of bidders, item and image URLs. NOTE: the upstream API has no server-side category filter — use the keyword argument to narrow by item type.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Filter by 2-letter property state code (e.g. "TX", "CA"). Matches PropertyState.' },
        keyword: { type: 'string', description: 'Free-text keyword matched (case-insensitive) against the item name — use for category/type (e.g. "truck", "forklift", "aircraft", "boat", "generator").' },
        status: { type: 'string', description: 'Filter by AuctionStatus (case-insensitive substring, e.g. "Active", "Open"). Omit to include all statuses.' },
        limit: { type: ['number', 'string'], description: 'Max lots to return (1-200). Default 25.' },
      },
    },
  },
  {
    name: 'gsa_auction_lot',
    description:
      'Full detail for a single GSA Auctions lot, identified by its sale number and lot number. Returns everything the auction listing carries: item name, per-lot descriptions (LotInfo), property and sale locations, start/end dates, status, high bid, reserve, bid increment, bidder count, inspection instructions, contracting-officer contact, agency/bureau, and item/image URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        sale_no: { type: 'string', description: 'The sale number (SaleNo), e.g. "25QSCI21001".' },
        lot_no: { type: ['number', 'string'], description: 'The lot number (LotNo) within that sale, e.g. 1.' },
      },
      required: ['sale_no', 'lot_no'],
    },
  },
  {
    name: 'gsa_auctions_closing_soon',
    description:
      'Current GSA Auctions federal surplus lots that are ending soonest — active auctions sorted by auction end date ascending. Use to find last-chance bidding opportunities across all agencies and property types. Returns sale/lot number, item name, location, end date, status, high bid, and reserve.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: ['number', 'string'], description: 'Max lots to return (1-200). Default 25.' },
      },
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    // Gateway injects the platform api.data.gov key here (or caller BYOs via ?_apiKey=).
    const apiKey = args._apiKey as string | undefined;
    delete args._apiKey;
    if (!apiKey) {
      return {
        error:
          'GSA Auctions requires an api.data.gov key — contact the operator, or BYO via ?_apiKey=<your api.data.gov key> (get one free at https://api.data.gov/signup/).',
      };
    }
    switch (name) {
      case 'gsa_search_auctions':
        return await searchAuctions(args, apiKey);
      case 'gsa_auction_lot':
        return await auctionLot(args, apiKey);
      case 'gsa_auctions_closing_soon':
        return await closingSoon(args, apiKey);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function searchAuctions(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const all = await fetchAuctions(apiKey);
  const state = strArg(args.state)?.toUpperCase();
  const keyword = strArg(args.keyword)?.toLowerCase();
  const status = strArg(args.status)?.toLowerCase();
  const limit = clampLimit(args.limit, 25);

  let lots = all;
  if (state) lots = lots.filter((a) => (a.PropertyState ?? '').toUpperCase() === state);
  if (keyword) lots = lots.filter((a) => (a.ItemName ?? '').toLowerCase().includes(keyword));
  if (status) lots = lots.filter((a) => (a.AuctionStatus ?? '').toLowerCase().includes(status));

  const results = lots.slice(0, limit).map(shapeSummary);
  return {
    total_matched: lots.length,
    returned: results.length,
    filters: { state: state ?? null, keyword: keyword ?? null, status: status ?? null },
    lots: results,
  };
}

async function auctionLot(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const saleNo = strArg(args.sale_no);
  const lotNo = strArg(args.lot_no);
  if (!saleNo || !lotNo) {
    throw new Error('gsa_auction_lot requires "sale_no" (SaleNo) and "lot_no" (LotNo).');
  }
  const all = await fetchAuctions(apiKey);
  const lot = all.find(
    (a) => String(a.SaleNo ?? '') === saleNo && String(a.LotNo ?? '') === lotNo,
  );
  if (!lot) {
    return { error: `No auction lot found for SaleNo "${saleNo}" LotNo "${lotNo}". It may have closed or the identifiers may be wrong.`, sale_no: saleNo, lot_no: lotNo };
  }
  return shapeDetail(lot);
}

async function closingSoon(args: Record<string, unknown>, apiKey: string): Promise<unknown> {
  const all = await fetchAuctions(apiKey);
  const limit = clampLimit(args.limit, 25);
  const active = all.filter((a) => {
    const s = (a.AuctionStatus ?? '').toLowerCase();
    // treat anything not explicitly closed/awarded/sold as active
    return !/(closed|awarded|sold|ended|cancel)/.test(s);
  });
  const sorted = active
    .map((a) => ({ a, ts: parseDate(a.AucEndDt) }))
    .filter((x) => x.ts !== null)
    .sort((x, y) => (x.ts as number) - (y.ts as number))
    .map((x) => x.a);
  const results = sorted.slice(0, limit).map(shapeSummary);
  return { total_active: active.length, returned: results.length, lots: results };
}

interface Auction {
  SaleNo?: string;
  LotNo?: number | string;
  AucStartDt?: string;
  AucEndDt?: string;
  ItemName?: string;
  PropertyAddr1?: string;
  PropertyAddr2?: string;
  PropertyAddr3?: string;
  PropertyCity?: string;
  PropertyState?: string;
  PropertyZip?: string;
  AuctionStatus?: string;
  SaleLocation?: string;
  LocationOrg?: string;
  LocationStAddr?: string;
  LocationCity?: string;
  LocationST?: string;
  LocationZip?: string;
  BiddersCount?: number;
  LotInfo?: { LotSequence?: number; LotDescript?: string }[];
  Instruction1?: string;
  Instruction2?: string;
  Instruction3?: string;
  ContractOfficer?: string;
  COEmail?: string;
  COPhone?: string;
  Reserve?: number;
  AucIncrement?: number;
  HighBidAmount?: string;
  InactivityTime?: number;
  AgencyCode?: string;
  BureauCode?: string;
  AgencyName?: string;
  BureauName?: string;
  ItemDescURL?: string;
  ImageURL?: string;
}

function shapeSummary(a: Auction): Record<string, unknown> {
  return {
    sale_no: a.SaleNo,
    lot_no: a.LotNo,
    item_name: a.ItemName,
    property_location: joinLoc([a.PropertyCity, a.PropertyState, a.PropertyZip]),
    sale_location: a.SaleLocation ?? joinLoc([a.LocationCity, a.LocationST, a.LocationZip]),
    start_date: a.AucStartDt,
    end_date: a.AucEndDt,
    status: a.AuctionStatus,
    high_bid: a.HighBidAmount,
    reserve: a.Reserve,
    bidders_count: a.BiddersCount,
    agency: a.AgencyName,
    item_url: a.ItemDescURL,
    image_url: a.ImageURL,
  };
}

function shapeDetail(a: Auction): Record<string, unknown> {
  return {
    sale_no: a.SaleNo,
    lot_no: a.LotNo,
    item_name: a.ItemName,
    lot_info: (a.LotInfo ?? []).map((l) => ({ sequence: l.LotSequence, description: l.LotDescript })),
    start_date: a.AucStartDt,
    end_date: a.AucEndDt,
    status: a.AuctionStatus,
    high_bid: a.HighBidAmount,
    reserve: a.Reserve,
    bid_increment: a.AucIncrement,
    bidders_count: a.BiddersCount,
    inactivity_time_min: a.InactivityTime,
    property_location: {
      address1: a.PropertyAddr1,
      address2: a.PropertyAddr2,
      address3: a.PropertyAddr3,
      city: a.PropertyCity,
      state: a.PropertyState,
      zip: a.PropertyZip,
    },
    sale_location: {
      name: a.SaleLocation,
      org: a.LocationOrg,
      street: a.LocationStAddr,
      city: a.LocationCity,
      state: a.LocationST,
      zip: a.LocationZip,
    },
    inspection_instructions: [a.Instruction1, a.Instruction2, a.Instruction3].filter(Boolean),
    contracting_officer: { name: a.ContractOfficer, email: a.COEmail, phone: a.COPhone },
    agency: { code: a.AgencyCode, name: a.AgencyName, bureau_code: a.BureauCode, bureau_name: a.BureauName },
    item_url: a.ItemDescURL,
    image_url: a.ImageURL,
  };
}

function joinLoc(parts: (string | undefined)[]): string | undefined {
  const clean = parts.map((p) => (p ?? '').trim()).filter(Boolean);
  return clean.length ? clean.join(', ') : undefined;
}

// Parse GSA date strings (commonly MM/DD/YYYY or ISO) to a comparable timestamp.
function parseDate(v: string | undefined): number | null {
  if (!v) return null;
  const t = Date.parse(v);
  if (!Number.isNaN(t)) return t;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const d = Date.parse(`${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`);
    if (!Number.isNaN(d)) return d;
  }
  return null;
}

async function fetchAuctions(apiKey: string): Promise<Auction[]> {
  const res = await fetch(`${BASE}?api_key=${encodeURIComponent(apiKey)}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA, 'X-Api-Key': apiKey },
  });
  if (!res.ok) {
    const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
    throw new Error(`GSA Auctions API: ${res.status} ${body}`.trim());
  }
  const data = (await res.json()) as { results?: Auction[] } | Auction[];
  const list = Array.isArray(data) ? data : data?.results ?? [];
  return Array.isArray(list) ? list : [];
}

function strArg(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t ? t : undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function clampLimit(v: unknown, def: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
