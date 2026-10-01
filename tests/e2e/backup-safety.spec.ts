import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const barcode = '4800016000013'
async function navigate(page: Page, name: string) { await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click() }
async function scan(page: Page, code = barcode) { const input = page.getByRole('textbox', { name: 'Scan or enter barcode' }); await input.fill(code); await input.press('Enter') }
async function pay(page: Page) {
  await page.getByRole('button', { name: 'Checkout', exact: true }).click()
  await page.getByRole('button', { name: 'Complete sale', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('heading', { name: /Receipt #/ })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}
async function ready(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Coca-Cola Original/ })).toBeVisible()
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated')
  if (!await page.evaluate(() => !!navigator.serviceWorker.controller)) await page.reload()
  await page.waitForFunction(() => !!navigator.serviceWorker.controller)
}
test.beforeEach(async ({ page }) => ready(page))

test('closing the day with a due backup requires acknowledgment before archiving', async ({ page }) => {
  await scan(page)
  await pay(page)
  await page.getByRole('button', { name: 'Close day', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('No backup exported yet.')
  const closeButton = dialog.getByRole('button', { name: 'Close day & download', exact: true })
  await expect(closeButton).toBeDisabled()
  await dialog.getByLabel(/I exported a backup/).check()
  await expect(closeButton).toBeEnabled()
  const download = page.waitForEvent('download')
  await closeButton.click()
  await (await download).path()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('exporting a backup first clears the close-day warning without a checkbox', async ({ page }) => {
  await navigate(page, 'Settings')
  await page.getByRole('button', { name: 'Export full backup', exact: true }).click()
  const backupDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download backup', exact: true }).click()
  await (await backupDownload).path()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await navigate(page, 'Sell')
  await scan(page)
  await pay(page)
  await page.getByRole('button', { name: 'Close day', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox', { name: /I exported a backup/ })).toHaveCount(0)
  const closeButton = dialog.getByRole('button', { name: 'Close day & download', exact: true })
  await expect(closeButton).toBeEnabled()
  const reportDownload = page.waitForEvent('download')
  await closeButton.click()
  await (await reportDownload).path()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('recent activity exports as a CSV containing recorded sales', async ({ page }) => {
  await scan(page)
  await pay(page)
  await navigate(page, 'Settings')
  await expect(page.getByRole('heading', { name: 'Recent activity', exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export activity CSV', exact: true }).click()
  const contents = await readFile((await (await download).path())!, 'utf8')
  expect(contents).toContain('Sale #')
  expect(contents).toContain('Owner')
})
