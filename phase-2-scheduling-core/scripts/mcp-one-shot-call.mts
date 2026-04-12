/**
 * Invoke one MCP tool against advisor-mcp-server.ts and print structured JSON to stdout.
 * Used by the optional Python FastMCP bridge (`fastmcp_server/`).
 *
 * Usage: npx tsx scripts/mcp-one-shot-call.mts <toolName> '{"arg":"value"}'
 */
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const phase2Root = path.resolve(__dirname, "..");
const entry = path.join(phase2Root, "mcp/advisor-mcp-server.ts");

async function main() {
  const tool = process.argv[2];
  const argsJson = process.argv[3] ?? "{}";
  if (!tool) {
    console.error("Usage: mcp-one-shot-call.mts <tool> [args-json]");
    process.exit(2);
  }
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>;
  } catch {
    console.error("Invalid JSON args");
    process.exit(2);
  }

  const client = new Client({ name: "mcp-one-shot", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["--yes", "tsx", entry],
    cwd: phase2Root,
    env: Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    ),
    stderr: "inherit",
  });
  await client.connect(transport);
  const result = (await client.callTool({
    name: tool,
    arguments: args,
  })) as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text?: string }[];
    isError?: boolean;
  };

  let payload: Record<string, unknown>;
  if (result.structuredContent && typeof result.structuredContent === "object") {
    payload = result.structuredContent;
  } else {
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (text) {
      try {
        payload = JSON.parse(text) as Record<string, unknown>;
      } catch {
        payload = { ok: false, error: "Invalid MCP JSON", raw: text };
      }
    } else {
      payload = { ok: false, error: "Empty MCP tool result" };
    }
  }

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
