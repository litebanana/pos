import { db, logAction, requireOwner, stockLog, type Product } from './db'
import { categoryColor, validateProduct } from './validation'
import { stockFactor } from './pricing'

const headers = ['barcode', 'name', 'price', 'category', 'stock', 'low_stock']
const expandedHeaders = [...headers, 'cost', 'variant', 'modifiers', 'unit']
function csvRows(text: string) {
  if (new Blob([text]).size > 2 * 1024 * 1024) throw new Error('Choose a catalog CSV smaller than 2 MB.')
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false, closed = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else field += char
    } else if (char === '"' && !field && !closed) quoted = true
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field); field = ''; closed = false
      if (char !== ',') {
        if (char === '\r' && text[i + 1] === '\n') i++
        if (row.some(value => value !== '')) rows.push(row)
        row = []
      }
    } else {
      if (closed || char === '"') throw new Error('Invalid CSV quoting.')
      field += char
    }
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field.')
  row.push(field)
  if (row.some(value => value !== '')) rows.push(row)
  return rows
}
export function parseCatalog(text: string): Product[] {
  const rows = csvRows(text)
  const expanded = rows[0]?.join(',') === expandedHeaders.join(',')
  if (rows.length < 2 || rows.length > 20_001 || (!expanded && rows[0].join(',') !== headers.join(','))) throw new Error('Use the exported CSV template. Maximum 20,000 products.')
  const seen = new Set<string>()
  return rows.slice(1).map((row, index) => {
    row = row.map(value => /^'[=+\-@\t\r']/.test(value) ? value.slice(1) : value)
    if (row.length !== (expanded ? 10 : 6) || !/^\d+(\.\d{1,2})?$/.test(row[2]) || (expanded && row[6] && !/^\d+(\.\d{1,2})?$/.test(row[6]))) throw new Error(`Check the price and columns on CSV row ${index + 2}.`)
    if (expanded && row[9] && row[9] !== 'kg') throw new Error(`Invalid selling unit on row ${index + 2}. Use kg or leave empty for pieces.`)
    const factor = expanded && row[9] === 'kg' ? 1000 : 1
    for (const value of row.slice(4, 6)) if (value !== '' && !(factor === 1000 ? /^\d+(\.\d{1,3})?$/ : /^\d+$/).test(value)) throw new Error(`Check the stock quantity on row ${index + 2}.`)
    const product = validateProduct({ barcode: row[0], name: row[1], price: Math.round(Number(row[2]) * 100), category: row[3], color: categoryColor(row[3]), ...(factor === 1000 ? { unit: 'kg' } : {}), ...(row[4] !== '' ? { stock: Math.round(Number(row[4]) * factor) } : {}), ...(row[5] !== '' ? { lowStock: Math.round(Number(row[5]) * factor) } : {}), ...(expanded && row[6] ? { cost: Math.round(Number(row[6]) * 100) } : {}), ...(expanded && row[7] ? { variant: row[7] } : {}), ...(expanded && row[8] ? { modifiers: JSON.parse(row[8]) } : {}) })
    if (seen.has(product.barcode)) throw new Error(`Duplicate barcode on row ${index + 2}: ${product.barcode}`)
    seen.add(product.barcode)
    return product
  })
}
export function catalogCSV(products: Product[]) {
  // Prefix spreadsheet formulas for safe viewing. The importer reverses only our export prefix.
  const cell = (value: string) => `"${(/^[=+\-@\t\r']/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`
  return '\uFEFF' + expandedHeaders.join(',') + '\r\n' + products.map(product => [product.barcode, product.name, (product.price / 100).toFixed(2), product.category, product.stock === undefined ? '' : String(product.stock / stockFactor(product)), product.lowStock === undefined ? '' : String(product.lowStock / stockFactor(product)), product.cost === undefined ? '' : (product.cost / 100).toFixed(2), product.variant ?? '', product.modifiers?.length ? JSON.stringify(product.modifiers) : '', product.unit ?? ''].map(cell).join(',')).join('\r\n')
}
export async function importCatalog(products: Product[]) {
  // Preview data is revalidated before the atomic upsert; sales snapshots are unaffected.
  const normalized = products.map(product => validateProduct(product))
  if (new Set(normalized.map(product => product.barcode)).size !== normalized.length) throw new Error('The CSV contains duplicate barcodes.')
  await db.transaction('rw', db.products, db.settings, db.audit, db.employees, db.stockMovements, async () => {
    await requireOwner()
    const existing = await db.products.toArray()
    const byBarcode = new Map(existing.map(product => [product.barcode, product.id]))
    if (existing.length + normalized.filter(product => !byBarcode.has(product.barcode)).length > 20_000) throw new Error('The catalog would exceed 20,000 products.')
    await db.products.bulkPut(normalized.map(product => ({ ...product, id: byBarcode.get(product.barcode) })))
    for (const product of normalized) if (product.stock !== undefined) { const old = existing.find(item => item.barcode === product.barcode); if (old?.stock !== product.stock) { const saved = await db.products.where('barcode').equals(product.barcode).first(); await stockLog(saved!, old?.stock ?? 0, product.stock, 'Catalog CSV import') } }
    await logAction('catalog', `Imported ${normalized.length} products from CSV`)
  })
}
