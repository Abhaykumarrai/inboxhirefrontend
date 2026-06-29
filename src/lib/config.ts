/** API base for fetch calls. Empty string = same-origin (Vercel /api proxy). */
export function getApiBaseUrl(): string {
  return String(import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
}

/** OAuth popups must hit the real backend, not a same-origin proxy. */
export function getOAuthBaseUrl(): string {
  const oauthBase = String(import.meta.env.VITE_OAUTH_BASE_URL || '').replace(/\/$/, '')
  if (oauthBase) return oauthBase

  const apiBase = getApiBaseUrl()
  if (apiBase) return apiBase

  throw new Error('VITE_OAUTH_BASE_URL is required when VITE_API_URL is empty')
}
