import { api } from './api'

export type DraftRecipient = {
  name?: string
  email?: string
}

export type PendingDraft = {
  id: string
  recipients: DraftRecipient[] | string[]
  subject: string
  body_html: string
  status: string
}

export type AgentChatResponse = {
  conversation_id: string
  reply: string
  pending_draft: PendingDraft | null
}

export type ConfirmDraftResponse = {
  sent: number
  failed: number
}

export type CancelDraftResponse = {
  message: string
}

export function agentChat(message: string, conversationId: string | null = null) {
  // First message in a conversation omits conversation_id; follow-ups include it.
  const body = conversationId
    ? { conversation_id: conversationId, message }
    : { message }

  return api.post('/api/agent/chat', body) as Promise<AgentChatResponse>
}

export function confirmDraft(draftId: string) {
  return api.post(`/api/agent/drafts/${draftId}/confirm`) as Promise<ConfirmDraftResponse>
}

export function cancelDraft(draftId: string) {
  return api.post(`/api/agent/drafts/${draftId}/cancel`) as Promise<CancelDraftResponse>
}
