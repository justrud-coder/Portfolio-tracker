// Google sign-in (OAuth 2.0 token flow by redirect) and a tiny Sheets API client.
// A redirect is used instead of a popup because popups are unreliable in
// installed phone apps, especially on iPhone.

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const TOKEN_KEY = "pt.token";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export class AuthError extends Error {}

function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function redirectUri() {
  // The app's own URL without query or hash, e.g. https://user.github.io/portfolio-tracker/
  return location.origin + location.pathname.replace(/index\.html$/, "");
}

/** Pick up a token Google sent back in the URL hash. Returns an error message, if any. */
export function handleRedirect() {
  if (!location.hash || location.hash.length < 2) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.has("access_token") && !p.has("error")) return null;
  history.replaceState(null, "", location.pathname + location.search);
  const expected = sessionStorage.getItem("pt.state");
  sessionStorage.removeItem("pt.state");
  if (p.has("error")) return p.get("error") === "access_denied" ? "Sign-in was cancelled." : `Sign-in failed: ${p.get("error")}`;
  if (!expected || p.get("state") !== expected) return "Sign-in failed: the reply didn't match this app. Try again.";
  const granted = (p.get("scope") ?? "").split(" ");
  if (!granted.includes(SCOPE)) return "Google didn't grant access to your sheets. Sign in again and tick the Sheets box.";
  const expiresIn = Number(p.get("expires_in") ?? 3600);
  const token = { value: p.get("access_token"), exp: Date.now() + (expiresIn - 60) * 1000 };
  store()?.setItem(TOKEN_KEY, JSON.stringify(token));
  return null;
}

export function getToken() {
  try {
    const t = JSON.parse(store()?.getItem(TOKEN_KEY) ?? "null");
    return t && t.exp > Date.now() ? t.value : null;
  } catch {
    return null;
  }
}

export function signOut() {
  const t = getToken();
  store()?.removeItem(TOKEN_KEY);
  if (t) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => {});
}

export function signIn(clientId, { hint } = {}) {
  const state = crypto.randomUUID();
  sessionStorage.setItem("pt.state", state);
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: "token",
    scope: SCOPE,
    include_granted_scopes: "true",
    state,
  });
  if (hint) p.set("login_hint", hint);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

export class Sheets {
  constructor(sheetId) {
    this.sheetId = sheetId;
  }

  async call(path, init = {}) {
    const token = getToken();
    if (!token) throw new AuthError("Signed out");
    const res = await fetch(`${API}/${this.sheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      cache: "no-store",
    });
    if (res.status === 401) {
      store()?.removeItem(TOKEN_KEY);
      throw new AuthError("Signed out");
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try {
        msg = (await res.json()).error?.message ?? msg;
      } catch {}
      if (res.status === 403) msg = `No access to the sheet. Sign in with the Google account that owns it. (${msg})`;
      if (res.status === 404) msg = `Sheet not found. Check the sheet ID in config.js. (${msg})`;
      throw new Error(msg);
    }
    return res.json();
  }

  /** Read several ranges at once. Numbers and dates come back as raw numbers. */
  async batchGet(ranges) {
    const q = new URLSearchParams({ valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "SERIAL_NUMBER" });
    ranges.forEach((r) => q.append("ranges", r));
    const data = await this.call(`/values:batchGet?${q}`);
    return (data.valueRanges ?? []).map((v) => v.values ?? []);
  }

  async meta() {
    const data = await this.call(`?fields=properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)`);
    const tabs = {};
    for (const s of data.sheets ?? []) tabs[s.properties.title] = { id: s.properties.sheetId, rows: s.properties.gridProperties.rowCount };
    return { title: data.properties?.title ?? "", tabs };
  }

  /** Make sure a tab has at least `rows` rows. */
  async ensureRows(tab, rows) {
    if (rows <= tab.rows) return;
    await this.call(`:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ requests: [{ appendDimension: { sheetId: tab.id, dimension: "ROWS", length: rows - tab.rows + 50 } }] }),
    });
    tab.rows = rows + 50;
  }

  /** Write cells as if typed (dates in YYYY-MM-DD become dates; numbers stay numbers). */
  async write(data) {
    return this.call(`/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data }),
    });
  }
}
