// One policy supplies the production preview, built HTML, and deployment artifacts.
export const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ')

// frame-ancestors is only enforced in HTTP headers, not in a CSP meta element.
export const offlineContentSecurityPolicy = contentSecurityPolicy.split('; ').filter(directive => !directive.startsWith('frame-ancestors ')).join('; ')
export const commonSecurityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
}
export const securityHeaders = { ...commonSecurityHeaders, 'Content-Security-Policy': contentSecurityPolicy }
export const httpsSecurityHeaders = { ...securityHeaders, 'Strict-Transport-Security': 'max-age=31536000' }
export function staticHostHeaders() {
  return `/*\n${Object.entries(httpsSecurityHeaders).map(([key, value]) => `  ${key}: ${value}`).join('\n')}\n  Cache-Control: no-cache\n`
}
export function nginxSecurityHeaders() {
  return `# Generated from security/headers.ts. Include inside your HTTPS server block.\n${Object.entries(httpsSecurityHeaders).map(([key, value]) => `add_header ${key} "${value}" always;`).join('\n')}\n`
}
