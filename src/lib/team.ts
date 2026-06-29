import { api } from './api'

export type TeamMemberApi = {
  id: string
  name: string
  email: string
  role: string
  invite_status?: string | null
  status?: string | null
}

export type TeamMember = {
  id: string
  name: string
  email: string
  role: 'Admin' | 'Employee'
  inviteStatus: 'pending' | 'accepted' | 'suspended'
  assignedInboxId: string | null
}

function normalizeRole(role: string): 'Admin' | 'Employee' {
  return role.toLowerCase() === 'admin' ? 'Admin' : 'Employee'
}

function normalizeInviteStatus(raw?: string | null): 'pending' | 'accepted' | 'suspended' {
  const status = (raw || 'accepted').toLowerCase()
  if (status === 'pending' || status === 'suspended') return status
  return 'accepted'
}

export function mapTeamMember(member: TeamMemberApi): TeamMember {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: normalizeRole(member.role),
    inviteStatus: normalizeInviteStatus(member.invite_status ?? member.status),
    assignedInboxId: null,
  }
}

export function getTeamMembers() {
  return api.get('/api/team') as Promise<TeamMemberApi[]>
}

export async function fetchTeamMembersForUi() {
  const list = await getTeamMembers()
  return list.map(mapTeamMember)
}

export function syncTeamInboxAssignments(
  team: TeamMember[],
  connections: { id: string; assignedMemberId: string | null }[],
) {
  return team.map((member) => ({
    ...member,
    assignedInboxId: connections.find((conn) => conn.assignedMemberId === member.id)?.id ?? null,
  }))
}
