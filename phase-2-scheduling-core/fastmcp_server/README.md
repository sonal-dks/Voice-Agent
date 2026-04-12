# FastMCP bridge (optional)

The **canonical** Phase 2 MCP server is TypeScript: [`../mcp/advisor-mcp-server.ts`](../mcp/advisor-mcp-server.ts), invoked by the Next.js app via [`../mcp-client/schedulingMcpClient.ts`](../mcp-client/schedulingMcpClient.ts).

This directory provides an optional **[FastMCP](https://gofastmcp.com/getting-started/welcome)** stdio server that exposes the **same tool names** (`offer_slots`, `confirm_booking`, `submit_pii_booking`) by delegating each call to the TS stack through [`../scripts/mcp-one-shot-call.mts`](../scripts/mcp-one-shot-call.mts). Use it when a Python MCP host is required; expect higher latency than the direct TS server.

## Prerequisites

- Node.js + `npm` / `npx` on `PATH`
- Dependencies installed under `phase-2-scheduling-core/` (`npm install` in that folder)
- Same Google / Gmail env vars as the TS server (see repo root `.env.example`)

## Run

```bash
cd phase-2-scheduling-core/fastmcp_server
uv sync   # or: pip install -e .
uv run python -m advisor_mcp
```

To point Next at this process instead of TS, set:

`MCP_ADVISOR_SERVER_ENTRY` to the path of a small launcher script that runs `uv run python -m advisor_mcp` from this directory (or use your own wrapper).

**Workspace admin:** ensure the service account has **Gmail** scopes including `gmail.compose` if you use advisor drafts at booking.
