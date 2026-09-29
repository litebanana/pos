# Tindahan

A single-device, offline point of sale for small Philippine stores. React, TypeScript, Vite, Dexie, and jsPDF. Store records and sales analytics stay in IndexedDB; there is no backend, payment processing, external telemetry, or runtime CDN dependency.

## Run and verify

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run build
npm run test:e2e
npm run preview
```

Use the production preview to check installation and offline operation. Development and preview bind to loopback. Serve only `dist/` in production.

## Store workflow

1. Set the store and operator names in Settings. Store details remain saved after closing a day.
2. Check the eight starter products: their barcodes and prices are examples. Replace them with real catalog data before selling, or reset the starter catalog and import your own CSV.
3. Optional: enter stock quantities and low-stock thresholds in Products. Empty stock means inventory is not tracked. Adjust stock records a reason for restocks and corrections.
4. Scan items into the cart using a USB/Bluetooth keyboard scanner with an Enter suffix, manual barcode entry, or Quick add. The cart survives reloads and does not count as revenue yet.
5. Review quantities, choose Checkout, and record cash, GCash, or card payment. Cash checkout calculates change. Verify the payment independently; the app does not process it.
6. Complete the sale. Payment, immutable sale/item snapshots, stock deductions, cart clearing, and activity are committed in one transaction. Duplicate/stale checkouts are rejected.
7. Download or print the receipt. Receipts remain in Sales history. Voids and refunds require a reason; choose returned quantities for a partial refund and whether items should return to stock.
8. Close the day when the cart is empty. Download its report and export a full backup. Daily reports use Philippine time (`Asia/Manila`).

Grouping repeated scans is optional. Product price/name changes create a separate cart row. Rapid quantity buttons apply atomic deltas. Removing a cart row supports undo.

A void applies only to a sale in the current open day and cannot follow a partial refund. Refunds of older sales are recorded in the current day's session, which can have a negative net total. Original closed reports retain their prices, item details, and totals. Repeated partial refunds cannot exceed the original quantities or amount paid. Catalog deletion does not erase receipts; stock cannot be returned to a catalog product that has been deleted or changed its selling unit.

## Store tools

Open **Store tools** in the header for customers and loyalty, saved orders (including split/combine), suppliers and purchases, stock counts/history/valuation, cash shifts, employee PINs/time clocks, sales analytics, and checkout settings. Checkout supports discounts, tax calculation, loyalty redemption, and split cash + GCash/card payments. Products can have costs, independent variants, priced add-ons, and kilogram selling units. Sell includes optional camera scanning and a customer display for another window on the same device. All data stays local. See [FEATURES.md](FEATURES.md) for the complete feature map, workflow rules, integration limits, and upgrade/recovery steps.

## Catalog CSV

Export a CSV from Products to obtain the template:

```csv
barcode,name,price,category,stock,low_stock,cost,variant,modifiers,unit
480000000001,Tea,12.50,Beverages,24,5,8.00,,,
00123,Rice,80.00,Pantry,2.5,0.5,60.00,,,kg
```

Prices and costs are in pesos with at most two decimal places. Categories: Beverages, Snacks, Pantry, Personal care, Household, Other. Piece stock uses whole numbers; kilogram stock allows three decimal places and uses `kg` in the unit column. Empty stock disables tracking. Modifiers use a JSON array of names and prices in integer centavos; export a configured product for an example. The older six-column template is still accepted. Imports are limited to 2 MB and 20,000 products. A preview shows the count and first 20 rows before an atomic upsert by barcode. Imported catalog values replace the matching products, while sale snapshots remain unchanged. Duplicate barcodes and invalid records are rejected. Spreadsheet formula prefixes are escaped on export and reversed on import.

## Backups and owner controls

Settings exports the complete database as compact, validated JSON. Optional password encryption uses PBKDF2-SHA-256 with 600,000 iterations, a random salt, and AES-256-GCM with a random IV. Use a password of at least 12 characters and keep it safely: there is no recovery service. Encryption protects the exported file, not IndexedDB.

Both export and restore enforce the same record limits: 20,000 products/days; 200,000 scan rows, sales, corrections, and activity entries; 2,000 cart rows. Plain JSON must fit within 25 MiB; encrypted files may be up to 36 MiB. Oversized or invalid exports fail with a clear message rather than downloading a file the app cannot restore. Check backup size regularly as records grow. These are real capacity limits, not an unlimited archive format.

Import parsing, decryption, and initial validation run in a local worker with a 20-second timeout. All fields and references are validated again before atomic replacement. Restore and reset require typed confirmations. Schema-1 and schema-2 backups are supported; schema-3 exports include the new store tables. Database upgrades preserve existing records. Older sales recorded before checkout existed remain daily tally rows; payment details cannot be reconstructed for them. New table limits are 20,000 customers, suppliers, purchases, and shifts; 2,000 saved orders with up to 2,000 rows each; 1,000 employees; and 200,000 stock movements, cash movements, and time entries per table. The same 25 MiB plain-backup limit still applies.

The last-export date records when export was initiated. The browser cannot prove that the download finished or was retained. Verify downloads and test restoration in a separate browser/profile. Keep a copy off the store device. Clearing browser data or changing origins removes access to local records; private browsing is unsuitable for durable records. Persistent storage reduces automatic eviction risk but does not replace backups.

An optional 6–12 digit owner PIN restricts catalog/stock changes, voids/refunds, store/report settings, exports, imports, reset, and restore. Cashier scanning and checkout remain available. Unlocks last up to 15 minutes in the current window; PINs are hashed with a random salt and PBKDF2, and failed attempts receive a local cooldown. PIN changes invalidate unlocks for the previous PIN; reset and restore lock the current window. A forgotten PIN cannot be recovered through the app.

Owner access restricts normal app controls, not someone controlling the browser profile. Optional employee accounts require an owner PIN first and support cashier/manager roles. Signing in or out clears prior owner access. With active employees configured, checkout requires an employee PIN session or unlocked owner access; signed-in employee names and IDs are recorded by the database. Without employees, operator names remain manual. Employee sessions last up to eight hours in the current window. Local records are unencrypted, and the activity log is not tamper-proof. Keep the device locked when unattended. Backup files include owner and employee settings; restoring may change the configured PINs and clears access sessions.

## Interface and failure handling

The interface uses system fonts, readable text sizes, high-contrast controls, plain labels, and red asterisks on required fields. Required inputs also use native form validation. Layouts support desktop and mobile; dialogs trap focus and make the background inert.

Phones use a compact header and bottom navigation. Checkout follows the cart in the page rather than covering its fields. Products use spaced cards beneath a separate filter panel, with names, barcodes, and categories on their own lines. Each card has a Manage product button for editing, stock adjustments, and deletion. Sale, report, and receipt tables become labeled rows at phone widths. Search fields have visible labels and short placeholder hints; stock reasons use a multiline field with a separate explanation. Dialogs scroll within the available height, and the Android viewport requests content resizing when the keyboard opens.

On phones, Install app is visible beside the app name and is also available under Settings. Open the stable production URL directly in a regular Chrome tab on Android, then use the app's install dialog or Chrome's Add to Home screen / Install menu. The dialog explains the manual path when the browser has not offered a native prompt. On iPhone/iPad, use Safari's Share → Add to Home Screen. A visible install button cannot override browser eligibility or deployment access problems.

Database/rendering failures show a recovery screen without resetting records. Failed writes show an error; full storage receives an actionable message. Offline registration failures are visible. Navigation waits for pending saves. Service-worker updates defer while there are pending actions or unsaved forms, including another app window, using browser locks and a local broadcast channel where supported. Save forms and finish operations in all windows before updating.

## Deployment

Deploy the contents of `dist/` at the root of a dedicated HTTPS origin. Keep the same origin across releases. Export a full backup before updating. Version 3 upgrades IndexedDB; old builds cannot directly reopen the upgraded database. Keep the prior build and a pre-upgrade backup for recovery in a fresh browser profile, and retain older hashed assets while existing clients may still need them. See [FEATURES.md](FEATURES.md#upgrade-and-recovery) for the compatibility limits.

The build generates `dist/_headers` for hosts that support this format and `dist/security-headers.nginx.conf` for Nginx. Use `deploy/nginx.conf.example`, replacing hostname, certificates, and document root; validate Nginx configuration before reloading. Uploading `_headers` does not configure hosts that do not support it.

For Vercel, the root `vercel.json` configures Vite, `npm ci`, `npm run build`, the `dist` output directory, security headers, and cache revalidation. Include it when deploying the source project; uploading `dist` alone omits this configuration. Import the source repository in Vercel using Add New Project, or run `npx vercel` from the project root for a preview and `npx vercel --prod` when ready to publish. No environment variables or backend are required. Use the stable production domain for installation and real store records; each preview domain has separate local data. When changing the security policy in `security/headers.ts`, also update the matching headers in `vercel.json`.

The policy restricts resources to this origin and blocks inline scripts/styles, frames, objects, and external connections. A CSP meta element is also precached for offline use. HTTP headers add frame protection, MIME sniffing protection, a no-referrer policy, permissions restrictions, and HSTS. Static-host header rules require revalidation, including the HTML shell and worker. Nginx serves hashed assets with a long cache lifetime and revalidates HTML and the worker.

Verify the actual HTTPS document response includes CSP, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`. Verify MIME types, installation, offline reopening, and an update from a previous build. Preview checks cannot prove the host applied these settings.

Before live use, test the real phone/tablet, scanner, receipt/report printing, and backup restoration using disposable data. Chrome mobile viewport emulation does not prove Safari or real-device behavior. Vercel configuration is prepared; the actual deployed Vercel URL has not been inspected in this workspace.

See [DEPLOYMENT-NOTE.md](DEPLOYMENT-NOTE.md) for the release checklist and [DEPLOYMENT-REVIEW.md](DEPLOYMENT-REVIEW.md) for the original findings and their implementation status.
