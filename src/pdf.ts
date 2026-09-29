import { jsPDF } from 'jspdf'
import reportFont from './assets/NotoSans-Regular.ttf?url'
import { dateLabel, reportTotals, type Report, type Sale, type Scan, type Correction } from './db'
import { lineAmount } from './pricing'

let cachedFont: Promise<string> | undefined
async function getFont() {
  if (!cachedFont) cachedFont = fetch(reportFont).then(async response => {
    if (!response.ok) throw new Error('The report font is not available. Open the app once online to complete offline setup.')
    const bytes = new Uint8Array(await response.arrayBuffer())
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return btoa(binary)
  }).catch(error => { cachedFont = undefined; throw error })
  return cachedFont
}
export async function createPDF(report: Report, receipt?: { sale: Sale; corrections?: Correction[] }) {
  const { session, scans } = report
  const font = await getFont()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: session.paper, compress: true })
  doc.addFileToVFS('NotoSans.ttf', font)
  doc.addFont('NotoSans.ttf', 'NotoSans', 'normal')
  doc.setFont('NotoSans')
  doc.setProperties({ title: `${session.storeName || 'Store'} — ${receipt ? 'Sales receipt' : 'Daily sales report'} — ${session.date}`, author: 'Tindahan', subject: receipt ? 'Sales receipt' : 'Daily sales report' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const left = 17, right = width - 17
  const number = receipt ? `Receipt #${String(receipt.sale.id).padStart(6, '0')}` : `TD-${session.date.replaceAll('-', '')}-${String(session.id).padStart(3, '0')}`
  const currency = (value: number) => `₱ ${new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100)}`
  let y = 0
  const header = (continued = false) => {
    doc.setTextColor(24, 92, 69)
    doc.setFontSize(11)
    doc.text('Tindahan', left, 20)
    doc.setTextColor(31, 33, 48)
    doc.setFontSize(21)
    const nameLines = doc.splitTextToSize(session.storeName || 'My store', right - left) as string[]
    doc.text(nameLines, left, 34)
    y = 34 + (nameLines.length - 1) * 8 + 9
    doc.setFontSize(11)
    doc.text(`${receipt ? 'Sales receipt' : 'Daily sales report'}${continued ? ' · continued' : ''}`, left, y)
    y += 8
    doc.setTextColor(104, 108, 125)
    doc.setFontSize(9)
    doc.text(dateLabel(session.date, true), left, y)
    doc.text(number, right, y, { align: 'right' })
    y += 10
    if (receipt) {
      const lines = doc.splitTextToSize(`Operator: ${receipt.sale.operator} · Payment: ${receipt.sale.payment}`, right - left) as string[]
      doc.text(lines, left, y)
      y += lines.length * 4 + 6
    }
    doc.setFillColor(240, 244, 240)
    doc.roundedRect(left, y, right - left, 11, 1, 1, 'F')
    doc.setTextColor(72, 73, 91)
    doc.text('PRODUCT', left + 3, y + 7)
    doc.text('QTY', right - 70, y + 7, { align: 'right' })
    doc.text('UNIT PRICE', right - 36, y + 7, { align: 'right' })
    doc.text('SUBTOTAL', right - 3, y + 7, { align: 'right' })
    y += 17
  }
  header()
  for (const scan of scans) {
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(scan.name + (scan.note ? ` · ${scan.note}` : ''), right - left - 83) as string[]
    doc.setFontSize(7)
    const barcodeLines = doc.splitTextToSize(scan.barcode, right - left - 83) as string[]
    const rowHeight = Math.max(16, lines.length * 4.5 + barcodeLines.length * 3.5 + 5)
    if (y + rowHeight > height - 32) { doc.addPage(); header(true) }
    doc.setFontSize(9)
    doc.setTextColor(31, 33, 48)
    doc.text(lines, left + 3, y)
    doc.text(String(scan.quantity), right - 70, y, { align: 'right' })
    doc.text(currency(scan.price), right - 36, y, { align: 'right' })
    doc.text(currency(lineAmount(scan)), right - 3, y, { align: 'right' })
    doc.setFontSize(7)
    doc.setTextColor(125, 128, 142)
    doc.text(barcodeLines, left + 3, y + lines.length * 4.5)
    doc.setDrawColor(234, 235, 241)
    doc.line(left, y + rowHeight - 5, right, y + rowHeight - 5)
    y += rowHeight
  }
  const notes = receipt?.corrections ?? report.corrections ?? []
  for (const correction of notes) {
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(`${correction.action === 'void' ? 'Void' : 'Refund'} · Sale #${correction.saleId} · ${correction.reason} · ${currency(correction.amount)}`, right - left - 6) as string[]
    const rowHeight = lines.length * 4.5 + 8
    if (y + rowHeight > height - 32) { doc.addPage(); header(true) }
    doc.setTextColor(151, 40, 40)
    doc.text(lines, left + 3, y + 4)
    y += rowHeight
  }
  const sum = reportTotals(report)
  if (receipt) {
    const details = [receipt.sale.customerName ? `Customer: ${receipt.sale.customerName}` : '', receipt.sale.notes ? `Note: ${receipt.sale.notes}` : '', receipt.sale.discount ? `Discounts: ${currency(receipt.sale.discount)}` : '', receipt.sale.tax ? `Tax (${receipt.sale.taxMode}): ${currency(receipt.sale.tax)}` : '', receipt.sale.customerName ? `Loyalty points earned: ${((receipt.sale.earned ?? 0) / 100).toFixed(2)} · redeemed: ${((receipt.sale.redeemed ?? 0) / 100).toFixed(2)}` : '', ...(receipt.sale.payments?.map(part => `${part.method}${part.ref ? ` ref ${part.ref}` : ''}: ${currency(part.amount)}`) ?? [])].filter(Boolean)
    for (const detail of details) { const lines = doc.splitTextToSize(detail, right - left) as string[]; if (y + lines.length * 5 + 10 > height - 32) { doc.addPage(); header(true) }; doc.setFontSize(9); doc.setTextColor(31, 33, 48); doc.text(lines, left, y + 4); y += lines.length * 5 + 3 }
  }
  if (y + 62 > height - 28) { doc.addPage(); header(true) }
  doc.setFillColor(240, 244, 240)
  doc.roundedRect(left, y + 1, right - left, 50, 2, 2, 'F')
  doc.setTextColor(65, 64, 87)
  doc.setFontSize(10)
  doc.text(receipt ? `TOTAL · ${sum.items} items` : `NET SALES · ${sum.items} items sold`, left + 5, y + 13)
  doc.setTextColor(24, 92, 69)
  doc.setFontSize(16)
  doc.text(currency(receipt ? receipt.sale.total : sum.value), right - 5, y + 14, { align: 'right' })
  doc.setFontSize(10)
  doc.setTextColor(65, 64, 87)
  doc.text(receipt ? 'Amount received' : 'Gross sales', left + 5, y + 27)
  doc.text(currency(receipt ? receipt.sale.tendered : sum.gross), right - 5, y + 27, { align: 'right' })
  doc.text(receipt ? 'Change' : 'Voids and refunds', left + 5, y + 40)
  doc.text(currency(receipt ? receipt.sale.change : sum.refunds), right - 5, y + 40, { align: 'right' })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setDrawColor(231, 232, 238)
    doc.line(left, height - 19, right, height - 19)
    doc.setFontSize(7)
    doc.setTextColor(125, 128, 142)
    doc.text('Prepared with Tindahan · All amounts in Philippine pesos (PHP)', left, height - 13)
    doc.text(`Page ${page} of ${pages}`, right, height - 13, { align: 'right' })
  }
  return doc
}
export async function createReceiptPDF(sale: Sale, scans: Scan[], correction?: Correction | Correction[]) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(sale.createdAt))
  const date = `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`
  return createPDF({ session: { id: sale.id, date, status: 'closed', storeName: sale.storeName, paper: 'a4', createdAt: sale.createdAt, closedAt: sale.createdAt }, scans }, { sale, corrections: correction ? Array.isArray(correction) ? correction : [correction] : [] })
}
export function pdfFilename(report: Report) {
  return `Tindahan-${report.session.date}-${report.session.id}.pdf`
}
