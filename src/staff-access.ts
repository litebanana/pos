import { base64ToBytes, passwordKey } from './owner'
import type { Employee } from './retail-types'

let signedIn: { id: number; hash: string; expires: number } | undefined
let failures = 0, retryAt = 0
export function staffSession() { if (signedIn && signedIn.expires <= Date.now()) signedIn = undefined; return signedIn }
export function signOutStaff() { signedIn = undefined }
export async function verifyStaffPin(employee: Employee, pin: string) {
  if (!employee.active) throw new Error('This employee is inactive.')
  if (Date.now() < retryAt) throw new Error('Too many attempts. Wait 30 seconds before trying again.')
  const key = await passwordKey(pin, base64ToBytes(employee.credential.salt), employee.credential.iterations)
  const actual = new Uint8Array(await crypto.subtle.exportKey('raw', key)), expected = base64ToBytes(employee.credential.hash)
  let difference = actual.length ^ expected.length
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ (expected[i] ?? 0)
  if (difference) { if (++failures >= 5) { retryAt = Date.now() + 30_000; failures = 0 }; throw new Error('Incorrect employee PIN.') }
  failures = 0
}
export function acceptStaff(employee: Employee) { signedIn = { id: employee.id!, hash: employee.credential.hash, expires: Date.now() + 8 * 60 * 60_000 } }
