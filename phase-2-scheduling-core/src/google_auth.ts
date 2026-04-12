import type { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";

import { parseServiceAccountJson } from "./env";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/spreadsheets",
];

/** Narrow type for googleapis factory methods (GoogleAuth#getClient() union is wider than needed). */
export async function getOAuthClient(): Promise<OAuth2Client> {
  const creds = parseServiceAccountJson();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: SCOPES,
  });
  return auth.getClient() as Promise<OAuth2Client>;
}
