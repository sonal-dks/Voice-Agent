import path from "path";
import { fileURLToPath } from "url";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

// `.env` lives in the same directory as this config (repo root).
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
loadEnvConfig(repoRoot, process.env.NODE_ENV !== "production");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
