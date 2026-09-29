export interface OwnerCredential { salt: string; hash: string; iterations: number }
export const keyIterations = 600_000
let unlockedHash = ''
let expiresAt = 0
let attempts = 0
let retryAt = 0
let expiryTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
export const subscribeOwner = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const ownerSnapshot = () => unlockedHash
const emit = () => listeners.forEach(listener => listener())
export function lockOwner() { unlockedHash = ''; expiresAt = 0; clearTimeout(expiryTimer); emit() }
export function assertOwner(credential?: OwnerCredential) {
  if (credential && (credential.hash !== unlockedHash || Date.now() >= expiresAt)) {
    lockOwner()
    throw new Error('Unlock owner access in Settings to continue.')
  }
}
export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
export const base64ToBytes = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0))
export async function passwordKey(password: string, salt: Uint8Array, iterations = keyIterations) {
  if (!globalThis.crypto?.subtle) throw new Error('Owner PINs and encrypted backups require HTTPS. Open the app on its secure address.')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}
export async function createOwnerCredential(pin: string): Promise<OwnerCredential> {
  if (!/^\d{6,12}$/.test(pin)) throw new Error('Use an owner PIN with 6 to 12 digits.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await passwordKey(pin, salt)
  return { salt: bytesToBase64(salt), hash: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key))), iterations: keyIterations }
}
export async function unlockOwner(pin: string, credential: OwnerCredential) {
  if (Date.now() < retryAt) throw new Error('Too many attempts. Wait 30 seconds before trying again.')
  const key = await passwordKey(pin, base64ToBytes(credential.salt), credential.iterations)
  const candidate = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const expected = base64ToBytes(credential.hash)
  let different = candidate.length ^ expected.length
  for (let i = 0; i < candidate.length; i++) different |= candidate[i] ^ (expected[i] ?? 0)
  if (different) {
    if (++attempts >= 5) { retryAt = Date.now() + 30_000; attempts = 0 }
    throw new Error('Incorrect owner PIN.')
  }
  attempts = 0
  unlockedHash = credential.hash
  expiresAt = Date.now() + 15 * 60_000
  clearTimeout(expiryTimer)
  expiryTimer = setTimeout(lockOwner, 15 * 60_000)
  emit()
}
