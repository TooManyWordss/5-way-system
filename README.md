# Café Ambiente – 5 Way System

A POS, a live kitchen display and an admin panel that share one backend, themed for Café Ambiente.

```
POS (iPad) ──POST /api/orders──▶ server ──saves to SQLite──▶ broadcasts over Socket.IO
                                                              ├─▶ Kitchen display (ticket queue + chime)
                                                              └─▶ Admin panel (sales + receipts)
```

## What each screen does

- **POS** (cashier, iPad): search the menu, cash-only checkout in pesos with quick ₱1–₱1,000 buttons and change due, works offline. **Receipts** tab: edit or void today's receipts (the cashier is told what to give back or collect). **Today** tab: today's sales, receipts, voids and items sold. Staff can propose new menu items. **Availability** (next to the menu search, on the POS and Barista screens): tap items to mark them unavailable (sold out) or available again; every till updates at once, unavailable items are greyed out and can't be rung up, and tapping one offers to make it available.
- **Barista** (coffee bar, its own tablet): the same till as the POS, kept separate. Its receipts are numbered B-0001, B-0002… (the cashier keeps 1001, 1002…), print with the bar's own title, a large order number to call out, and their own closing lines. The barista's Receipts and Today tabs show only the bar's sales, and each till can only edit or void its own receipts. The owner sees both in the admin panel, with bar receipts tagged *barista*.
- **Inventory** (`/inventory`, its own screen and login): staff count items, add deliveries and take out what was used or thrown away, and can add new items with a reorder level. Items below their level are shown first, in red.
- **Kitchen**: live tickets with a chime; edited tickets are tagged, voided ones disappear.
- **Admin** (owner): **Inventory** section with a *To buy* list of everything below its reorder level, a live alert (and a phone/desktop notification if alerts are on) the moment an item drops below it, editable reorder levels, and recent stock changes; any day's sales, receipts (with void reasons and edit history) and activity log; daily performance for the last 30 days; approves new menu items.

Cashiers only see and change today. Every void, edit and menu decision is written to the activity log.

## Run it

```bash
npm install
cp .env.example .env   # then fill in the PINs, admin password and session secret
npm run dev            # React/Vite at http://localhost:5173, API server at :3000
```

The frontend is React + TypeScript and builds to `dist/`. For a production-style local run, use `npm run build` followed by `npm start`. The backend continues to serve the same role routes and API. The Café Ambiente menu is defined in `menu-catalog.js`. On first startup with this version, the server retires the old choices and adds the new ones while retaining past sales and receipts. Menu items are text-only.

The server prints the addresses to use, for example `http://192.168.1.20:3000`.

| Screen | URL | Login |
|---|---|---|
| POS | `/pos` | `POS_PIN` |
| Barista | `/barista` | `BARISTA_PIN` |
| Inventory | `/inventory` | `INVENTORY_PIN` |
| Kitchen display | `/kitchen` | `KITCHEN_PIN` |
| Admin panel | `/admin` | `ADMIN_PASSWORD` (also opens the other two) |

## Deploy to Railway (so the owner can check sales from anywhere)

The Hobby plan is about $5/month. The database lives on a Railway volume, so sales survive redeploys.

1. Create an account at [railway.com](https://railway.com) and install the CLI: `npm install -g @railway/cli`
2. From this folder:
   ```bash
   railway login
   railway init        # creates a new project
   railway up          # uploads and starts the app (.env and data.db are not uploaded)
   ```
3. In the Railway dashboard, open the service:
   - **Volumes** → add a volume mounted at `/data`.
   - **Variables** → add these:

     | Variable | Value |
     |---|---|
     | `POS_PIN`, `KITCHEN_PIN`, `ADMIN_PASSWORD`, `SESSION_SECRET` | same as your `.env`, or new ones |
     | `DATA_DIR` | `/data` |
     | `TRUST_PROXY` | `1` |
     | `TZ` | the restaurant's time zone, e.g. `Asia/Manila` (otherwise "today" follows UTC) |
     | `TAX_RATE` | e.g. `0.12`, if you charge tax |

   - **Settings → Networking → Generate Domain** gives you an `https://….up.railway.app` address.
4. Open that address on each device (see below). After code changes, run `railway up` again.

### When the restaurant's internet drops

- **POS:** keeps working. Sales are saved on the iPad and sent automatically when the connection returns, keeping the time they were rung up. A yellow note shows how many are waiting. The POS also opens without internet once it has been opened online at least once.
- **Kitchen:** shows a red "Connection lost" bar and gets no new tickets. Cashiers should tell the kitchen orders directly until it clears. Saved orders appear on the kitchen screen when the connection returns.
- **Admin:** shows offline sales once the iPad sends them.

Don't clear Safari's website data on the POS iPad while sales are waiting to send. They are stored there.

## Setting up the devices

**POS iPad**
1. In Safari, open `http://<server address>:3000/pos` and enter the POS PIN.
2. Share → **Add to Home Screen**. Open it from the home screen icon to get full screen with no browser bars.
3. Optional: Settings → Accessibility → **Guided Access** locks the iPad to the POS app.

**Kitchen screen** (tablet, or a TV with a small computer or streaming stick running a browser)
1. Open `/kitchen`, enter the kitchen PIN and tap **Tap to start**. The tap turns on the new-order chime.
2. Set the device's auto-lock or sleep to **Never**. Once hosted on Railway (HTTPS), the page also keeps the screen awake itself.
3. A red bar appears across the top if the connection drops.

**Admin**
Open `/admin` on a phone or laptop and log in with the admin password. The login lasts 7 days.

## Seasonal events (Admin → Performance)

**Full calendar** (next to Week / Month / Year) shows every day of the year, shaded by sales, with the event marks below. Tap a day for its numbers, tap again to open it; tap a month name to open that month.

The performance calendar marks events and shows how each one sold: sales per day, against the 28 normal days before it, and against the same event last year.

- **★ Iligan City** (listed first): Charter Day (Jun 16), Diyandi Festival season (Sep 1–28), Fiesta Señor San Miguel (Sep 29).
- **● Philippines**: national holidays plus occasions that change spending: Valentine's, Holy Week, Mother's/Father's Day, Undas, Simbang Gabi, Christmas, New Year's Eve, and Ramadan, Eid'l Fitr, Eid'l Adha and Chinese New Year (moon-based, marked ≈, built in for 2024–2028).
- Paydays (15th and month-end) are compared with other days in the summary.

Dates that move each year (fiesta programme, Eid, school terms at MSU-IIT, concerts) can be corrected: **Hide** the built-in one and **Add an event** with the exact dates. Built-in events live in `events.js`.

## Staff sign-in with Face ID, Touch ID or fingerprint

Each cashier and kitchen worker can sign in as themselves, so every sale, edit and void records who did it (shown in the admin activity log, receipt details and on printed receipts). The face or fingerprint never leaves the device; the server stores only a public key (a "passkey").

**Works only on the HTTPS address** (your Railway link) or `localhost`. Browsers block it on `http://192.168…`. Passkeys belong to one address, so set them up on the address you'll keep using.

1. **Admin → Staff & sign-in → Add** a person and choose Cashier or Kitchen. A one-time 8-digit setup code appears (valid 15 minutes).
2. On the tablet, open the login page → **First time on this device? Set it up** → type the code → Face ID / fingerprint. They're signed in.
3. From then on: **Sign in with Face ID / fingerprint**. Staff sign-ins last one shift (16 hours); the POS **Switch** button hands over to the next cashier.
4. Once everyone is set up, untick **Allow the shared POS PIN** (and kitchen). The owner password always works on every screen.
5. The owner can add Face ID / Touch ID for the admin panel with **Set up Face ID / Touch ID on this device**.

Removing a staff member signs them out everywhere straight away.

> On a shared iPad, Face ID / Touch ID accepts any face or finger enrolled in *that iPad's* settings. Touch ID holds up to 5 fingers, so each cashier can add their own finger in iPad Settings. For strict one-person-one-key, give each person a fingerprint security key (e.g. YubiKey Bio) or let them sign in from their own phone.

## Settings (`.env`)

| Setting | Purpose |
|---|---|
| `POS_PIN`, `KITCHEN_PIN`, `ADMIN_PASSWORD` | Codes for each screen |
| `SESSION_SECRET` | Signs logins. Changing it logs every device out. |
| `TAX_RATE` | e.g. `0.12` for 12% |
| `TZ` | Time zone that decides when "today" starts, `Asia/Manila` |
| `PORT` | Default `3000` |
| `TRUST_PROXY` | Set to `1` only when hosted behind an HTTPS proxy |
| `RECEIPT_NAME`, `RECEIPT_HEADER`, `RECEIPT_FOOTER` | Printed receipt text; separate lines with `|` |
| `BARISTA_PIN`, `INVENTORY_PIN` | Codes for the barista bar and the inventory screen (optional) |
| `BARISTA_RECEIPT_TITLE`, `BARISTA_RECEIPT_HEADER`, `BARISTA_RECEIPT_FOOTER` | The barista bar's receipt text |
| `RP_ID`, `RP_ORIGIN` | Optional: the address passkeys belong to, if it differs from the one the browser uses |

Branding: the logo files are in `public/brand/` (`logo.png` full logo, `mark.png` round emblem, app icons), colours are the variables at the top of `public/style.css`, fonts are Cinzel and Nunito in `public/fonts/` (SIL Open Font License).

Currency is pesos (₱): `CURRENCY` at the top of `public/common.js` and the `CURRENCY` variable on the server. The menu is seeded in `server.js` on the first run; delete `data.db` to re-seed it.

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).
