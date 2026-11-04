// Google Sheets REST client using a service account. Shared by the web app and the daily price script.
import { JWT } from "google-auth-library";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let client: JWT | null = null;
function auth(): JWT {
  if (!client) {
    client = new JWT({
      email: env("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      key: env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }
  return client;
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await auth().getAccessToken();
  const res = await fetch(`${API}/${env("SHEET_ID")}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

