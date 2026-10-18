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
     | `TZ` | the restaurant's time zone, e.g. `Asia/Manila` (defaults to `Asia/Manila`) |
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

To change a shared screen PIN, open that store's **Admin → Staff & sign-in → Shared PINs**, then choose **Set PIN** or **Change PIN** beside POS, Barista, Kitchen, or Inventory. Enter and confirm a 4–12 digit PIN. The new PIN works for the next sign-in; the previous PIN stops working for new sign-ins. Each store keeps its PINs in its own database, so later changes do not require editing `.env` or restarting the server. The `.env` PINs supply the initial values until the owner sets replacements here. Existing signed-in devices keep their current sessions.

Removing a staff member signs them out everywhere straight away.

> On a shared iPad, Face ID / Touch ID accepts any face or finger enrolled in *that iPad's* settings. Touch ID holds up to 5 fingers, so each cashier can add their own finger in iPad Settings. For strict one-person-one-key, give each person a fingerprint security key (e.g. YubiKey Bio) or let them sign in from their own phone.

## Settings (`.env`)

| Setting | Purpose |
|---|---|
| `POS_PIN`, `KITCHEN_PIN`, `ADMIN_PASSWORD` | Initial screen PINs and owner password; staff PINs can later be changed in Admin |
| `SESSION_SECRET` | Signs logins. Changing it logs every device out. |
| `TAX_RATE` | e.g. `0.12` for 12% |
| `TZ` | Time zone that decides when "today" starts, `Asia/Manila` |
| `PORT` | Default `3000` |
| `TRUST_PROXY` | Set to `1` only when hosted behind an HTTPS proxy |
| `RECEIPT_NAME`, `RECEIPT_HEADER`, `RECEIPT_FOOTER` | Printed receipt text; separate lines with `|` |
| `BARISTA_PIN`, `INVENTORY_PIN` | Codes for the barista bar and the inventory screen (optional) |
| `BARISTA_RECEIPT_TITLE`, `BARISTA_RECEIPT_HEADER`, `BARISTA_RECEIPT_FOOTER` | The barista bar's receipt text |
| `RP_ID`, `RP_ORIGIN` | Optional: the address passkeys belong to, if it differs from the one the browser uses |

Branding: the app uses the images in `client/public/brand/` for Ambiente and `client/public/brands/rairock/` for RaiRock. The colors are in `client/src/styles.css`; fonts are in `client/public/fonts/` (SIL Open Font License).

Currency is pesos (₱): the React client formats PHP and the server uses `CURRENCY`. Ambiente's menu is seeded from `menu-catalog.js`; RaiRock starts empty. Keep `data.db` and `rairock.db` backed up because they contain sales and store settings.

Requires Node.js 22.13 or newer (uses the built-in `node:sqlite`).

## Café Ambiente table service

**Admin → Table service → Manage tables** adds named tables and makes unused tables inactive. **POS → Tables** seats a party, records its guest count and optional alias/VIP/repeat-guest flags, and opens an unpaid tab. Send each new order to the kitchen immediately; extra quantities go into a new submission so they keep their own queue position. Sent lines can be reduced, removed, or given updated preparation notes. Existing names and prices stay on those lines after menu edits.

The kitchen combines table and counter tickets in submission-time order. Staff can start a ticket, mark individual quantities ready, or choose **Order Ready**. Changes and cancellations remain visible until acknowledged. The POS shows readiness without requiring payment first.

Use **Start eating**, **Finish eating**, and **Request bill** to record service milestones. Settle the whole visit in cash, then **Release table**. A cancelled visit also permits release and keeps its cancellation reason. Split bills, merged tables, table transfers, recipe deductions, and reusable customer profiles are not included.

Manual discounts are available on Ambiente table bills and counter sales. Choose a percentage or fixed peso amount, give a reason, and optionally label it PWD or Senior. Percentages apply to the subtotal; tax applies after the discount. Labels do not automatically calculate statutory discounts or VAT exemptions. Receipts retain the subtotal, discount, tax, and cash/change breakdown. Barista keeps its own counter receipts and numbering; RaiRock retains its existing workflow.

**Admin → Overview** is the café KPI dashboard. Today's trading cards combine table, counter, and Barista receipts, with hourly sales, best sellers, unpaid tabs, live table occupancy, kitchen workload, and low-stock alerts. Revenue is not profit: ingredient costs and expenses are not tracked. Live panels refresh every minute and on table updates; offline activity appears after synchronization.

The sidebar separates **Sales & receipts**, **Trends & events**, **Tables & menu**, **Inventory**, and **Staff & access**. Table-service performance has Today, Last 7 days, Last 30 days, and custom ranges up to 366 days; comparisons use the preceding period of equal length. Visits are grouped by arrival date in Asia/Manila; net sales exclude discounts and tax, and cancelled/refunded visits are excluded. Duration averages show complete sample counts. Older backend responses remain usable, with unavailable comparisons labeled; restart the backend after updating to enable the latest report fields. Screen errors show a recovery message instead of a blank page.

### Offline work and conflict review

Use the production build (`npm run build`, then `npm start`) for offline reloads. Open each screen online once on HTTPS (or localhost) so its app files, session, menu, and table snapshot are cached. Every POS can then seat guests, send orders, record milestones, and collect cash offline. The kitchen can mark cached tickets ready offline too. IndexedDB retains queued operations, drafts, and provisional bills across reloads. **Unsynced actions** shows their original contents and recorded cash. Do not clear browser site data while operations are waiting.

Disconnected devices cannot deliver orders to another kitchen device: tell the kitchen orders and changes directly. The app synchronizes automatically on reconnect, with a **Sync now** button for manual retries. Final receipt numbers appear after server acceptance. Retrying an interrupted payment response does not create another sale.

Competing seating, edits, or payments are kept for **Admin → Table service → Offline conflicts**. Review the device record beside the current server record, assign a competing party to an available table when needed, then apply or dismiss the action. Resolve seating before its dependent order/events/payment. Retried menu submissions use current menu details; payment retries use the current bill and retain recorded cash. Record any actual cash collection/refund as a signed cash correction and explain it in the resolution note. Dismissing an operation preserves it and its resolution in history. An unaffordable payment cannot be forced through: account for its cash and enter a corrected payment.

### Undo

Order drafts and party forms have draft undo; existing forms also offer field undo. **Saved actions and Undo** lists reversible table, kitchen, stock, menu, and counter actions. A recent counter/stock action also exposes **Undo saved action**. Saved undo requires a connection, checks the actor's permissions and later changes, and writes a compensating audit entry. Stock reversals add inventory ledger entries. Sale/settlement reversals void the retained receipt and state the cash to return. After refunding a table settlement, release the refunded visit and open a new visit if another bill is needed. Authentication and security changes are outside business undo.

### Validation

```bash
npm test                 # domain/API tests plus existing store/menu/session regressions
npm run typecheck
npm run test:browser     # production build plus real tablet/browser offline tests
```

Browser tests use installed Edge/Chrome on Windows, `PLAYWRIGHT_EXECUTABLE_PATH` when set, or Playwright's Chromium (`npx playwright install chromium`). Tests use temporary databases, never the café's live files. They cover offline reload, a lost payment acknowledgment, offline kitchen readiness, and two offline tablets reconciling separate cash bills. Set `DINING_SCREENSHOT_DIR` to retain review screenshots.

Database changes are additive and applied at startup; existing orders and receipts remain. New authenticated `/api/dining` endpoints provide snapshots, operation sync, service metrics, menu editing, conflict resolution, and compensating undo. Mutable table records carry versions; saved operations require the version they were based on and a unique operation ID. The new table workflow is enabled only for Ambiente.

## Menu descriptions

On the POS and Barista screens, clicking a sellable card adds one item to the order and shows its description attached immediately below it. Holding for 500 ms shows the description without adding. The slightly darker description overlays the following cards without changing grid row heights; the item card retains its existing color. Click outside or press Escape to dismiss. Keyboard Enter or Space performs the same action as clicking. Unavailable and pending items can be inspected but cannot be added. In Availability mode, tapping changes availability and holding shows the description.

All 218 supplied Ambiente options have descriptions in `menu-descriptions.js`, shared across sizes through `menu-catalog.js`. The API supplies the descriptions, and the client also bundles the same catalog to fill descriptions missing from older API responses and offline caches. Lookup normalizes case, whitespace and size suffixes while keeping each category distinct and restricting catalog enrichment to Ambiente. Existing receipts, menu IDs and prices are unaffected by description lookup. Unrecognized custom items display their actual name and category instead of an invented recipe.

Research checked October 17, 2026, including individual searches for all 163 distinct category/item entries (218 size and price options): the International Bartenders Association's [Espresso Martini](https://iba-world.com/iba-cocktail/espresso-martini/), [Cosmopolitan](https://iba-world.com/iba-cocktail/cosmopolitan/), [Whiskey Sour](https://iba-world.com/iba-cocktail/whiskey-sour/) and [Margarita](https://iba-world.com/iba-cocktail/margarita/) recipes; Panlasang Pinoy's [inasal](https://panlasangpinoy.com/grilled-chicken-inasal-recipe/), [kare-kare](https://panlasangpinoy.com/kare-kare-recipe/) and [camaron rebosado](https://panlasangpinoy.com/seafood-fried-shrimp-camaron-rebosado-recipe/); Good Food's [puttanesca](https://www.bbcgoodfood.com/recipes/spaghetti-puttanesca); and linked producer references for selected wines and whiskies. Descriptions are original summaries of named ingredients, standard styles or identified products, not verified restaurant recipe cards. No public ingredient specification was established for house names such as Velvet Dreams, Fiesta Strips or Ambiente Supreme Cake. Those entries explicitly request staff confirmation rather than assigning invented flavors. Incomplete wine labels likewise require checking the actual bottle. Ingredient descriptions are not an allergen declaration.

## RaiRock Seafoods (second store)

One server and codebase now serve two separate stores. Café Ambiente keeps its existing
`data.db` and URLs (`/pos`, `/barista`, `/kitchen`, `/inventory`, `/admin`). RaiRock uses
`rairock.db` and `/rairock/pos`, `/rairock/barista`, `/rairock/kitchen`,
`/rairock/inventory`, `/rairock/admin`. Each store has its own menu, orders, receipt
numbers, kitchen tickets, inventory, staff, passkeys, sign-in settings and live updates.
The two sessions can coexist in one browser. The Ambiente admin shows today's sales
for both stores at the top and links to each store's detailed admin screen.

RaiRock starts with an empty menu. The owner can sign in to `/rairock/admin`, then
open `/rairock/pos` and add menu items; owner additions are approved immediately.
The supplied RaiRock logo and storefront photo are in `client/public/brands/rairock/`.
Its colors are defined under `html[data-store="rairock"]` in `client/src/styles.css`.
Set `RAIROCK_POS_PIN`, `RAIROCK_BARISTA_PIN`, `RAIROCK_KITCHEN_PIN`, and
`RAIROCK_INVENTORY_PIN` in `.env` for separate initial device codes, or set them from RaiRock's admin screen. If omitted, they start with
the corresponding Ambiente codes. `RAIROCK_ADMIN_PASSWORD` optionally overrides
the shared owner password. Receipt header and footer can also be set with
`RAIROCK_RECEIPT_HEADER` and `RAIROCK_RECEIPT_FOOTER`.

Printing still uses the device's browser print screen. Automatic printer and cash
drawer control needs the selected POS device, printer, and drawer models before a
compatible connection can be built and tested.
