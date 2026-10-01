export const LEGAL_EFFECTIVE_DATE = 'September 30, 2026'

export function PrivacyPolicy() {
  return (
    <div className="legal-text">
      <p className="form-note">Effective: {LEGAL_EFFECTIVE_DATE}. Tindahan is an offline-first point of sale. Records stay in this browser on this device unless you export them.</p>
      <h3>Who controls the data</h3>
      <p>The store using this installation is the data controller. You enter the store name and operator in Settings. There is no central Tindahan account or cloud database in this build.</p>
      <h3>What is stored on this device</h3>
      <ul>
        <li>Store preferences, products, cart, sales, receipts, voids and refunds.</li>
        <li>Customers you add: name, phone, email, address, notes, loyalty card and points.</li>
        <li>Suppliers, purchase orders, stock movements, saved orders, shifts, cash movements.</li>
        <li>Employees: name, role, active status and credential hash. Operator names on sales and audit entries.</li>
      </ul>
      <h3>Cookies and local storage</h3>
      <p>We set no HTTP cookies, run no analytics, show no ads, and load no third-party scripts or fonts. The Content Security Policy allows scripts, styles, images and fonts from this origin only.</p>
      <ul>
        <li>IndexedDB database <code>tindahan-local</code>: products, sales, customers and settings.</li>
        <li>Cache Storage and service worker: app files for offline use.</li>
        <li>No tracking storage. No consent banner is needed because there is nothing non-essential to consent to.</li>
      </ul>
      <p>Clearing site data in the browser, or using Reset device data in Settings, removes local records. Clearing data without a backup cannot be undone.</p>
      <h3>What we do not do</h3>
      <p>Sales and customer details are not uploaded by the app. Sharing happens only when you act: downloading a PDF receipt, exporting a JSON backup, or printing. Keep backup files off this device and limit who can open them.</p>
      <h3>Hosting</h3>
      <p>Static files are served over HTTPS by your host (for example Vercel). The host may process IP addresses and basic request logs for security and delivery. That processing is outside this app and covered by the host policy.</p>
      <h3>Retention and deletion</h3>
      <p>Closing a day archives that day. Records remain until you delete them or reset the device. Export a backup before resetting, restoring, or switching browsers. Test that backup files open before you rely on them.</p>
      <h3>Security limits</h3>
      <p>Owner PINs and staff roles restrict controls inside the app. They do not encrypt the local database. Anyone with full access to this device or browser profile can read local records. Use device locks and separate OS accounts for cashiers where possible.</p>
      <h3>Your rights</h3>
      <p>If you run the store, you can access, correct, export and delete records directly in Products, Store tools, Sales history and Settings. If you are a customer or employee, contact the store where you gave your details. For Philippine Data Privacy Act requests, contact the store owner. For EU or UK visitors, the same local-only handling applies.</p>
      <h3>Changes</h3>
      <p>When this notice changes, the effective date above is updated in the app. Continued use after that date means you accept the updated notice for records kept on your device.</p>
    </div>
  )
}

export function TermsOfUse() {
  return (
    <div className="legal-text">
      <p className="form-note">Effective: {LEGAL_EFFECTIVE_DATE}. Tindahan is a local sales tool provided as is.</p>
      <h3>What the app does</h3>
      <p>Tindahan records carts, checkout totals, receipts, stock changes, shifts and daily reports in this browser. It works offline after the first load. It does not file taxes, verify payments with GCash or banks, or provide legal or accounting advice.</p>
      <h3>Your responsibilities</h3>
      <ul>
        <li>Check starter products, barcodes, prices, taxes, discounts and GCash details before selling.</li>
        <li>Confirm payment in your wallet or terminal. The app only records what the operator enters.</li>
        <li>Export backups regularly, keep copies off the device, and keep backup passwords safe. Encrypted backups cannot be restored without the password.</li>
        <li>Control physical access to the device. Owner PINs limit app controls but do not encrypt data.</li>
        <li>Comply with BIR receipts, consumer, labor and data privacy rules that apply to your store.</li>
      </ul>
      <h3>Acceptable use</h3>
      <p>Use the app only for lawful sales and store records. Do not enter data you have no right to keep, and do not use receipts or reports to mislead customers, staff or authorities.</p>
      <h3>No warranty</h3>
      <p>The app is provided as is, without warranty of any kind, including fitness for a particular purpose, uninterrupted operation, or correct tax treatment. Verify totals and reports before relying on them.</p>
      <h3>Liability</h3>
      <p>To the extent permitted by law, the provider is not liable for lost profits, lost data, missed backups, device failure, or actions taken based on app records. Your remedy for defects is to stop using the app and export your records.</p>
      <h3>Updates</h3>
      <p>Updates wait for saved forms and completed actions. Install updates from the in-app prompt and recheck settings after an update.</p>
      <h3>Ending use</h3>
      <p>You may stop using the app at any time by exporting your records and clearing site data or resetting device data. These terms survive for past sales records.</p>
    </div>
  )
}
