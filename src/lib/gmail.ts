import { api } from './api'

export type GmailConnectionApi = {
  id: string
  gmail_email: string
  status: string
  assigned_user_id: string | null
  created_at: string
}

export type GmailConnectionUi = {
  id: string
  email: string
  status: 'active' | 'needs_reconnect'
  assignedMemberId: string | null
  createdAt: string
}

export function mapGmailConnection(apiConn: GmailConnectionApi): GmailConnectionUi {
  return {
    id: apiConn.id,
    email: apiConn.gmail_email,
    status: apiConn.status === 'connected' ? 'active' : 'needs_reconnect',
    assignedMemberId: apiConn.assigned_user_id,
    createdAt: apiConn.created_at,
  }
}

export function getGmailConnections() {
  return api.get('/api/gmail-connections') as Promise<GmailConnectionApi[]>
}

export async function fetchGmailConnectionsForUi() {
  const list = await getGmailConnections()
  return list.map(mapGmailConnection)
}

export function assignGmailConnection(connectionId: string, userId: string) {
  return api.patch(`/api/gmail-connections/${connectionId}/assign`, { user_id: userId })
}

export function disconnectGmailConnection(connectionId: string) {
  return api.delete(`/api/gmail-connections/${connectionId}`)
}

export function buildGmailConnectUrl() {
  const token = localStorage.getItem('token')
  const baseUrl = import.meta.env.VITE_API_URL
  return `${baseUrl}/api/auth/gmail/connect?token=${encodeURIComponent(token || '')}`
}

export function openGmailConnectPopup(): Window | null {
  if (!localStorage.getItem('token')) return null

  const width = 520
  const height = 720
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2)
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2)

  return window.open(
    buildGmailConnectUrl(),
    'inboxhire_gmail_oauth',
    `width=${width},height=${height},left=${left},top=${top},scrollbars=yes`,
  )
}

function wait(ms: number, signal?: AbortSignal, popup?: Window | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Gmail connect cancelled'))
      return
    }
    if (popup?.closed) {
      reject(new Error('Gmail connect cancelled'))
      return
    }

    const step = 250
    let elapsed = 0

    const tick = () => {
      if (signal?.aborted) {
        reject(new Error('Gmail connect cancelled'))
        return
      }
      if (popup?.closed) {
        reject(new Error('Gmail connect cancelled'))
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
      reject(new Error('Gmail connect cancelled'))
    }, { once: true })

    tick()
  })
}

export async function pollForNewGmailConnection(
  knownIds: Set<string>,
  options: {
    intervalMs?: number
    timeoutMs?: number
    signal?: AbortSignal
    popup?: Window | null
    reconnectConnectionId?: string | null
  } = {},
): Promise<GmailConnectionApi> {
  const { intervalMs = 2000, timeoutMs = 120000, signal, popup, reconnectConnectionId = null } = options
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Gmail connect cancelled')
    if (popup?.closed) throw new Error('Gmail connect cancelled')

    try {
      const list = await getGmailConnections()

      if (reconnectConnectionId) {
        const reconnected = list.find(
          (item) => item.id === reconnectConnectionId && item.status === 'connected',
        )
        if (reconnected) return reconnected
      }

      const fresh = list.find((item) => !knownIds.has(item.id))
      if (fresh) return fresh
    } catch {
      /* keep polling until timeout */
    }

    await wait(intervalMs, signal, popup)
  }

  throw new Error('Gmail connect timed out')
}
