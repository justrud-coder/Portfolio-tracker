// Fetch web prices for every "yahoo" or "artea" holding and write them to the Holdings tab.
// Run by the daily GitHub Action; also runnable locally with `npm run update-prices`.
// No dependencies: the service-account token is signed with Node's crypto.
import { createSign } from "node:crypto";
import { PRICED_SOURCES, fetchQuotes, plausible, priceUpdates } from "./prices.mjs";

// The "Portfolio tracker" sheet. Override with the SHEET_ID environment variable.
export const DEFAULT_SHEET_ID = "1TtvBSaAhSnduHRo9hwwuhxKZTLcPnm2EqHr76pMd0vM";
const TAB = "Holdings";

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/**
 * Accept the key however it was pasted into the secret: the bare PEM, the PEM
 * with literal "\n" sequences, wrapped in quotes, the whole `"private_key": "...",`
 * line, or the entire JSON key file.
 */
export function credentials(emailRaw, keyRaw) {
  let email = String(emailRaw).trim().replace(/^"|",?$/g, "");
  let key = String(keyRaw).trim();
  if (key.startsWith("{")) {
    try {
      const json = JSON.parse(key);
      key = json.private_key ?? key;
      email = json.client_email ?? email;
    } catch {}
  }
  const m = key.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/);
  if (!m) throw new Error("GOOGLE_PRIVATE_KEY doesn't contain a -----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY----- block");
  const body = m[0]
    .replace(/\\n/g, "\n")
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "")
    .replace(/[^A-Za-z0-9+/=]/g, "");
  key = `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { email, key };
}

const b64url = (b) => Buffer.from(b).toString("base64url");

async function accessToken() {
  const { email, key } = credentials(env("GOOGLE_SERVICE_ACCOUNT_EMAIL"), env("GOOGLE_PRIVATE_KEY"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: email,
      scope: "https://www.googleapis.com/auth/spreadsheets",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

/** Sign in as the service account and return a small Sheets API caller. */
export async function sheetsClient(sheetId) {
  const token = await accessToken();
  return async (path, init = {}) => {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${await res.text()}`);
    return res.json();
  };
}

async function main() {
  const api = await sheetsClient(process.env.SHEET_ID || DEFAULT_SHEET_ID);

  const { values: grid = [] } = await api(`/values/${encodeURIComponent(`${TAB}!A1:Z300`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const header = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const si = header.indexOf("symbol");
  const pi = header.indexOf("price source");
  const lpi = header.indexOf("last price");
  const priced = grid.slice(1).filter((r) => PRICED_SOURCES.includes(String(r[pi] ?? "").trim().toLowerCase()) && String(r[si] ?? "").trim());
  const pairs = [...new Map(priced.map((r) => [String(r[si]).trim(), String(r[pi]).trim().toLowerCase()])).entries()];
  if (!pairs.length) {
    console.log(`No holdings with price source ${PRICED_SOURCES.join(" or ")}. Nothing to do.`);
    return;
  }

  const { quotes, errors } = await fetchQuotes(pairs);
  // Don't write a price that jumped implausibly: the page was probably misread.
  for (const r of priced) {
    const s = String(r[si]).trim();
    if (quotes[s] && !plausible(r[lpi], quotes[s].priceEur)) {
      errors[s] = `fetched ${quotes[s].priceEur} EUR but the sheet has ${r[lpi]}; not written`;
      delete quotes[s];
    }
  }
  for (const [s, q] of Object.entries(quotes)) console.log(`${s}: ${q.priceEur.toFixed(4)} EUR (${q.price} ${q.currency}, ${q.date})`);
  for (const [s, e] of Object.entries(errors)) console.error(`${s}: FAILED – ${e}`);

  const data = priceUpdates(grid, quotes, TAB);
  if (data.length) {
    // USER_ENTERED so the date lands as a real date, not text.
    await api(`/values:batchUpdate`, { method: "POST", body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }) });
    console.log(`Updated ${data.length / 2} price(s) on the ${TAB} tab.`);
  }
  if (Object.keys(errors).length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
