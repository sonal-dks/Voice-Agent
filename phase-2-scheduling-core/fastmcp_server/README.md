# FastMCP bridge (optional, Python)

> The **default** scheduling MCP server is **TypeScript**: [`../mcp/advisor-mcp-server.ts`](../mcp/advisor-mcp-server.ts), started by the Next.js app through [`../mcp-client/schedulingMcpClient.ts`](../mcp-client/schedulingMcpClient.ts).

This folder adds an optional **[FastMCP](https://gofastmcp.com/getting-started/welcome)** (Python) stdio server that exposes the **same tool names** (`offer_slots`, `confirm_booking`, `submit_pii_booking`) by forwarding each call to the TypeScript stack via [`../scripts/mcp-one-shot-call.mts`](../scripts/mcp-one-shot-call.mts).

Use it when your environment **must** host MCP in Python. Expect **higher latency** than calling the TS server directly.

## Prerequisites

1. **[Node.js](https://nodejs.org/)** and `npm` / `npx` available on your `PATH` (the bridge shells out to the TS script).
2. Dependencies installed in **`phase-2-scheduling-core/`** (parent folder):

   ```bash
   cd phase-2-scheduling-core
   npm install
   ```

3. The same **Google / Gmail** environment variables as the TS server (see repository root `.env.example`).

4. Python tooling for this package: **[uv](https://docs.astral.sh/uv/)** (recommended) or `pip`.

## Install Python dependencies

From **`phase-2-scheduling-core/fastmcp_server/`**:

```bash
uv sync
```

If you do not use `uv`:

```bash
pip install -e .
```

## Run the FastMCP server

```bash
cd phase-2-scheduling-core/fastmcp_server
uv run python -m advisor_mcp
```

## Point Next.js at this server

Set **`MCP_ADVISOR_SERVER_ENTRY`** in `.env` to a small script that runs the command above from this directory (or your own wrapper that sets `cwd` and env correctly).

## Workspace admin note

If you use **Gmail** drafts at booking time, the Google Workspace admin must grant the service account the right scopes (including **`gmail.compose`**) via domain-wide delegation.

## See also

- Parent overview: [../README.md](../README.md)
