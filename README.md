# Portfolio tracker

A phone app for the **Portfolio tracker** Google Sheet. It's a PWA: you install it from a web page once, and after that it opens from your home screen like any other app. It talks to Google Sheets directly from the phone, signed in with your own Google account. There is no server, so it works on mobile data and your laptop never has to be on.

- **Overview:** total value, change since the end of last month and since the start of the year, value over time, a share chart by asset class, and every account (tap a holdings account to see its positions).
- **Goals:** the retirement plan from the Retirement tab of the sheet.
- **Retirement:** the plan to retire at a set age on a monthly spend in today's money: the portfolio needed, the monthly investment needed, whether you're ahead, on track or behind, and the monthly spend your portfolio would pay if you retired today. Edit the inputs in the app and they're saved to the Retirement tab of the sheet, which has the same formulas.
- **Rebalance:** set a target mix by asset class (and by ETF within stocks) and see what to buy with the next deposit to move toward it, buy-only by default, or the buys and sells that put everything exactly on target. Targets are saved to a Targets tab in the sheet (Level | Name | Target %), which the app creates on the first save. Real estate and options stay out of the plan unless you give them a target.
- **Savings:** your savings rate per month for the last 12 months: income from the Income tab against what went into your accounts (deposits minus withdrawals, plus III pillar contributions).
- **Transaction:** add a buy, sell, deposit, withdrawal, dividend or fee to the Transactions tab, or your monthly income (net pay, bonus, rent) to the Income tab. The app makes the Income tab the first time you save income.
- **Daily snapshot (automatic):** every evening a GitHub Action saves every active account's current value to the History tab, which feeds the chart and the Last month and This year changes. Run it by hand from the Actions tab ("Daily snapshot" → Run workflow) if you need one sooner.

The sheet stays the source of truth and does all the maths (units, cost basis, monthly totals, goals). The app reads it and appends rows; it never edits formulas.

A daily GitHub Action fetches market prices and writes them to the Holdings tab.

## How it's put together

| Path | What it is |
| --- | --- |
| `app/` | The app itself: plain HTML, CSS and JavaScript modules with no build step. GitHub Pages serves this folder. |
| `app/config.js` | The sheet ID and the Google OAuth client ID. |
| `app/js/model.js` | Reads the tabs by their header names, so moving or adding columns in the sheet doesn't break the app. |
| `app/js/google.js` | Google sign-in and the Sheets API calls. |
| `app/sw.js` | Service worker. It keeps the app on the phone so it opens offline and shows the last loaded numbers. |
| `scripts/update-prices.mjs` | The daily price job. It has no dependencies. |
| `.github/workflows/pages.yml` | Publishes `app/` to GitHub Pages on every push to `main`. |
| `.github/workflows/update-prices.yml` | Runs the price job every weekday at 18:30 UTC. |
| `scripts/snapshot.mjs` | The daily snapshot job. Uses the same service account as the price job. |
| `.github/workflows/daily-snapshot.yml` | Runs the snapshot job at 20:45 UTC every day. |

### Sign-in and privacy

The app's files are public on GitHub Pages, but they hold no data. Your numbers only exist in the Google Sheet, and the app can only read it after you sign in with a Google account the sheet is shared with. The sign-in token stays on the phone for about an hour; after that the app sends you through Google sign-in again, which is usually one tap. The last loaded numbers are kept on the phone so the app opens instantly and works offline.

## Setup

### 1. Turn on GitHub Pages

In this repository, open **Settings → Pages** and set **Source** to **GitHub Actions**. The next push to `main` (or **Actions → Deploy app → Run workflow**) publishes the app at:

```
https://justrud-coder.github.io/Portfolio-tracker/
```

### 2. Create a Google OAuth client ID

This lets the app ask Google for access to your sheets. It takes about five minutes.

1. Open the [Google Cloud console](https://console.cloud.google.com/) and pick a project at the top of the page, or create one (for example, "Portfolio tracker"). You can reuse the project that holds the price job's service account.
2. Go to **APIs & Services → Library**, search for **Google Sheets API**, and click **Enable** (skip this if it's already enabled).
3. Go to **Google Auth Platform → Branding** (in older consoles: **APIs & Services → OAuth consent screen**) and click **Get started**:
   - App name: `Portfolio`, user support email: your Gmail address.
   - Audience: **External**.
   - Contact email: your Gmail address. Agree to the policy and click **Create**.
4. Go to **Audience**. Leave the publishing status as **Testing**, and under **Test users** click **Add users** and add your Gmail address. Only test users can sign in, which is what you want.
5. Go to **Clients → Create client**:
   - Application type: **Web application**, name: `Portfolio app`.
   - **Authorized JavaScript origins:** `https://justrud-coder.github.io`
   - **Authorized redirect URIs:** `https://justrud-coder.github.io/Portfolio-tracker/` (including the slash at the end).
   - Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). You won't need the client secret.
6. Put the client ID in `app/config.js` as `clientId` and push. Or leave it empty: the app asks for it on first launch and keeps it on the phone.

Because the app is in Testing mode and asks for access to your spreadsheets, Google shows a "Google hasn't verified this app" screen the first time. Click **Continue**, since you are the developer. Tick the box for Google Sheets access if Google shows one.

### 3. Install it on the phone

Open `https://justrud-coder.github.io/Portfolio-tracker/` on the phone and sign in.

- **iPhone (Safari):** tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **⋮ → Install app** (or **Add to Home screen**).

### 4. Daily prices

The price job signs in as a Google service account and needs two repository secrets (**Settings → Secrets and variables → Actions → New repository secret**):

| Secret | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the service account's JSON key |
| `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON key, pasted as is |

To create a service account: in the Cloud console go to **IAM & Admin → Service accounts → Create service account**, then **Keys → Add key → JSON**.

Share the **Portfolio tracker** sheet with the service account's email as an **Editor**. The job writes to that sheet by default. To point it somewhere else, set a repository variable `SHEET_ID`.

The job fetches a price for every Holdings row whose **Price source** is `yahoo` (Yahoo Finance, with Stooq as a fallback for `.DE` symbols), converts it to EUR, and writes **Last price** and **Price date**. Run it any time from **Actions → Update prices → Run workflow**.

## Development

```bash
npm test          # unit tests (Node 20+, no install needed)
npm run serve     # serves app/ at http://localhost:8080
```

Google sign-in only works from an origin registered on the OAuth client. To try the app locally, add `http://localhost:8080` as a JavaScript origin and `http://localhost:8080/` as a redirect URI.
