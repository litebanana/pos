import { test, expect, type Page } from '@playwright/test'
import { productAction } from './product-helpers'

async function navigate(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click()
}
async function fitsPhone(page: Page, width: number) {
  const metrics = await page.evaluate(() => {
    const canvas = document.createElement('canvas').getContext('2d')!
    const clipped = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input[placeholder], textarea[placeholder]'))
      .filter(input => input.getClientRects().length && !input.value).filter(input => {
        const style = getComputedStyle(input)
        canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        return canvas.measureText(input.placeholder).width > input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      }).map(input => input.placeholder)
    return { viewport: window.innerWidth, page: document.documentElement.scrollWidth, clipped }
  })
  expect(metrics.viewport).toBe(width)
  expect(metrics.page).toBeLessThanOrEqual(width)
  expect(metrics.clipped).toEqual([])
}

for (const width of [320, 360, 412, 480]) {
  test(`phone screens, placeholders, and typed values fit at ${width}px`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Phone layout regression')
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /^Coca-Cola Original/ })).toBeVisible()
    await fitsPhone(page, width)
    const scanner = page.getByRole('textbox', { name: 'Scan or enter barcode' })
    expect((await scanner.boundingBox())!.y).toBeLessThan(550)
    await scanner.pressSequentially('4800016000013')
    await expect(scanner).toHaveValue('4800016000013')
    await expect(scanner).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)')
    await scanner.press('Enter')
    const checkout = page.getByRole('button', { name: 'Checkout', exact: true })
    // Checkout stays in the document so it cannot cover the scanner or cart.
    const scannerBottom = (await scanner.boundingBox())!.y + (await scanner.boundingBox())!.height
    expect((await checkout.boundingBox())!.y).toBeGreaterThan(scannerBottom)
    await checkout.click()
    await fitsPhone(page, width)
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: /Receipt #/ })).toBeVisible()
    await fitsPhone(page, width)
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await page.getByRole('button', { name: 'Dismiss notification' }).click()
    for (const name of ['Products', 'Sales history', 'Daily reports', 'Settings']) {
      await navigate(page, name)
      await fitsPhone(page, width)
      for (const list of await page.locator('main .table-scroll').all()) {
        expect(await list.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      }
      if (name === 'Products') {
        await page.getByRole('textbox', { name: 'Search products' }).pressSequentially('Coca-Cola')
        await expect(page.getByRole('textbox', { name: 'Search products' })).toHaveValue('Coca-Cola')
        await productAction(page, 'Adjust stock')
        await fitsPhone(page, width)
        const reason = page.getByRole('textbox', { name: 'Reason', exact: true })
        await reason.pressSequentially('Received 24 units')
        await expect(reason).toHaveValue('Received 24 units')
        await page.setViewportSize({ width, height: 380 })
        await reason.scrollIntoViewIfNeeded()
        await fitsPhone(page, width)
        const dialog = page.getByRole('dialog')
        expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(356)
        await page.getByRole('button', { name: 'Close dialog' }).click()
        await page.setViewportSize({ width, height: 800 })
        await page.getByRole('button', { name: 'Add product', exact: true }).click()
        await page.getByRole('textbox', { name: 'Barcode', exact: true }).pressSequentially('TEST-MOBILE')
        await page.getByRole('textbox', { name: 'Product name', exact: true }).pressSequentially('Readable product name')
        await expect(page.getByRole('textbox', { name: 'Product name', exact: true })).toHaveValue('Readable product name')
        await fitsPhone(page, width)
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      }
      if (name === 'Settings') {
        const store = page.getByRole('textbox', { name: 'Store name', exact: true })
        await store.fill(''); await store.pressSequentially('My neighborhood store')
        await expect(store).toHaveValue('My neighborhood store')
      }
      await page.screenshot({ path: `test-results/phone-${width}-${name.replaceAll(' ', '-')}.png`, fullPage: true })
    }
  })
}
