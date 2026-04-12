import { existsSync } from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";

/**
 * Resolve path to `advisor-mcp-server.ts` (stdio MCP entry).
 * Lives under `phase-2-scheduling-core/mcp/` (this package).
 */
export function resolveAdvisorMcpServerEntry(): string | null {
  const envPath = process.env.MCP_ADVISOR_SERVER_ENTRY?.trim();
  if (envPath && existsSync(envPath)) return envPath;

  const candidates = [
    path.join(process.cwd(), "phase-2-scheduling-core/mcp/advisor-mcp-server.ts"),
    path.join(process.cwd(), "../phase-2-scheduling-core/mcp/advisor-mcp-server.ts"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function schedulingMcpServerAvailable(): boolean {
  return resolveAdvisorMcpServerEntry() !== null;
}

/** Credentials must be present in the parent env for the child MCP process. */
export function schedulingCredentialsPresent(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() &&
      process.env.GOOGLE_CALENDAR_ID?.trim() &&
      process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
  );
}

let clientSingleton: Client | null = null;
let connectPromise: Promise<Client> | null = null;

async function getConnectedClient(): Promise<Client> {
  if (clientSingleton) return clientSingleton;
  if (connectPromise) return connectPromise;

  const entry = resolveAdvisorMcpServerEntry();
  if (!entry) {
    throw new Error(
      "MCP advisor server not found. Set MCP_ADVISOR_SERVER_ENTRY or run from the repo root."
    );
  }

  connectPromise = (async () => {
    const client = new Client({ name: "next-advisor-agent", version: "0.2.0" });
    const env = Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)
    );
    const transport = new StdioClientTransport({
      command: "npx",
      args: ["--yes", "tsx", entry],
      cwd: path.dirname(entry),
      env,
      stderr: "inherit",
    });
    await client.connect(transport);
    clientSingleton = client;
    return client;
  })();

  return connectPromise;
}

function toolResultToRecord(result: unknown): Record<string, unknown> {
  const r = result as {
    isError?: boolean;
    structuredContent?: unknown;
    content?: { type: string; text?: string }[];
  };
  if (r.isError) {
    const text = r.content?.find((c) => c.type === "text")?.text ?? "MCP tool error";
    return { ok: false, error: text };
  }
  if (r.structuredContent && typeof r.structuredContent === "object") {
    return r.structuredContent as Record<string, unknown>;
  }
  const text = r.content?.find((c) => c.type === "text")?.text;
  if (text) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Invalid MCP JSON", raw: text };
    }
  }
  return { ok: false, error: "Empty MCP tool result" };
}

export async function callAdvisorMcpTool(
  name:
    | "offer_slots"
    | "confirm_booking"
    | "submit_pii_booking"
    | "lookup_pii_booking",
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = await getConnectedClient();
  const result = await client.callTool({
    name,
    arguments: args,
  });
  return toolResultToRecord(result);
}
