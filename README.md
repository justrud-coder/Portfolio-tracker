# Portfolio tracker

A small web app for tracking a personal portfolio month by month. The Google Sheet stays the source of truth: the app reads it for the dashboard and writes each monthly snapshot back to it.

- **Dashboard:** total value, change since the last update, year to date and over 12 months, value over time (total or by asset class), allocation, and a positions table.
- **Monthly update:** fetches the latest prices for web-priced holdings, lets you edit units and enter manual values (cash, real estate, options, pension unit price), and saves a new snapshot column to the sheet.

## How the sheet is used

**`Sheet1`** has one row per position and one column per snapshot:

| Column | Content |
| --- | --- |
| B | Position name (`IBKR`, `III pillar`, `Cash`, ...) |
| C | Asset class (`Akcijos`, `NT`, `Crypto`, `Cash`, `II pakopa`; blank is treated as cash) |
| D onward | One snapshot per column, header `Verte` + new line + `YYYY.MM.DD` |

Positions run until the `Viso` (total) row. The rows after it (`Liquid`, `Super liquid`) are summary formulas.

When you save a new month, the app:
1. adds a column after the last snapshot (growing the grid if needed) and copies the previous column's number formats;
2. writes the header and every position's value;
3. copies the summary formulas (`Viso`, `Liquid`, ...) from the previous column, pointing them at the new one;
4. re-points formulas below the summary block (the Split table) that referenced the previous column.

If you save again with the same date, only the position values in that column are overwritten. Dates before the last snapshot are rejected.

**`Holdings`** lists what is inside the positions that can be priced:

| Position | Symbol | Name | Units | Price source | Last price | Currency | Price date |
| --- | --- | --- | --- | --- | --- | --- | --- |
| IBKR | VWCE.DE | Vanguard FTSE All-World | 179 | yahoo | | EUR | |
| IBKR | CASH | Cash held at IBKR | 0 | fixed | 1 | EUR | |
| III pillar | ARTEA-AA16 | Artea Ambicingas Active 16+ | 18763.33 | manual | 0.7034 | EUR | 2026-06-30 |

- `yahoo`: the price is fetched from Yahoo Finance and converted to EUR. Use Yahoo symbols such as `VWCE.DE` or `VHYL.AS`.
- `manual`: you type the unit price on the update screen.
- `fixed`: the price is always `Last price`. Use it for cash, with Units as the amount.

A position's value is the sum of its holdings, unless you press **Override** on the update screen. Positions without holdings are always entered by hand, prefilled with last month's value.

## Setup

### 1. Google service account

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project (or reuse one) and enable the **Google Sheets API**.
2. Under **IAM & Admin → Service accounts**, create a service account. Then under **Keys → Add key → JSON**, download the key file.
3. Open the Google Sheet, click **Share**, and add the service account's email (`...@...iam.gserviceaccount.com`) as an **Editor**.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in:

| Variable | Value |
| --- | --- |
| `SHEET_ID` | The ID from the sheet URL |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key, with the `\n` sequences kept |
| `APP_PASSWORD` | The password you will log in with |
| `PORTFOLIO_SHEET_NAME` | Optional. Defaults to `Sheet1` |

### 3. Run locally

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # unit tests
```

### 4. Deploy to Vercel

1. Import this repository at [vercel.com/new](https://vercel.com/new).
2. Add the environment variables above under **Settings → Environment Variables**. Paste `GOOGLE_PRIVATE_KEY` exactly as it appears in the JSON key.
3. Deploy. Every push to `main` redeploys.
