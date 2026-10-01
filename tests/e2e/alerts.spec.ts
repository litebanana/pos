import { test, expect, type Page } from '@playwright/test'
import { productAction } from './product-helpers'

const barcode = '4800016000013'
async function navigate(page: Page, name: string) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click() }
async function scan(page: Page, code = barcode) { const input = page.getByRole('textbox', { name: 'Scan or enter barcode' }); await input.fill(code); await input.press('Enter') }
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Coca-Cola Original/ })).toBeVisible()
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated')
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}
test.beforeEach(async ({ page }) => ready(page))

test('needs-attention chips surface low stock, saved orders, and open shifts', async ({ page }) => {
  const alerts = page.getByRole('region', { name: 'Needs attention' })
  await navigate(page, 'Sell')
  await expect(alerts).toHaveCount(0)
  await navigate(page, 'Products')
  await productAction(page, 'Adjust stock')
  await page.getByRole('spinbutton', { name: 'New stock quantity', exact: true }).fill('4')
  await page.getByRole('button', { name: 'Save stock adjustment', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await navigate(page, 'Sell')
  await scan(page)
  await page.getByRole('button', { name: 'Save order', exact: true }).click()
  await page.getByRole('dialog').getByRole('textbox', { name: 'Order name' }).fill('Table 1')
  await page.getByRole('dialog').getByRole('button', { name: 'Save order', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(alerts.getByRole('button', { name: '1 product is low on stock', exact: true })).toBeVisible()
  await expect(alerts.getByRole('button', { name: '1 saved order is waiting', exact: true })).toBeVisible()
  await alerts.getByRole('button', { name: '1 product is low on stock', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Purchasing', exact: true })).toBeVisible()
  await navigate(page, 'Sell')
  await alerts.getByRole('button', { name: '1 saved order is waiting', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved orders', exact: true })).toBeVisible()
  await expect(page.getByText('Table 1')).toBeVisible()
  await page.getByLabel('Choose a store tool').selectOption('Cash drawer')
  await page.getByRole('button', { name: 'Open cash shift', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Open shift #1', exact: true })).toBeVisible()
  await navigate(page, 'Sell')
  await expect(alerts.getByRole('button', { name: 'Cash shift #1 is open', exact: true })).toBeVisible()
  await alerts.getByRole('button', { name: 'Cash shift #1 is open', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Open shift #1', exact: true })).toBeVisible()
})
