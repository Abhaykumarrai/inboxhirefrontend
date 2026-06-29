import { api } from './api'

export type AvailableGmailSource = {
  id: string
  gmail_email: string
  status: string
  assigned_user_id: string | null
}

export type AvailableDriveSource = {
  id?: string
  folder_id?: string | null
  folder_name?: string | null
  google_email?: string | null
  drive_email?: string | null
  gmail_email?: string | null
  email?: string | null
  status?: string
}

export type AvailableSources = {
  gmail: AvailableGmailSource[]
  drive: AvailableDriveSource | null
  api: Record<string, unknown> | null
}

export function fetchAvailableSources() {
  return api.get('/api/sources/available') as Promise<AvailableSources>
}
