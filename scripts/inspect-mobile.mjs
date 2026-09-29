import { chromium, devices } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

// Disposable local browser data, served from the production build.
const root = path.resolve('dist')
const phase = process.argv[2] === 'after' ? 'after' : 'before'
const output = path.resolve('test-results', 'mobile-review', phase)
await mkdir(output, { recursive: true })
const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' }
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return }
    response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream')
    response.setHeader('Cache-Control', 'no-cache')
    response.end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  for (const width of (process.argv[3] === 'debug' ? [320] : [320, 360, 390, 412, 480])) {
    const context = await browser.newContext({ ...devices['Pixel 7'], viewport: { width, height: 800 } })
    const page = await context.newPage()
    await page.goto(url)
    await page.getByRole('button', { name: /^Coca-Cola Original/ }).waitFor()
    await page.getByRole('button', { name: /^Coca-Cola Original/ }).click()
    await page.getByRole('button', { name: 'Checkout', exact: true }).click()
    await page.getByRole('button', { name: 'Complete sale', exact: true }).click()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    const dismiss = page.getByRole('button', { name: 'Dismiss notification' })
    if (await dismiss.isVisible()) await dismiss.click()
    for (const name of ['Sell', 'Products', 'Sales history', 'Daily reports', 'Settings']) {
      await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click()
      const metrics = await page.evaluate(() => {
        const canvas = document.createElement('canvas').getContext('2d')
        const placeholders = [...document.querySelectorAll('input[placeholder]')].filter(input => input.getClientRects().length).map(input => {
          const style = getComputedStyle(input)
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
          return { text: input.placeholder, available: Math.round(available), required: Math.ceil(canvas.measureText(input.placeholder).width), clipped: canvas.measureText(input.placeholder).width > available }
        })
        const scanner = document.querySelector('.scanner-form')?.getBoundingClientRect()
        return { overflow: document.documentElement.scrollWidth > innerWidth, headerHeight: Math.round(document.querySelector('.sidebar').getBoundingClientRect().height), scannerBottom: scanner && Math.round(scanner.bottom), tables: [...document.querySelectorAll('.table-scroll')].map(table => ({ available: table.clientWidth, required: table.scrollWidth })), placeholders }
      })
      console.log(JSON.stringify({ width, screen: name, ...metrics }))
      if (width === 320 || width === 412) await page.screenshot({ path: path.join(output, `${width}-${name.replaceAll(' ', '-')}.png`), fullPage: true })
      if (name === 'Products') {
        await page.getByRole('button', { name: 'Manage Coca-Cola Original', exact: true }).click()
        await page.getByRole('button', { name: 'Adjust stock for Coca-Cola Original', exact: true }).click()
        console.log(JSON.stringify({ width, dialog: await page.getByRole('dialog').evaluate(dialog => {
          const rect = dialog.getBoundingClientRect()
          const input = dialog.querySelector('input[placeholder], textarea[placeholder]')
          const style = getComputedStyle(input), canvas = document.createElement('canvas').getContext('2d')
          canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          return { left: rect.left, right: rect.right, viewport: innerWidth, available: input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), placeholderWidth: canvas.measureText(input.placeholder).width }
        }) }))
        if (process.argv[3] === 'debug') console.log(JSON.stringify(await page.evaluate(() => ({
          elements: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > 320 && !node.closest('.modal-backdrop') && node.getClientRects().length).map(node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { tag: node.tagName, cls: node.className, text: node.textContent.slice(0, 50), left: r.left, right: r.right, width: s.width, min: s.minWidth, max: s.maxWidth, box: s.boxSizing, position: s.position } }),
        }))))
        await page.getByRole('textbox', { name: 'Reason', exact: true }).pressSequentially('Received 24 units', { delay: 20 })
        console.log(JSON.stringify({ width, stockReasonRetained: await page.getByRole('textbox', { name: 'Reason', exact: true }).inputValue() === 'Received 24 units' }))
        if (width === 320 || width === 412) await page.screenshot({ path: path.join(output, `${width}-Stock-dialog.png`) })
        await page.getByRole('button', { name: 'Close dialog' }).click()
        if (process.argv[3] === 'debug') { console.log(JSON.stringify(await page.evaluate(() => {
          const nav = document.querySelector('.main-nav'), r = nav.getBoundingClientRect(), b = nav.querySelector('[aria-label="Sales history"]').getBoundingClientRect()
          return { nav: { x: r.x, y: r.y, width: r.width, height: r.height, z: getComputedStyle(nav).zIndex }, viewport: { width: innerWidth, height: innerHeight, visual: visualViewport.height, offset: visualViewport.offsetTop }, hit: document.elementsFromPoint(b.x + b.width / 2, b.y + b.height / 2).slice(0, 5).map(e => e.className || e.tagName) }
        }))); break }
      }
    }
    await context.close()
  }
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
