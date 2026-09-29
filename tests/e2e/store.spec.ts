import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { contentSecurityPolicy } from '../../security/headers'
import { productAction } from './product-helpers'

const barcode = '4800016000013'
async function navigate(page: Page, name: string) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click() }
async function scan(page: Page, code = barcode) { const input = page.getByRole('textbox', { name: 'Scan or enter barcode' }); await input.fill(code); await input.press('Enter') }
async function pay(page: Page, amount?: string) {
  await page.getByRole('button', { name: 'Checkout', exact: true }).click()
  if (amount) await page.getByRole('dialog').getByLabel('Amount received (₱)').fill(amount)
  await page.getByRole('button', { name: 'Complete sale', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Receipt #/ })).toBeVisible()
}
async function exportBackup(page: Page, password?: string) {
  await navigate(page, 'Settings')
  await page.getByRole('button', { name: 'Export full backup', exact: true }).click()
  if (password) { await page.getByLabel('Encrypt with a password').check(); await page.getByLabel('Backup password (at least 12 characters)').fill(password); await page.getByLabel('Confirm backup password').fill(password) }
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup', exact: true }).click()
  const file = await download
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return (await file.path())!
}
async function beginRestore(page: Page, path: string, password?: string) {
  await navigate(page, 'Settings')
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await page.getByLabel('Choose backup file').setInputFiles(path)
  if (password) await page.getByRole('dialog').getByRole('textbox', { name: 'Backup password', exact: true }).fill(password)
  await page.getByRole('button', { name: 'Check backup', exact: true }).click()
}
async function finishRestore(page: Page) { await page.getByLabel('Type RESTORE to confirm').fill('RESTORE'); await page.getByRole('dialog').getByRole('button', { name: 'Restore backup', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0) }
async function pdfText(path: string) {
  const task = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true })
  const pdf = await task.promise
  const text: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) text.push((await (await pdf.getPage(i)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join(' '))
  await task.destroy()
  return text.join(' ')
}
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Coca-Cola Original/ })).toBeVisible()
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated')
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}
test.beforeEach(async ({ page }) => ready(page))

test('installation is reachable from the main screen and handles browser install events', async ({ page }) => {
  const entry = page.locator('.sidebar').getByRole('button', { name: 'Install app', exact: true })
  await expect(entry).toBeVisible()
  await entry.click()
  const dialog = page.getByRole('dialog', { name: 'Install Tindahan' })
  await expect(dialog).toContainText('Add to Home screen')
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true })
    Object.assign(event, {
      prompt: async () => { document.documentElement.dataset.installPrompted = 'yes' },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    })
    window.dispatchEvent(event)
  })
  await dialog.getByRole('button', { name: 'Install app', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-install-prompted', 'yes')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0)
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
  await expect(dialog).toContainText('This app is installed.')
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await expect(page.locator('.sidebar').getByRole('button', { name: 'Installation details', exact: true })).toBeVisible()
})

test('scanner saves a cart, rapid quantity changes are atomic, and removals can be undone', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'Scan or enter barcode' })
  await expect(input).toBeFocused()
  for (let i = 0; i < 5; i++) await scan(page)
  const quantity = page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })
  await expect(quantity).toHaveValue('5')
  await expect(page.getByLabel('Daily totals')).toContainText('₱0.00')
  await page.getByRole('button', { name: 'Increase Coca-Cola Original quantity' }).dblclick()
  await expect(quantity).toHaveValue('7')
  await page.reload(); await expect(quantity).toHaveValue('7')
  await page.getByRole('button', { name: 'Remove Coca-Cola Original', exact: true }).click()
  await expect(page.getByText('Cart is empty.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Undo removal' }).click()
  await expect(quantity).toHaveValue('7')
})

test('unknown products save to the cart with required labels and grouping can be disabled', async ({ page }) => {
  await scan(page, 'NEW-123')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Product name')).toBeFocused()
  for (const label of ['Barcode', 'Product name', 'Unit price (₱)', 'Category']) {
    const field = dialog.getByRole(label === 'Category' ? 'combobox' : label === 'Unit price (₱)' ? 'spinbutton' : 'textbox', { name: label, exact: true })
    await expect(field).toHaveAttribute('required', '')
    await expect(field.locator('..').getByText('*', { exact: true })).toHaveCSS('color', 'rgb(181, 31, 36)')
  }
  await dialog.getByLabel('Product name').fill('Banana chips')
  await dialog.getByLabel('Unit price (₱)').fill('12.50')
  await dialog.getByRole('button', { name: 'Save & add to cart' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Banana chips quantity' })).toHaveValue('1')
  await navigate(page, 'Settings'); await page.getByLabel('Group repeat scans').uncheck()
  await navigate(page, 'Sell'); await scan(page, 'NEW-123')
  await expect(page.getByRole('spinbutton', { name: 'Banana chips quantity' })).toHaveCount(2)
})

test('offline checkout saves cash/change, prints a receipt, archives a day, and preserves store details', async ({ page, context }) => {
  await navigate(page, 'Settings')
  await page.getByRole('textbox', { name: 'Store name', exact: true }).fill('Aling María’s Store')
  await expect(page.getByRole('textbox', { name: 'Store name', exact: true })).toHaveValue('Aling María’s Store')
  await page.getByRole('button', { name: 'Save store details' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Store details saved.' })).toBeVisible()
  await navigate(page, 'Sell')
  await context.setOffline(true); await page.reload()
  await scan(page); await scan(page)
  await pay(page, '100.00')
  await expect(page.getByRole('dialog')).toContainText('₱50.00')
  const receiptDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download receipt PDF' }).click()
  const receipt = await pdfText((await (await receiptDownload).path())!)
  expect(receipt).toContain('Aling María’s Store'); expect(receipt).toContain('Sales receipt'); expect(receipt).toContain('Change'); expect(receipt).toContain('₱ 50.00'); expect(receipt).toContain('₱ 100.00')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByLabel('Daily totals')).toContainText('₱50.00')
  await page.getByRole('button', { name: 'Close day', exact: true }).click()
  const reportDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Close day & download' }).click()
  const report = await pdfText((await (await reportDownload).path())!)
  expect(report).toContain('NET SALES'); expect(report).toContain('Aling María’s Store')
  await navigate(page, 'Settings'); await expect(page.getByRole('textbox', { name: 'Store name', exact: true })).toHaveValue('Aling María’s Store')
  await navigate(page, 'Products'); await productAction(page, 'Edit')
  await page.getByLabel('Product name').fill('Changed name'); await page.getByLabel('Unit price (₱)').fill('99')
  await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await navigate(page, 'Daily reports'); await page.getByRole('button', { name: 'View', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Coca-Cola Original'); await expect(page.getByRole('dialog')).not.toContainText('Changed name')
})

test('full backup round trips the cart, sales, and typed reset/restore confirmation', async ({ page }) => {
  await scan(page); await pay(page); await page.getByRole('button', { name: 'Done', exact: true }).click()
  await scan(page, '4800016000020')
  const path = await exportBackup(page), backup = JSON.parse(await readFile(path, 'utf8'))
  expect(backup.schemaVersion).toBe(3); expect(backup.sales).toHaveLength(1); expect(backup.cart).toHaveLength(1)
  await page.getByRole('button', { name: 'Reset local data', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Reset all local data' })).toBeDisabled()
  await page.getByLabel('Type RESET to confirm').fill('RESET'); await page.getByRole('button', { name: 'Reset all local data' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await beginRestore(page, path); await finishRestore(page)
  await navigate(page, 'Sell'); await expect(page.getByRole('spinbutton', { name: 'Lucky Me! Pancit Canton quantity' })).toHaveValue('1')
  await navigate(page, 'Sales history'); await expect(page.getByRole('row').filter({ hasText: '#000001' })).toContainText('₱25.00')
})

test('encrypted backups restore offline and reject an incorrect password without replacing records', async ({ page, context }) => {
  await scan(page)
  const path = await exportBackup(page, 'private backup password')
  expect(await readFile(path, 'utf8')).not.toContain('Coca-Cola')
  await context.setOffline(true)
  await beginRestore(page, path, 'wrong password')
  await expect(page.getByRole('alert')).toContainText('password is incorrect')
  await page.getByRole('dialog').getByRole('textbox', { name: 'Backup password', exact: true }).fill('private backup password')
  await page.getByRole('button', { name: 'Check backup', exact: true }).click(); await finishRestore(page)
  await navigate(page, 'Sell'); await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('1')
})

test('stock deductions and refunds keep original sales and record reasons', async ({ page }) => {
  await navigate(page, 'Products'); await productAction(page, 'Edit')
  await page.getByLabel('Stock quantity').fill('2'); await page.getByLabel('Low-stock alert at').fill('1'); await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await navigate(page, 'Sell'); await scan(page); await scan(page); await scan(page)
  await expect(page.getByRole('alert')).toContainText('insufficient stock')
  await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('2')
  await pay(page); await page.getByRole('button', { name: 'Done', exact: true }).click()
  await navigate(page, 'Products'); await expect(page.getByRole('row').filter({ hasText: 'Coca-Cola Original' })).toContainText('0 · Low')
  await navigate(page, 'Sales history'); await page.getByRole('button', { name: 'Void / refund 1' }).click()
  await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Customer returned both items'); await page.getByRole('button', { name: 'Record correction', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: '#000001' })).toContainText('Refunded')
  await navigate(page, 'Products'); await expect(page.getByRole('row').filter({ hasText: 'Coca-Cola Original' })).toContainText('2')
  await navigate(page, 'Daily reports'); await page.getByRole('button', { name: 'View', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Customer returned both items')
})

test('owner PIN protects catalog edits while cashier checkout remains available', async ({ page }) => {
  await navigate(page, 'Settings')
  await page.getByLabel('New owner PIN (6–12 digits)').fill('123456'); await page.getByLabel('Confirm owner PIN').fill('123456'); await page.getByRole('button', { name: 'Save owner PIN' }).click()
  await expect(page.getByRole('button', { name: 'Unlock owner access' })).toBeVisible()
  await navigate(page, 'Products'); await productAction(page, 'Edit')
  await page.getByLabel('Unit price (₱)').fill('1'); await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Unlock owner')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await navigate(page, 'Sell'); await scan(page); await pay(page); await page.getByRole('button', { name: 'Done', exact: true }).click()
  await navigate(page, 'Settings'); await page.getByRole('textbox', { name: 'Owner PIN', exact: true }).fill('123456'); await page.getByRole('button', { name: 'Unlock owner access' }).click()
  await expect(page.getByRole('button', { name: 'Lock owner access' })).toBeVisible()
  await navigate(page, 'Products'); await productAction(page, 'Edit'); await page.getByLabel('Unit price (₱)').fill('30'); await page.getByRole('button', { name: 'Save product', exact: true }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Coca-Cola Original' })).toContainText('₱30.00')
})

test('CSV import previews changes and rejects duplicates before mutation', async ({ page }) => {
  await navigate(page, 'Products')
  const csv = 'barcode,name,price,category,stock,low_stock\nCSV-1,"Tea, large",12.50,Beverages,4,1'
  await page.getByLabel('Choose catalog CSV').setInputFiles({ name: 'catalog.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('dialog')).toContainText('Tea, large')
  await page.getByRole('button', { name: 'Import 1 products' }).click()
  await page.getByLabel('Search products').fill('CSV-1'); await expect(page.getByRole('row').filter({ hasText: 'Tea, large' })).toContainText('₱12.50')
  await page.getByLabel('Choose catalog CSV').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(csv + '\nCSV-1,Duplicate,1,Other,0,0') })
  await expect(page.getByRole('alert')).toContainText('Duplicate barcode')
  await expect(page.getByRole('row').filter({ hasText: 'Tea, large' })).toContainText('₱12.50')
})

test('database read failures show a recovery screen instead of a blank app', async ({ page, context }) => {
  const probe = await context.newPage()
  await probe.addInitScript(() => { IDBObjectStore.prototype.get = function () { throw new Error('Injected database read error') } })
  await probe.goto('/')
  await expect(probe.getByRole('heading', { name: 'Unable to open your store' })).toBeVisible()
  await expect(probe.getByRole('button', { name: 'Reload app' })).toBeVisible()
  await probe.close()
  await scan(page); await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('1')
})

test('mobile and desktop layouts use readable text and only local assets', async ({ page }) => {
  const remote: string[] = []
  page.on('request', request => { if (!request.url().startsWith('http://localhost:4173') && !request.url().startsWith('blob:') && !request.url().startsWith('data:')) remote.push(request.url()) })
  await page.reload(); await scan(page)
  for (const name of ['Sell', 'Products', 'Sales history', 'Daily reports', 'Settings']) {
    await navigate(page, name)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16)
  }
  await navigate(page, 'Sell')
  await page.screenshot({ path: `test-results/simple-sell-${page.viewportSize()!.width}.png`, fullPage: true })
  expect(remote).toEqual([])
})

test('production CSP blocks script injection and external connections', async ({ page }) => {
  const response = await page.request.get('/')
  expect(response.headers()['content-security-policy']).toBe(contentSecurityPolicy)
  expect(response.headers()['x-frame-options']).toBe('DENY'); expect(response.headers()['x-content-type-options']).toBe('nosniff')
  const result = await page.evaluate(async () => {
    const script = document.createElement('script'); script.textContent = 'window.cspInjected = true'; document.body.appendChild(script)
    let blocked = false
    try { await fetch('https://example.invalid/check') } catch { blocked = true }
    return { injected: !!(window as unknown as { cspInjected?: boolean }).cspInjected, blocked }
  })
  expect(result).toEqual({ injected: false, blocked: true })
})

test('malicious and oversized backup files leave the cart unchanged', async ({ page }) => {
  await scan(page)
  const path = await exportBackup(page), backup = JSON.parse(await readFile(path, 'utf8'))
  backup.products[0].color = 'modal-backdrop'
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await page.getByLabel('Choose backup file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('button', { name: 'Check backup', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('invalid product color')
  await page.getByLabel('Choose backup file').setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(37 * 1024 * 1024, 32) })
  await page.getByRole('button', { name: 'Check backup', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('smaller than 36 MB')
  await page.getByRole('button', { name: 'Close dialog' }).click(); await navigate(page, 'Sell'); await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('1')
})

test('multiple windows cannot complete the same cart twice', async ({ page, context }) => {
  await scan(page)
  const other = await context.newPage(); await ready(other)
  await page.getByRole('button', { name: 'Checkout', exact: true }).click(); await other.getByRole('button', { name: 'Checkout', exact: true }).click()
  await page.getByRole('button', { name: 'Complete sale' }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Receipt #/ })).toBeVisible()
  await other.getByRole('button', { name: 'Complete sale' }).click(); await expect(other.getByRole('alert')).toContainText('Add an item to the cart first')
  await other.close(); await page.getByRole('button', { name: 'Done', exact: true }).click()
  await navigate(page, 'Sales history'); await expect(page.locator('tbody tr')).toHaveCount(1)
})

test('long daily reports paginate and keep text inside printable margins', async ({ page }) => {
  const path = await exportBackup(page), backup = JSON.parse(await readFile(path, 'utf8'))
  backup.settings.find((setting: { key: string }) => setting.key === 'preferences').value.storeName = 'Aling María’s Neighborhood Store'
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const now = new Date().toISOString()
  backup.sessions = [{ id: 1, date, status: 'closed', storeName: 'Aling María’s Neighborhood Store', paper: 'letter', createdAt: now, closedAt: now }]
  backup.scans = Array.from({ length: 160 }, (_, index) => ({ id: index + 1, sessionId: 1, barcode: String(index).padStart(3, '0') + 'W'.repeat(97), name: 'A long product name that wraps across several lines in the printed daily sales report', price: 1250, category: 'Other', color: 'sand', quantity: 2 }))
  await page.getByRole('button', { name: 'Restore backup', exact: true }).click()
  await page.getByLabel('Choose backup file').setInputFiles({ name: 'reports.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await page.getByRole('button', { name: 'Check backup', exact: true }).click(); await finishRestore(page)
  await navigate(page, 'Daily reports')
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download report 1' }).click()
  const task = getDocument({ data: new Uint8Array(await readFile((await (await download).path())!)), useSystemFonts: true }), pdf = await task.promise
  expect(pdf.numPages).toBeGreaterThan(3)
  for (let i = 1; i <= pdf.numPages; i++) {
    const sheet = await pdf.getPage(i), viewport = sheet.getViewport({ scale: 1 })
    for (const item of (await sheet.getTextContent()).items) if ('str' in item && item.str.trim()) {
      expect(item.transform[4]).toBeGreaterThanOrEqual(40); expect(item.transform[4] + item.width).toBeLessThanOrEqual(viewport.width - 40)
      expect(item.transform[5]).toBeGreaterThanOrEqual(20); expect(item.transform[5]).toBeLessThanOrEqual(viewport.height - 20)
    }
  }
  await task.destroy()
})
