import { api } from './api'
import {
  extractProfileBreakdowns,
  mergeParsedProfile,
} from './candidateProfile'
import type { UiCandidate } from './jobs'

export type SearchRequirement = {
  label?: string
  met?: boolean
  detail?: string
  category?: string
  candidate_value?: string
  status?: string
}

type SearchParsedProfile = {
  total_exp_years?: number | null
  location?: string | null
  phone?: string | null
  email?: string | null
  skills?: string[] | null
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
  raw_text?: string | null
}

export type SearchCandidate = SearchParsedProfile & {
  cv_document_id: string
  candidate_email: string
  email?: string
  name: string
  location: string
  total_exp_years: number
  match_percentage: number
  tier: string
  note: string
  requirements: SearchRequirement[]
  phone?: string | null
  skills?: string[] | null
  parsed_profile?: SearchParsedProfile | null
  parsed_profiles?: SearchParsedProfile | null
  experience_breakdown?: Array<Record<string, unknown>> | null
  work_experience?: Array<Record<string, unknown>> | null
  work_history?: Array<Record<string, unknown>> | null
  scores?: {
    total?: number
    breakdown_json?: {
      match_percentage?: number
      matched_count?: number
      partial_count?: number
      gap_count?: number
      requirements?: SearchRequirement[]
      highlight_terms?: string[] | null
      experience_breakdown?: Array<Record<string, unknown>> | null
    }
  }
}

export type SearchFiltersUsed = {
  required_skills: string[]
  exp_min: number
  exp_max: number
  location: string
  min_match_percentage: number
}

export type SearchCandidatesResponse = {
  filters_used: SearchFiltersUsed
  message: string
  exact_matches: SearchCandidate[]
  strong_matches: SearchCandidate[]
  below_threshold: SearchCandidate[]
}

const EMPTY_FILTERS: SearchFiltersUsed = {
  required_skills: [],
  exp_min: 0,
  exp_max: 99,
  location: '',
  min_match_percentage: 0,
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function pickArray(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = raw[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function toNumber(value: unknown, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue
    const str = String(value).trim()
    if (str) return str
  }
  return ''
}

function pickContactFromRequirements(requirements: SearchRequirement[] = []) {
  let email = ''
  let phone = ''

  for (const req of requirements) {
    const label = (req.label || '').toLowerCase()
    const category = (req.category || '').toLowerCase()
    const value = (req.candidate_value || req.detail || '').trim()
    if (!value || value === 'Not found in CV') continue

    if (category.includes('email') || label.includes('email') || label.includes('e-mail')) {
      email = email || value
    }
    if (
      category.includes('phone')
      || category.includes('mobile')
      || category.includes('contact')
      || label.includes('phone')
      || label.includes('mobile')
    ) {
      phone = phone || value
    }
  }

  return { email, phone }
}

function pickNestedSearchContact(item: Record<string, unknown>, requirements: SearchRequirement[] = []) {
  const person = asRecord(item.candidate ?? item.candidates)
  const profile = asRecord(
    item.parsed_profile ?? item.parsedProfile ?? item.parsed_profiles ?? item.parsedProfiles,
  )
  const contact = asRecord(item.contact ?? item.contact_info ?? item.contactInfo)
  const fromRequirements = pickContactFromRequirements(requirements)

  const email = pickString(
    item.candidate_email,
    item.candidateEmail,
    item.email,
    person.email,
    profile.email,
    contact.email,
    fromRequirements.email,
  )

  const phone = pickString(
    item.phone,
    item.phone_number,
    item.phoneNumber,
    item.mobile,
    item.candidate_phone,
    item.candidatePhone,
    person.phone,
    profile.phone,
    contact.phone,
    contact.mobile,
    fromRequirements.phone,
  )

  return { email, phone }
}

export function getSearchCandidateContact(candidate: SearchCandidate) {
  const person = asRecord((candidate as Record<string, unknown>).candidate
    ?? (candidate as Record<string, unknown>).candidates)
  const profile = candidate.parsed_profile || candidate.parsed_profiles || {}
  const fromRequirements = pickContactFromRequirements(candidate.requirements)

  return {
    email: pickString(
      candidate.candidate_email,
      candidate.email,
      person.email,
      profile.email,
      fromRequirements.email,
    ),
    phone: pickString(
      candidate.phone,
      person.phone,
      profile.phone,
      fromRequirements.phone,
    ),
  }
}

export function enrichSearchCandidateContact(
  candidate: SearchCandidate,
  portfolioCandidates: Array<{
    id?: string
    applicationId?: string
    email?: string
    phone?: string
    name?: string
  }> = [],
) {
  const base = getSearchCandidateContact(candidate)
  if (base.email && base.phone) return base

  const normalizedName = candidate.name?.trim().toLowerCase()
  const match = portfolioCandidates.find((item) => {
    if (
      item.id === candidate.cv_document_id
      || item.applicationId === candidate.cv_document_id
    ) {
      return true
    }
    if (base.email && item.email && item.email.toLowerCase() === base.email.toLowerCase()) {
      return true
    }
    return Boolean(
      normalizedName
      && item.name
      && item.name.trim().toLowerCase() === normalizedName,
    )
  })

  return {
    email: base.email || match?.email || '',
    phone: base.phone || match?.phone || '',
  }
}

function normalizeSearchRequirement(raw: unknown): SearchRequirement {
  const item = asRecord(raw)
  return {
    label: item.label != null ? String(item.label) : undefined,
    met: typeof item.met === 'boolean' ? item.met : undefined,
    detail: item.detail != null ? String(item.detail) : undefined,
    category: item.category != null ? String(item.category) : undefined,
    candidate_value: item.candidate_value != null
      ? String(item.candidate_value)
      : item.candidateValue != null
        ? String(item.candidateValue)
        : undefined,
    status: item.status != null ? String(item.status) : undefined,
  }
}

export function normalizeSearchCandidate(raw: unknown): SearchCandidate {
  const item = asRecord(raw)
  const requirements = pickArray(item, 'requirements').map(normalizeSearchRequirement)
  const matchPercentage = toNumber(
    item.match_percentage ?? item.matchPercentage ?? item.score ?? item.match_percent,
  )
  const totalExpYears = toNumber(item.total_exp_years ?? item.totalExpYears ?? item.years_experience, 0)
  const parsedProfile = asRecord(item.parsed_profile ?? item.parsedProfile) as SearchParsedProfile
  const parsedProfiles = asRecord(item.parsed_profiles ?? item.parsedProfiles) as SearchParsedProfile
  const contact = pickNestedSearchContact(item, requirements)

  return {
    ...(item as SearchParsedProfile),
    cv_document_id: String(
      item.cv_document_id ?? item.cvDocumentId ?? item.id ?? item.application_id ?? `search-${Date.now()}`,
    ),
    candidate_email: contact.email,
    email: contact.email,
    name: String(item.name ?? item.candidate_name ?? item.full_name ?? asRecord(item.candidate ?? item.candidates).name ?? 'Unknown candidate'),
    location: String(
      item.location
      ?? item.candidate_location
      ?? parsedProfile.location
      ?? parsedProfiles.location
      ?? asRecord(item.candidate ?? item.candidates).location
      ?? '',
    ),
    total_exp_years: totalExpYears,
    match_percentage: matchPercentage,
    tier: String(item.tier ?? ''),
    note: String(item.note ?? item.summary_note ?? ''),
    requirements,
    phone: contact.phone || null,
    skills: Array.isArray(item.skills)
      ? item.skills.map(String)
      : parsedProfile.skills || parsedProfiles.skills || undefined,
    parsed_profile: Object.keys(parsedProfile).length > 0 ? parsedProfile : null,
    parsed_profiles: Object.keys(parsedProfiles).length > 0 ? parsedProfiles : null,
    experience_breakdown: pickArray(item, 'experience_breakdown', 'experienceBreakdown'),
    work_experience: pickArray(item, 'work_experience', 'workExperience'),
    work_history: pickArray(item, 'work_history', 'workHistory'),
    scores: item.scores as SearchCandidate['scores'],
  }
}

export function normalizeSearchResponse(data: unknown): SearchCandidatesResponse {
  const raw = asRecord(data)
  const filtersRaw = asRecord(raw.filters_used ?? raw.filtersUsed)

  const filters_used: SearchFiltersUsed = {
    required_skills: Array.isArray(filtersRaw.required_skills)
      ? filtersRaw.required_skills.map(String)
      : Array.isArray(filtersRaw.requiredSkills)
        ? filtersRaw.requiredSkills.map(String)
        : [],
    exp_min: toNumber(filtersRaw.exp_min ?? filtersRaw.expMin, 0),
    exp_max: toNumber(filtersRaw.exp_max ?? filtersRaw.expMax, 99),
    location: String(filtersRaw.location ?? ''),
    min_match_percentage: toNumber(
      filtersRaw.min_match_percentage ?? filtersRaw.minMatchPercentage,
      0,
    ),
  }

  const normalizeList = (...keys: string[]) => (
    pickArray(raw, ...keys).map(normalizeSearchCandidate)
  )

  let exact_matches = normalizeList('exact_matches', 'exactMatches')
  let strong_matches = normalizeList('strong_matches', 'strongMatches')
  let below_threshold = normalizeList('below_threshold', 'belowThreshold')

  // Some API versions return a flat candidates list with tier labels.
  if (exact_matches.length === 0 && strong_matches.length === 0 && below_threshold.length === 0) {
    const flat = pickArray(raw, 'candidates', 'results', 'matches').map(normalizeSearchCandidate)
    exact_matches = flat.filter((c) => c.tier === 'exact' || c.match_percentage >= 90)
    strong_matches = flat.filter((c) => c.tier === 'strong' || (c.match_percentage >= 70 && c.match_percentage < 90))
    below_threshold = flat.filter((c) => (
      c.tier === 'below_threshold'
      || c.tier === 'below'
      || (c.match_percentage > 0 && c.match_percentage < 70)
    ))
    if (exact_matches.length === 0 && strong_matches.length === 0 && below_threshold.length === 0) {
      exact_matches = flat
    }
  }

  return {
    filters_used: Object.keys(filtersRaw).length > 0 ? filters_used : EMPTY_FILTERS,
    message: String(raw.message ?? raw.summary ?? ''),
    exact_matches,
    strong_matches,
    below_threshold,
  }
}

function normalizeAlignmentStatus(status?: string): 'match' | 'partial' | 'gap' {
  if (status === 'matched' || status === 'match') return 'match'
  if (status === 'partial') return 'partial'
  return 'gap'
}

function parseSearchRequirementCategory(label = '') {
  const skillMatch = label.match(/^(Must_Have|Must-have|Nice-to-have)\s*\((.+)\)$/i)
  if (skillMatch) {
    return skillMatch[1].replace('_', '-').replace(/^must/i, 'Must-have')
  }
  const lower = label.toLowerCase()
  if (lower.includes('experience')) return 'Experience'
  if (lower.includes('education')) return 'Education'
  if (lower.includes('location')) return 'Location'
  return 'Requirement'
}

function normalizeSearchRequirements(requirements: SearchRequirement[] = []) {
  return requirements.map((req) => ({
    category: req.category || parseSearchRequirementCategory(req.label || ''),
    label: req.label || '',
    candidate_value: req.candidate_value || req.detail || '',
    status: req.status
      || (req.met === true ? 'matched' : req.met === false ? 'partial' : 'gap'),
  }))
}

function mapAlignmentFromSearchRequirements(
  requirements: SearchRequirement[],
  matchPercentage: number,
  filtersUsed?: SearchFiltersUsed,
) {
  const normalized = normalizeSearchRequirements(requirements)
  if (normalized.length === 0) return undefined

  const rows = normalized.map((req) => {
    const category = req.category || 'Requirement'
    let jdLabel = req.label || ''

    const skillMatch = jdLabel.match(/^(Must_Have|Must-have|Nice-to-have)\s*\((.+)\)$/i)
    if (skillMatch) {
      jdLabel = skillMatch[2]
    } else if (category === 'Experience' && filtersUsed) {
      jdLabel = `${filtersUsed.exp_min}-${filtersUsed.exp_max} years`
    } else if (category === 'Location' && filtersUsed?.location) {
      jdLabel = filtersUsed.location
    } else if (jdLabel.toLowerCase() === category.toLowerCase() && category !== 'Requirement') {
      if (category === 'Experience' && filtersUsed) {
        jdLabel = `${filtersUsed.exp_min}-${filtersUsed.exp_max} years`
      } else if (category === 'Location' && filtersUsed?.location) {
        jdLabel = filtersUsed.location
      }
    }

    const cvLabel = req.candidate_value || 'Not found in CV'
    return {
      category,
      jdLabel,
      cvLabel,
      status: normalizeAlignmentStatus(req.status),
    }
  })

  const matched = rows.filter((row) => row.status === 'match').length
  const partial = rows.filter((row) => row.status === 'partial').length

  return {
    rows,
    matched,
    partial,
    matchPercent: matchPercentage,
    total: rows.length,
  }
}

export function getSearchCandidateMatchingSkills(
  candidate: SearchCandidate,
  filtersUsed?: SearchFiltersUsed,
): string[] {
  const fromRequirements = (candidate.requirements || [])
    .filter((req) => {
      const status = req.status || (req.met === true ? 'matched' : '')
      const isMatch = status === 'matched' || status === 'match' || req.met === true
      const cat = (req.category || req.label || '').toLowerCase()
      return isMatch && (cat.includes('must') || cat.includes('skill') || /\(.+\)/.test(req.label || ''))
    })
    .map((req) => {
      const skillMatch = (req.label || '').match(/\((.+)\)/)
      return skillMatch?.[1] || req.label || ''
    })
    .filter(Boolean)

  if (fromRequirements.length > 0) {
    return [...new Set(fromRequirements)]
  }

  const breakdown = candidate.skills_breakdown
    || candidate.parsed_profile?.skills_breakdown
    || candidate.parsed_profiles?.skills_breakdown
    || []

  if (breakdown.length > 0) {
    return breakdown
      .map((skill) => skill.name || skill.skill || '')
      .filter(Boolean)
      .slice(0, 6)
  }

  const required = filtersUsed?.required_skills || []
  const candidateSkills = candidate.skills
    || candidate.parsed_profile?.skills
    || candidate.parsed_profiles?.skills
    || []

  if (required.length > 0 && candidateSkills.length > 0) {
    return required.filter((jd) => (
      candidateSkills.some((skill) => skill.toLowerCase().includes(jd.toLowerCase()))
    ))
  }

  if (candidateSkills.length > 0) {
    return candidateSkills.slice(0, 6)
  }

  return required.slice(0, 4)
}

export function mapSearchCandidateToUi(
  searchCandidate: SearchCandidate,
  filtersUsed?: SearchFiltersUsed,
): UiCandidate {
  const rawProfile = searchCandidate.parsed_profiles
    || searchCandidate.parsed_profile
    || {}
  const profile = mergeParsedProfile(rawProfile, searchCandidate as Record<string, unknown>)

  const requirements = searchCandidate.requirements?.length
    ? searchCandidate.requirements
    : searchCandidate.scores?.breakdown_json?.requirements || []

  const normalizedRequirements = normalizeSearchRequirements(requirements)
  const apiAlignment = mapAlignmentFromSearchRequirements(
    requirements,
    searchCandidate.match_percentage ?? searchCandidate.scores?.breakdown_json?.match_percentage ?? 0,
    filtersUsed,
  )

  const scoreExperienceBreakdown = searchCandidate.experience_breakdown
    ?? searchCandidate.scores?.breakdown_json?.experience_breakdown

  const profileParts = extractProfileBreakdowns(
    profile,
    normalizedRequirements,
    scoreExperienceBreakdown,
  )

  const skills = profile.skills || searchCandidate.skills || []
  const totalExpYears = profile.total_exp_years ?? searchCandidate.total_exp_years

  const contact = getSearchCandidateContact(searchCandidate)

  return {
    id: searchCandidate.cv_document_id,
    applicationId: searchCandidate.cv_document_id,
    name: searchCandidate.name || 'Unknown candidate',
    email: contact.email,
    role: skills[0] ? `${skills[0]} specialist` : 'Candidate',
    exp: totalExpYears != null ? `${totalExpYears} yrs` : '',
    score: Math.round(
      searchCandidate.match_percentage
      ?? searchCandidate.scores?.total
      ?? searchCandidate.scores?.breakdown_json?.match_percentage
      ?? 0,
    ),
    location: profile.location || searchCandidate.location || '',
    phone: contact.phone,
    stage: 'New',
    edu: profileParts.educationText || profileParts.educationBreakdown[0]?.degree || '',
    primary: skills.slice(0, 4),
    secondary: skills.slice(4, 8),
    summary: profileParts.summary || searchCandidate.note || searchCandidate.summary || undefined,
    skillsBreakdown: profileParts.skillsBreakdown.length > 0 ? profileParts.skillsBreakdown : undefined,
    experienceBreakdown: profileParts.experienceBreakdown.length > 0
      ? profileParts.experienceBreakdown
      : undefined,
    educationBreakdown: profileParts.educationBreakdown.length > 0
      ? profileParts.educationBreakdown
      : undefined,
    rawText: profile.raw_text?.trim() || undefined,
    highlightTerms: searchCandidate.scores?.breakdown_json?.highlight_terms?.filter(Boolean) || undefined,
    recruiterNote: '',
    apiAlignment,
  }
}

export async function searchCandidates(query: string) {
  const data = await api.post('/api/search/candidates', { query })
  return normalizeSearchResponse(data)
}
