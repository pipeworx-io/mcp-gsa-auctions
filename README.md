# mcp-gsa-auctions

GSA Auctions API MCP — US federal government surplus auctions (keyed).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `gsa_search_auctions` | Search current US federal government surplus auctions from GSA Auctions (api.data.gov). GSA Auctions sells government surplus to the public — vehicles, machinery, aircraft, vessels, industrial equipment, electronics, etc. Filter active lots by property state (2-letter, e.g. "TX"), a free-text keyword matched against the item name (e.g. "truck", "forklift", "boat"), and/or auction status. Returns each lot with sale/lot number, item name, property location, sale location, start/end dates, status, high bid, reserve, number of bidders, item and image URLs. NOTE: the upstream API has no server-side category filter — use the keyword argument to narrow by item type. |
| `gsa_auction_lot` | Full detail for a single GSA Auctions lot, identified by its sale number and lot number. Returns everything the auction listing carries: item name, per-lot descriptions (LotInfo), property and sale locations, start/end dates, status, high bid, reserve, bid increment, bidder count, inspection instructions, contracting-officer contact, agency/bureau, and item/image URLs. |
| `gsa_auctions_closing_soon` | Current GSA Auctions federal surplus lots that are ending soonest — active auctions sorted by auction end date ascending. Use to find last-chance bidding opportunities across all agencies and property types. Returns sale/lot number, item name, location, end date, status, high bid, and reserve. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "gsa-auctions": {
      "url": "https://gateway.pipeworx.io/gsa-auctions/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/gsa-auctions/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Gsa Auctions data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
