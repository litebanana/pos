# Release checklist — Tindahan 3.0

The app includes offline checkout, split payments, receipt discounts and tax, customers and loyalty, partial refunds, saved orders, weighted products and add-ons, supplier purchasing, stocktakes and movement history, barcode labels, cash shifts, employee PIN sessions and time clocks, analytics, and a dark theme. Existing receipts, backups, owner controls, recovery, and coordinated updates remain supported. The interface uses readable system fonts, plain wording, and red required-field markers. See [FEATURES.md](FEATURES.md) for the supported workflows and limits.

Version-1 and version-2 local data and backups are supported. Existing daily tally records retain their original prices and reports; individual payments cannot be inferred for those records. Version-3 backups include the new store tables and require this release. Export and retain a backup before upgrading. See the upgrade and rollback instructions in [FEATURES.md](FEATURES.md).

## Current 3.0 validation — 2026-09-28

All 71 unit tests and 60 desktop/mobile Chrome browser tests passed. Eight phone-only cases were intentionally skipped on desktop. The production TypeScript/Vite/PWA build passed, and the runtime dependency audit reported zero known vulnerabilities. The checks cover the new store workflows, database upgrade, exact monetary allocations, repeated partial refunds, staff restrictions, backup compatibility, offline checkout, camera simulation/cleanup, and coordinated updates. Phone layout inspection at 320, 360, 390, 412, and 480 px found no horizontal overflow or clipped placeholders. Light and dark screenshots were inspected. The deployed URL and actual Android camera, installation, scanner, and printer still need store acceptance checks.

## Previous 2.0 validation

Validation on 2026-09-28: 45 unit tests and 30 desktop/mobile Chrome browser tests passed. The production build passed, including PWA generation. The installed dependency audit reported zero known vulnerabilities. Desktop and mobile screenshots were inspected. These checks do not replace testing the deployed host and the store's actual equipment.

Follow-up mobile installation fix: the install shortcut is now visible beside the app name on phones, with clearer manual Chrome instructions. The production build and four focused desktop/mobile install-interaction and layout checks passed. Browser prompt events were simulated for the interaction checks; actual Android installation on the deployed Vercel URL still needs verification.

Follow-up phone layout fixes: compact bottom navigation, checkout within the page, labeled product/sale/report/receipt rows, persistent search labels, short placeholder hints, and bounded dialogs. A hidden CSV input no longer widens the viewport. The latest production build and complete browser suite passed: 36 tests passed, with four phone-only cases intentionally skipped on desktop. Layout inspection at 320, 360, 390, 412, and 480 px found no clipped placeholder text or horizontal list overflow. Sequential typing and reduced-height dialog checks passed. These are Chrome browser checks, not a physical Android keyboard test.

Follow-up Products spacing: phone filters sit above separate product cards, product metadata uses individual lines, and a Manage product button opens edit, stock adjustment, and delete actions. The production build and 16 focused browser tests passed, with six phone-only cases skipped on desktop. The checks cover product actions, stock changes, owner PIN restrictions, CSV import, checkout, and phone layouts. Inspection at 320, 360, 390, 412, and 480 px found no horizontal overflow or clipped placeholders.

## Before uploading

- [ ] Run `npm ci`, `npm test`, `npm run build`, and `npm run test:e2e` for the release.
- [ ] Put source and lockfile in version control and record the release version. This workspace did not have a Git repository at the time of review.
- [ ] Keep the previous deployment and older hashed assets for rollback and clients still running an older build.
- [ ] Export a pre-upgrade backup, close old app windows, then update. Keep the upgraded browser profile and a version-3 backup if any later rollback is necessary; test an older backup in a fresh profile.
- [ ] Choose a dedicated HTTPS production origin and hosting provider.

## Host checks

- [ ] Upload the production `dist/` contents at the origin root.
- [ ] For Vercel, deploy the source project with the root `vercel.json` (Vite, `npm ci`, `npm run build`, output `dist`). For other hosts, apply `dist/_headers` only if supported, or configure Nginx using `deploy/nginx.conf.example` and the generated header include.
- [ ] Inspect the actual HTTPS document response for CSP, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
- [ ] Check JavaScript, fonts, icons, and the manifest MIME types.
- [ ] Confirm HTML and the worker revalidate so deployed updates are discovered.
- [ ] Preserve the same origin between releases; moving the origin requires export/restore.

## Store acceptance checks

- [ ] Replace/check the example barcodes and prices, or reset the catalog and import the store's own CSV.
- [ ] Save the store and operator names. Set an owner PIN if the device is shared.
- [ ] Install the app on the actual phone/tablet. Test Safari separately if iPhone/iPad is supported.
- [ ] Reopen in airplane mode and check scanning, quantity changes, checkout, cash/change, receipts, stock, closing the day, and history.
- [ ] Test the actual USB/Bluetooth scanner, rapid scanning, and physical PDF printing.
- [ ] Test camera scanning on the actual Android browser, weighted labels if configured, and receipt/barcode-label printing with the store's printer.
- [ ] Verify a split-payment sale with discounts/tax, a partial refund, customer points, saved orders, purchase receiving, a stocktake, shift closing, and employee sign-in with the store's settings.
- [ ] Export a full backup, retain it off the device, and restore into a separate browser/profile with disposable records. Compare prices, stock, cart, sales, corrections, reports, and totals.
- [ ] If encrypting backups, test the password and store it safely. There is no password recovery.
- [ ] Verify an installed app update with two windows and unsaved/pending work.

## Limits to understand

Payment methods are recorded; payments are processed outside the app. Refunds can return selected item quantities. Store data stays in the current browser profile; separate phones do not share stock, customers, or sales. Backups have documented size/record limits and fail explicitly if exceeded. Check backup size as records grow.

Owner and employee PINs restrict normal app actions and identify employee sessions; they do not encrypt IndexedDB or provide server authentication. Anyone controlling the browser profile can access or alter raw records. Activity entries are not tamper-proof. Optional encryption protects exported files only. Keep the device locked and keep backups private.

The deployed Vercel URL has not been supplied for inspection. Actual response headers and physical-device acceptance still need verification on the production site and the store's equipment.
