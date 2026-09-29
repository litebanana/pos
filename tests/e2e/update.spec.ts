import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { securityHeaders } from '../../security/headers'

test('a service-worker update waits for another window’s unsaved form and preserves the cart', async ({ page, context }) => {
  let revision = 1
  const root = resolve('dist')
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!file.startsWith(root + '/') && !file.startsWith(root + '\\')) { response.writeHead(404); response.end(); return }
    try {
      let bytes = await readFile(file)
      if (pathname === '/sw.js') bytes = Buffer.concat([bytes, Buffer.from(`\n// Release ${revision}\n`)])
      response.writeHead(200, { ...securityHeaders, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      response.end(bytes)
    } catch { response.writeHead(404); response.end() }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not start.')
  const origin = `http://127.0.0.1:${address.port}`
  let other: Awaited<ReturnType<typeof context.newPage>> | undefined
  try {
    await page.goto(origin)
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    const input = page.getByRole('textbox', { name: 'Scan or enter barcode' })
    await input.fill('4800016000013'); await input.press('Enter')
    await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('1')
    other = await context.newPage(); await other.goto(origin)
    await other.getByRole('navigation').getByRole('button', { name: 'Products', exact: true }).click()
    await other.getByRole('button', { name: 'Add product', exact: true }).click()
    await other.getByLabel('Product name').fill('Unsaved product')
    revision = 2
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update() })
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toBeDisabled()
    await other.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toBeEnabled()
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update app', exact: true }).click()])
    await expect(page.getByRole('spinbutton', { name: 'Coca-Cola Original quantity' })).toHaveValue('1')
    await expect(page.getByRole('button', { name: 'Update app', exact: true })).toHaveCount(0)
  } finally {
    await other?.close(); await page.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
