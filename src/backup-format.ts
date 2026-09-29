import { backupLimits, validateBackup } from './validation'
import { base64ToBytes, bytesToBase64, keyIterations, passwordKey } from './owner'

export const maxBackupFileBytes = 36 * 1024 * 1024
export function serializeBackup(raw: unknown) {
  const json = JSON.stringify(validateBackup(raw))
  if (new Blob([json]).size > backupLimits.bytes) throw new Error('The full backup exceeds the 25 MB restore limit. No unusable backup was downloaded. Contact support before adding more records.')
  return json
}
export async function encodeBackup(raw: unknown, password = '') {
  const json = serializeBackup(raw)
  if (!password) return json
  if (password.length < 12 || password.length > 200) throw new Error('Use a backup password with 12 to 200 characters.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await passwordKey(password, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json))
  return JSON.stringify({ app: 'Tindahan', encryptedBackup: 1, iterations: keyIterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) })
}
export async function decodeBackup(contents: string, password = '') {
  if (new Blob([contents]).size > maxBackupFileBytes) throw new Error('This backup file is too large.')
  const raw: unknown = JSON.parse(contents)
  if (raw && typeof raw === 'object' && 'encryptedBackup' in raw) {
    const value = raw as Record<string, unknown>
    if (value.app !== 'Tindahan' || value.encryptedBackup !== 1 || value.iterations !== keyIterations || typeof value.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value.salt) || typeof value.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(value.iv) || typeof value.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) throw new Error('Invalid encrypted backup format.')
    if (!password) throw new Error('Enter the password used to encrypt this backup.')
    if (password.length > 200) throw new Error('The backup password is too long.')
    try {
      const key = await passwordKey(password, base64ToBytes(value.salt))
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(value.iv) }, key, base64ToBytes(value.data))
      if (bytes.byteLength > backupLimits.bytes) throw new Error('size')
      return validateBackup(JSON.parse(new TextDecoder().decode(bytes)))
    } catch { throw new Error('The password is incorrect, or the encrypted backup is damaged or unsupported.') }
  }
  if (new Blob([contents]).size > backupLimits.bytes) throw new Error('Choose a backup smaller than 25 MB.')
  return validateBackup(raw)
}
