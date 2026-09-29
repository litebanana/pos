import { chromium } from '@playwright/test'

// Run against a production preview using disposable browser contexts.
const baseURL = process.argv[2] || 'http://127.0.0.1:4174'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const check of ['blocked IndexedDB', 'failed database read']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(mode => {
      if (mode === 'blocked IndexedDB') {
        IDBFactory.prototype.open = function () {
          throw new DOMException('Device storage blocked for readiness check', 'SecurityError')
        }
      } else {
        IDBObjectStore.prototype.get = function () {
          throw new Error('Database read failed for readiness check')
        }
      }
    }, check)
    await page.goto(baseURL)
    await page.waitForTimeout(1500)
    const text = await page.locator('body').innerText()
    console.log(JSON.stringify({
      check,
      rootChildren: await page.locator('#root').evaluate(node => node.childElementCount),
      storageWarningVisible: text.includes('Device storage is unavailable'),
      recoveryVisible: text.includes('Unable to open your store'),
      errors,
    }, null, 2))
    await context.close()
  }
} finally {
  await browser.close()
}
