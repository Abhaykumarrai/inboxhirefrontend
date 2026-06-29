import { getApiBaseUrl } from './config'

const BASE_URL = getApiBaseUrl()

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function getToken(): string | null {
  return localStorage.getItem('token')
}

function getErrorDetail(data: unknown) {
  return typeof data === 'object' && data !== null && 'detail' in data
    ? String((data as { detail?: unknown }).detail)
    : undefined
}

async function request(path: string, options: RequestInit = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  }

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  const contentType = res.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await res.json() : await res.blob()

  if (res.status === 401) {
    if (token) {
      localStorage.removeItem('token')
      sessionStorage.removeItem('must_change_password')
      window.location.href = '/'
    }
    throw new ApiError(getErrorDetail(data) || 'Unauthorized', 401)
  }

  if (!res.ok) {
    throw new ApiError(getErrorDetail(data) || 'Something went wrong', res.status)
  }

  return data
}

export const api = {
  get: (path: string) => request(path),
  post: (path: string, body?: unknown) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path: string, body?: unknown) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path: string, body?: unknown) => request(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request(path, { method: 'DELETE' }),
}
