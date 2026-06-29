import { api } from './api'

export type ApplicationStage = 'new' | 'shortlisted' | 'in_progress' | 'rejected'

export function updateApplicationStage(applicationId: string, stage: ApplicationStage) {
  return api.patch(`/api/applications/${applicationId}/stage`, { stage })
}

export function sendApplicationEmail(payload: {
  application_ids: string[]
  subject: string
  body_html: string
}) {
  return api.post('/api/applications/email', payload)
}

export function fetchApplicationCvUrl(applicationId: string) {
  return api.get(`/api/applications/${applicationId}/cv`) as Promise<{ url: string }>
}

export function saveApplicationNote(applicationId: string, note: string) {
  return api.patch(`/api/applications/${applicationId}/note`, { note }) as Promise<{ message: string }>
}

export function uiStageToApi(stage: string): ApplicationStage {
  const normalized = stage.toLowerCase().replace(/\s+/g, '_')
  if (normalized === 'shortlisted') return 'shortlisted'
  if (normalized === 'in_progress') return 'in_progress'
  if (normalized === 'rejected') return 'rejected'
  return 'new'
}

export function apiStageToUi(stage: string) {
  switch (stage) {
    case 'shortlisted': return 'Shortlisted'
    case 'in_progress': return 'In Progress'
    case 'rejected': return 'Rejected'
    default: return 'New'
  }
}
