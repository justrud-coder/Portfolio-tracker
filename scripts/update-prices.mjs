// Fetch web prices for every "yahoo" holding and write them to the Holdings tab.
// Run by the daily GitHub Action; also runnable locally with `npm run update-prices`.
// No dependencies: the service-account token is signed with Node's crypto.
import { createSign } from "node:crypto";
import { fetchQuotes, priceUpdates } from "./prices.mjs";

// The "Portfolio tracker" sheet. Override with the SHEET_ID environment variable.
const DEFAULT_SHEET_ID = "1TtvBSaAhSnduHRo9hwwuhxKZTLcPnm2EqHr76pMd0vM";
const TAB = "Holdings";

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

const b64url = (b) => Buffer.from(b).toString("base64url");

async function accessToken() {
  const email = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const key = env("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n");
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

async function main() {
  const sheetId = process.env.SHEET_ID || DEFAULT_SHEET_ID;
  const token = await accessToken();
  const api = async (path, init = {}) => {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Google Sheets API ${res.status}: ${await res.text()}`);
    return res.json();
  };

  const { values: grid = [] } = await api(`/values/${encodeURIComponent(`${TAB}!A1:Z300`)}?valueRenderOption=UNFORMATTED_VALUE`);
  const header = (grid[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const si = header.indexOf("symbol");
  const pi = header.indexOf("price source");
  const symbols = [...new Set(grid.slice(1).filter((r) => String(r[pi] ?? "").trim().toLowerCase() === "yahoo").map((r) => String(r[si]).trim()))].filter(Boolean);
  if (!symbols.length) {
    console.log('No holdings with price source "yahoo". Nothing to do.');
    return;
  }

  const { quotes, errors } = await fetchQuotes(symbols);
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
