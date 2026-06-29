import { api } from './api'
import { getOAuthBaseUrl } from './config'

export type DriveConnectionApi = {
  id?: string
  google_email?: string | null
  drive_email?: string | null
  gmail_email?: string | null
  email?: string | null
  folder_id: string | null
  folder_name: string | null
  status?: string
}

export type DriveFolderApi = {
  id: string
  name: string
}

export async function fetchDriveConnection(): Promise<DriveConnectionApi | null> {
  try {
    const data = await api.get('/api/drive/connection')
    if (!data || typeof data !== 'object') return null
    return data as DriveConnectionApi
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : ''
    if (message.includes('not found') || message.includes('404')) return null
    throw err
  }
}

export function getDriveConnection() {
  return fetchDriveConnection()
}

export function getDriveFolders() {
  return api.get('/api/drive/folders') as Promise<DriveFolderApi[]>
}

export function setDriveFolder(folderId: string) {
  return api.patch('/api/drive/folder', { folder_id: folderId })
}

export function disconnectDriveConnection() {
  return api.delete('/api/drive/connection')
}

export function buildDriveConnectUrl() {
  const token = localStorage.getItem('token')
  const baseUrl = getOAuthBaseUrl()
  return `${baseUrl}/api/drive/connect?token=${encodeURIComponent(token || '')}`
}

export function openDriveConnectPopup(): Window | null {
  if (!localStorage.getItem('token')) return null

  const width = 520
  const height = 720
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2)
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2)

  return window.open(
    buildDriveConnectUrl(),
    'inboxhire_drive_oauth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  )
}

function wait(ms: number, signal?: AbortSignal, popup?: Window | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Drive connect cancelled'))
      return
    }
    if (popup?.closed) {
      reject(new Error('Drive connect cancelled'))
      return
    }

    const step = 250
    let elapsed = 0

    const tick = () => {
      if (signal?.aborted) {
        reject(new Error('Drive connect cancelled'))
        return
      }
      if (popup?.closed) {
        reject(new Error('Drive connect cancelled'))
        return
      }

      if (elapsed >= ms) {
        resolve()
        return
      }

      const chunk = Math.min(step, ms - elapsed)
      elapsed += chunk
      setTimeout(tick, chunk)
    }

    signal?.addEventListener('abort', () => {
      reject(new Error('Drive connect cancelled'))
    }, { once: true })

    tick()
  })
}

export async function pollForDriveConnection(
  options: {
    intervalMs?: number
    timeoutMs?: number
    signal?: AbortSignal
    popup?: Window | null
  } = {},
): Promise<DriveConnectionApi> {
  const { intervalMs = 2000, timeoutMs = 120000, signal, popup } = options
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Drive connect cancelled')
    if (popup?.closed) throw new Error('Drive connect cancelled')

    try {
      const connection = await getDriveConnection()
      if (connection) return connection
    } catch {
      /* keep polling until timeout */
    }

    await wait(intervalMs, signal, popup)
  }

  throw new Error('Drive connect timed out')
}

export function driveHasFolder(connection: DriveConnectionApi | null) {
  return Boolean(connection?.folder_id)
}

export function getDriveAccountEmail(connection: DriveConnectionApi | null) {
  if (!connection) return null
  return (
    connection.google_email
    ?? connection.drive_email
    ?? connection.gmail_email
    ?? connection.email
    ?? null
  )
}
