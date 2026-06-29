import { api } from './api'
import { getBillingCurrent } from './billing'
import { apiStageToUi } from './applications'
import {
  extractProfileBreakdowns,
  mergeParsedProfile,
  mapExperienceBreakdown,
  type UiSkillBreakdown,
  type UiExperienceBreakdown,
  type UiEducationBreakdown,
} from './candidateProfile'

export type { UiSkillBreakdown, UiExperienceBreakdown, UiEducationBreakdown }

export type JobStatus = 'active' | 'paused' | 'closed'

export type DashboardJob = {
  id: string
  title: string
  location?: string | null
  exp_min: number
  exp_max: number
  education?: string | null
  required_skills?: string[]
  nice_skills?: string[]
  scan_from_date?: string | null
  scan_to_date?: string | null
  status?: JobStatus
  total_scanned?: number
  top_matches?: number
  new_found?: number
  shortlisted?: number
  in_progress?: number
}

export type JobsListResponse = {
  jobs: DashboardJob[]
  jobs_used: number
  jobs_limit: number
}

export type CreateJobPayload = {
  title: string
  exp_min: number
  exp_max: number
  education?: string
  location?: string
  required_skills: string[]
  nice_skills: string[]
  source_type: 'gmail' | 'drive' | 'api'
  source_connection_id?: string | null
  scan_from_date?: string
  scan_to_date?: string
}

export type UpdateJobPayload = Partial<{
  title: string
  exp_min: number
  exp_max: number
  education: string
  location: string
  required_skills: string[]
  nice_skills: string[]
  scan_from_date: string
  scan_to_date: string
}>

export type ApiCandidateApplication = {
  id: string
  stage?: string
  recruiter_note?: string | null
  scores?: {
    total?: number
    breakdown_json?: {
      match_percentage?: number
      matched_count?: number
      partial_count?: number
      gap_count?: number
      requirements?: Array<{
        category?: string
        label?: string
        candidate_value?: string
        status?: 'matched' | 'partial' | 'gap'
      }>
      highlight_terms?: string[] | null
      experience_breakdown?: Array<Record<string, unknown>> | null
    }
  }
  experience_breakdown?: Array<Record<string, unknown>> | null
  work_experience?: Array<Record<string, unknown>> | null
  parsed_profiles?: {
    total_exp_years?: number | null
    location?: string | null
    phone?: string | null
    skills?: string[] | null
    raw_text?: string | null
    summary?: string | null
    professional_summary?: string | null
    education?: string | null
    education_text?: string | null
    skills_breakdown?: Array<{
      name?: string
      skill?: string
      proficiency?: number
      score?: number
      years?: number
      years_experience?: number
      tier?: string
    }> | null
    skill_scores?: Record<string, number> | null
    work_history?: Array<Record<string, unknown>> | null
    work_experience?: Array<Record<string, unknown>> | null
    experience?: Array<Record<string, unknown>> | null
    experience_breakdown?: Array<Record<string, unknown>> | null
    education_entries?: Array<Record<string, unknown>> | null
    education_breakdown?: Array<Record<string, unknown>> | null
  }
  parsed_profile?: ApiCandidateApplication['parsed_profiles']
  candidates?: {
    name?: string
    email?: string
    phone?: string | null
    location?: string | null
  }
  candidate?: {
    name?: string
    email?: string
    phone?: string | null
    location?: string | null
  }
}

export type UiCandidate = {
  id: string
  applicationId: string
  name: string
  email: string
  role: string
  exp: string
  score: number
  location: string
  phone: string
  stage: string
  edu: string
  primary: string[]
  secondary: string[]
  summary?: string
  skillsBreakdown?: UiSkillBreakdown[]
  experienceBreakdown?: UiExperienceBreakdown[]
  educationBreakdown?: UiEducationBreakdown[]
  rawText?: string
  highlightTerms?: string[]
  recruiterNote?: string
  apiAlignment?: {
    rows: Array<{
      category: string
      jdLabel: string
      cvLabel: string
      status: 'match' | 'partial' | 'gap'
    }>
    matchPercent: number
    matched: number
    partial: number
    total: number
  }
}

function normalizeAlignmentStatus(status?: string): 'match' | 'partial' | 'gap' {
  if (status === 'matched' || status === 'match') return 'match'
  if (status === 'partial') return 'partial'
  return 'gap'
}

function mapAlignmentFromApi(breakdown: NonNullable<ApiCandidateApplication['scores']>['breakdown_json']) {
  if (!breakdown?.requirements?.length) return null
  const rows = breakdown.requirements.map((item) => ({
    category: item.category || 'Requirement',
    jdLabel: item.label || '',
    cvLabel: item.candidate_value || 'Not found in CV',
    status: normalizeAlignmentStatus(item.status),
  }))
  const matched = breakdown.matched_count ?? rows.filter((row) => row.status === 'match').length
  const partial = breakdown.partial_count ?? rows.filter((row) => row.status === 'partial').length
  const gapCount = breakdown.gap_count ?? rows.filter((row) => row.status === 'gap').length
  return {
    rows,
    matchPercent: breakdown.match_percentage ?? Math.round(((matched + partial * 0.5) / rows.length) * 100),
    matched,
    partial,
    total: rows.length || matched + partial + gapCount,
  }
}

function pickCandidatePhone(
  person: { phone?: string | null },
  profile: { phone?: string | null },
) {
  return person.phone?.trim() || profile.phone?.trim() || ''
}

export function mapApiCandidateApplication(item: ApiCandidateApplication): UiCandidate {
  const rawProfile = item.parsed_profiles || item.parsed_profile || {}
  const profile = mergeParsedProfile(rawProfile, item as Record<string, unknown>)
  const person = item.candidates || item.candidate || {}
  const skills = profile.skills || []
  const breakdown = item.scores?.breakdown_json
  const apiAlignment = mapAlignmentFromApi(breakdown)
  const profileParts = extractProfileBreakdowns(
    profile,
    breakdown?.requirements || [],
    breakdown?.experience_breakdown,
  )
  const experienceBreakdown = profileParts.experienceBreakdown

  return {
    id: item.id,
    applicationId: item.id,
    name: person.name || 'Unknown candidate',
    email: person.email || '',
    role: skills[0] ? `${skills[0]} specialist` : 'Candidate',
    exp: profile.total_exp_years != null ? `${profile.total_exp_years} yrs` : '',
    score: Math.round(item.scores?.total ?? breakdown?.match_percentage ?? 0),
    location: profile.location || person.location || '',
    phone: pickCandidatePhone(person, profile),
    stage: apiStageToUi(item.stage || 'new'),
    edu: profileParts.educationText || profileParts.educationBreakdown[0]?.degree || '',
    primary: skills.slice(0, 4),
    secondary: skills.slice(4, 8),
    summary: profileParts.summary || undefined,
    skillsBreakdown: profileParts.skillsBreakdown.length > 0 ? profileParts.skillsBreakdown : undefined,
    experienceBreakdown: experienceBreakdown.length > 0 ? experienceBreakdown : undefined,
    educationBreakdown: profileParts.educationBreakdown.length > 0 ? profileParts.educationBreakdown : undefined,
    rawText: profile.raw_text?.trim() || undefined,
    highlightTerms: breakdown?.highlight_terms?.filter(Boolean) || undefined,
    recruiterNote: item.recruiter_note?.trim() || '',
    apiAlignment: apiAlignment || undefined,
  }
}

export function mapApiCandidatesResponse(data: unknown): UiCandidate[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { candidates?: unknown[] })?.candidates)
      ? (data as { candidates: ApiCandidateApplication[] }).candidates
      : []
  return list.map(mapApiCandidateApplication)
}

export async function fetchJobsList(): Promise<JobsListResponse> {
  const data = await api.get('/api/jobs')
  if (Array.isArray(data)) {
    return {
      jobs: data as DashboardJob[],
      jobs_used: data.length,
      jobs_limit: 0,
    }
  }
  const response = data as Partial<JobsListResponse>
  const jobs = response.jobs || []
  return {
    jobs,
    jobs_used: response.jobs_used ?? jobs.length,
    jobs_limit: response.jobs_limit ?? 0,
  }
}

export function resolveJobUsage(
  billing: { jobs_created_this_cycle?: number; plan: { max_jobs: number } },
  jobsResponse: JobsListResponse,
) {
  const max = jobsResponse.jobs_limit > 0
    ? jobsResponse.jobs_limit
    : billing.plan.max_jobs ?? 0

  const cycleUsed = billing.jobs_created_this_cycle
  const used = typeof cycleUsed === 'number'
    ? cycleUsed
    : jobsResponse.jobs_used ?? jobsResponse.jobs.length

  return { used, max }
}

export function createJob(payload: CreateJobPayload) {
  return api.post('/api/jobs', payload)
}

export function scanJob(jobId: string) {
  return api.post(`/api/jobs/${jobId}/scan`)
}

export function pauseJob(jobId: string) {
  return api.patch(`/api/jobs/${jobId}/pause`)
}

export function resumeJob(jobId: string) {
  return api.patch(`/api/jobs/${jobId}/resume`)
}

export function closeJob(jobId: string) {
  return api.patch(`/api/jobs/${jobId}/close`)
}

export function reopenJob(jobId: string) {
  return api.patch(`/api/jobs/${jobId}/reopen`)
}

export function deleteJob(jobId: string) {
  return api.delete(`/api/jobs/${jobId}`)
}

export function updateJob(jobId: string, payload: UpdateJobPayload) {
  return api.patch(`/api/jobs/${jobId}`, payload)
}

export async function fetchJobCandidates(jobId: string) {
  const data = await api.get(`/api/jobs/${jobId}/candidates`)
  return mapApiCandidatesResponse(data)
}

export async function fetchJobUsage(): Promise<{ used: number; max: number; remaining: number }> {
  const [current, jobsResponse] = await Promise.all([
    getBillingCurrent(),
    fetchJobsList().catch(() => ({ jobs: [], jobs_used: 0, jobs_limit: 0 })),
  ])

  const { used, max } = resolveJobUsage(current, jobsResponse)

  return {
    used,
    max,
    remaining: Math.max(0, max - used),
  }
}

// Backward-compatible alias used by billing loader
export function fetchJobs() {
  return fetchJobsList()
}
