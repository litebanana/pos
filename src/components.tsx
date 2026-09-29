import { Component, isValidElement, useEffect, useRef, useState, type ReactNode, type ErrorInfo } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { categories, categoryColor, changeCartQuantity, type Product, type CartItem } from './db'
import { runWork, setFormDirty, useWorkState } from './work'
import { stockFactor } from './pricing'

export function Required() { return <span className="required-mark" aria-hidden="true"> *</span> }
export function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  const marked = required || (isValidElement<{ required?: boolean }>(children) && children.props.required)
  return <label className="field"><span>{label}{marked && <Required />}</span>{children}</label>
}
export function Modal({ title, children, onClose, wide = false, busy = false, printable = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean; printable?: boolean }) {
  const [, , saving] = useWorkState()
  busy = busy || saving
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose), busyRef = useRef(busy)
  close.current = onClose; busyRef.current = busy
  useEffect(() => {
    const previous = document.activeElement
    const shell = document.querySelector<HTMLElement>('.app-shell')
    if (shell) shell.inert = true
    document.body.classList.add('modal-open')
    const el = ref.current!
    const focusable = () => Array.from(el.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, a[href], [tabindex="0"]')).filter(node => node.getClientRects().length)
    ;(el.querySelector<HTMLElement>('[data-autofocus]') || focusable()[0])?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) close.current()
      if (event.key === 'Tab') {
        const nodes = focusable(), first = nodes[0], last = nodes[nodes.length - 1]
        if (!nodes.length) { event.preventDefault(); el.focus() }
        else if (event.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.body.classList.remove('modal-open')
      if (shell) shell.inert = false
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])
  return createPortal(<div className="modal-backdrop" onChange={event => { if ((event.target as Element).closest('[data-edit-form]')) setFormDirty(true) }} onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}><div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''} ${printable ? 'receipt-document' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" disabled={busy} aria-label="Close dialog" onClick={onClose}><X size={22} /></button></div>{children}</div></div>, document.body)
}
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="check-field"><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />{label}</label>
}
export function ProductForm({ product, barcode, onSave, onCancel, scanAfter = false }: { product?: Product; barcode?: string; onSave: (product: Product) => Promise<void>; onCancel: () => void; scanAfter?: boolean }) {
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const [unit, setUnit] = useState(product?.unit ?? 'piece')
  return <form onSubmit={async event => {
    event.preventDefault()
    if (saving) return
    const data = new FormData(event.currentTarget), priceText = String(data.get('price'))
    if (!/^\d+(\.\d{1,2})?$/.test(priceText)) { setError('Enter a price with up to two decimal places.'); return }
    const stock = String(data.get('stock') || ''), lowStock = String(data.get('lowStock') || ''), category = String(data.get('category')), costText = String(data.get('cost') || '')
    if (costText && !/^\d+(\.\d{1,2})?$/.test(costText)) { setError('Enter a cost with up to two decimal places.'); return }
    const modifierNames = data.getAll('modifierName').map(String), modifierPrices = data.getAll('modifierPrice').map(String)
    const modifiers = modifierNames.map((name, i) => ({ name: name.trim(), price: Math.round(Number(modifierPrices[i]) * 100) })).filter(modifier => modifier.name)
    setSaving(true); setError('')
    try { await runWork(() => onSave({ id: product?.id, barcode: String(data.get('barcode')).trim(), name: String(data.get('name')).trim(), price: Math.round(Number(priceText) * 100), category, color: categoryColor(category), ...(unit === 'kg' ? { unit: 'kg' as const } : {}), ...(stock !== '' ? { stock: Math.round(Number(stock) * (unit === 'kg' ? 1000 : 1)) } : {}), ...(lowStock !== '' ? { lowStock: Math.round(Number(lowStock) * (unit === 'kg' ? 1000 : 1)) } : {}), ...(costText ? { cost: Math.round(Number(costText) * 100) } : {}), ...(data.get('variant') ? { variant: String(data.get('variant')).trim() } : {}), ...(modifiers.length ? { modifiers } : {}) })); setFormDirty(false) }
    catch (err) { setError(err instanceof Error && err.name === 'ConstraintError' ? 'This barcode already belongs to another product.' : err instanceof Error ? err.message : 'The product could not be saved.') }
    finally { setSaving(false) }
  }} data-edit-form>
    <p className="form-note">Fields marked <Required /> are required.</p>
    {scanAfter && <p className="notice">This barcode is new. Save the product to add it to the cart.</p>}
    <Field label="Barcode" required><input name="barcode" required maxLength={100} defaultValue={product?.barcode || barcode || ''} readOnly={scanAfter} data-autofocus={!scanAfter && !product ? '' : undefined} /></Field>
    <Field label="Product name" required><input name="name" required maxLength={120} defaultValue={product?.name || ''} data-autofocus={scanAfter || product ? '' : undefined} /></Field>
    <Field label="Sell by" required><select value={unit} onChange={event => setUnit(event.target.value)}><option value="piece">Piece / pack</option><option value="kg">Weight (kilogram)</option></select></Field>{unit === 'kg' && <p className="form-note">Enter price and cost per kilogram, and stock in kilograms. You will enter the bag's weight when adding it to the cart.</p>}
    <div className="form-grid"><Field label="Unit price (₱)" required><input type="number" name="price" required min="0" max="999999.99" step="0.01" inputMode="decimal" defaultValue={product ? (product.price / 100).toFixed(2) : ''} /></Field><Field label="Category" required><select name="category" required defaultValue={product?.category || 'Other'}>{categories.map(category => <option key={category}>{category}</option>)}</select></Field></div>
    <div className="form-grid"><Field label={unit === 'kg' ? 'Stock quantity (kg)' : 'Stock quantity'}><input type="number" name="stock" min="0" max={unit === 'kg' ? 1000000 : 1000000000} step={unit === 'kg' ? '.001' : '1'} defaultValue={product?.stock === undefined ? '' : product.stock / stockFactor(product)} /></Field><Field label={unit === 'kg' ? 'Low-stock alert at (kg)' : 'Low-stock alert at'}><input type="number" name="lowStock" min="0" max={unit === 'kg' ? 1000000 : 1000000000} step={unit === 'kg' ? '.001' : '1'} defaultValue={product?.lowStock === undefined ? '' : product.lowStock / stockFactor(product)} /></Field></div>
    <p className="form-note">Leave stock empty to sell without stock tracking. Use Adjust stock to record restocks and corrections.</p>
    <details className="product-extras"><summary>Cost, variant, and add-ons</summary><Field label="Unit cost (₱)"><input type="number" name="cost" min="0" max="999999.99" step="0.01" defaultValue={product?.cost === undefined ? '' : (product.cost / 100).toFixed(2)} /></Field><Field label="Variant (size, color, or pack)"><input name="variant" maxLength={100} defaultValue={product?.variant ?? ''} placeholder="e.g. Large bottle" /></Field><p className="form-note">Create each variant as its own product with a unique barcode. Add-ons change the selling price; their stock is not tracked separately.</p>{Array.from({ length: Math.max(3, product?.modifiers?.length ?? 0) }, (_, i) => <div className="form-grid" key={i}><Field label={`Add-on ${i + 1} name`}><input name="modifierName" maxLength={40} defaultValue={product?.modifiers?.[i]?.name ?? ''} /></Field><Field label={`Add-on ${i + 1} price (₱)`}><input name="modifierPrice" type="number" min="0" max="999999.99" step="0.01" defaultValue={((product?.modifiers?.[i]?.price ?? 0) / 100).toFixed(2)} /></Field></div>)}</details>
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="actions"><button type="button" className="button secondary" disabled={saving} onClick={onCancel}>Cancel</button><button className="button primary" disabled={saving}>{saving ? 'Saving…' : scanAfter ? 'Save & add to cart' : 'Save product'}</button></div>
  </form>
}
export function QuantityControl({ row, onError, onDone }: { row: CartItem; onError: (error: unknown) => void; onDone?: () => void }) {
  const [value, setValue] = useState(String(row.quantity))
  useEffect(() => setValue(String(row.quantity)), [row.quantity])
  async function commit(quantity: number, relative = false) {
    try { if (relative || quantity !== row.quantity) await runWork(() => changeCartQuantity(row.id!, quantity, relative)); onDone?.() }
    catch (error) { setValue(String(row.quantity)); onError(error) }
  }
  return <div className="quantity-control"><button type="button" className="icon-button" disabled={row.quantity <= 1} aria-label={`Decrease ${row.name} quantity`} onMouseDown={event => event.preventDefault()} onClick={() => void commit(-1, true)}><Minus size={16} /></button><input required aria-label={`${row.name} quantity`} type="number" min="1" max="9999" step="1" inputMode="numeric" value={value} onChange={event => setValue(event.target.value)} onFocus={event => event.target.select()} onBlur={() => void commit(Number(value))} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /><button type="button" className="icon-button" disabled={row.quantity >= 9999} aria-label={`Increase ${row.name} quantity`} onMouseDown={event => event.preventDefault()} onClick={() => void commit(1, true)}><Plus size={16} /></button></div>
}
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('App storage or rendering failure', error, info.componentStack) }
  render() {
    if (this.state.failed) return <main className="recovery-screen" role="alert"><h1>Unable to open your store</h1><p>The app could not read its data. Your records have not been reset.</p><p>Check that this browser allows site storage, then reload. Keep existing backup files and avoid clearing site data.</p><button className="button primary" onClick={() => window.location.reload()}>Reload app</button></main>
    return this.props.children
  }
}
