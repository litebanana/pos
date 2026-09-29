import type { Page } from '@playwright/test'

export async function productAction(page: Page, action: 'Edit' | 'Adjust stock' | 'Delete', product = 'Coca-Cola Original') {
  const name = `${action === 'Adjust stock' ? 'Adjust stock for' : action} ${product}`
  const button = page.getByRole('button', { name, exact: true })
  if (!await button.isVisible()) await page.getByRole('button', { name: `Manage ${product}`, exact: true }).click()
  await button.click()
}
