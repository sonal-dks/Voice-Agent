import { loadEnvConfig } from "@next/env";

let loaded = false;

/**
 * Merge repository-root `.env` into `process.env`.
 * `next.config.mjs` already calls `loadEnvConfig` at startup, but API route workers
 * may not inherit that — this keeps `GROQ_API_KEY` and other root vars available.
 *
 * The Next app now lives at the repo root, so `process.cwd()` IS the `.env` directory.
 */
export function loadRepoRootEnv(): void {
  if (loaded) return;
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
  loaded = true;
}
