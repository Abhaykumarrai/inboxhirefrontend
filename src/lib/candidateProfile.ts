type ApiSkillEntry = {
  name?: string
  skill?: string
  proficiency?: number
  score?: number
  years?: number
  years_experience?: number
  tier?: string
}

type ApiExperienceEntry = {
  company?: string
  title?: string
  role?: string
  period?: string
  from?: string
  to?: string
  start_date?: string
  end_date?: string
  highlight?: string
  relevance?: number
  fit_score?: number
  fit?: number
  fit_percentage?: number
  highlights?: string[]
  bullets?: string[]
  description?: string[]
  skills_used?: string[]
}

type ApiEducationEntry = {
  degree?: string
  qualification?: string
  institution?: string
  school?: string
  university?: string
  year?: string
  end_year?: string
  period?: string
  field?: string
  relevance?: number
  fit_score?: number
  fit?: number
}

type ApiParsedProfile = {
  total_exp_years?: number | null
  location?: string | null
  phone?: string | null
  skills?: string[] | null
  summary?: string | null
  professional_summary?: string | null
  education?: string | null
  education_text?: string | null
  skills_breakdown?: ApiSkillEntry[] | null
  skill_scores?: Record<string, number> | null
  work_history?: ApiExperienceEntry[] | null
  work_experience?: ApiExperienceEntry[] | null
  experience?: ApiExperienceEntry[] | null
  experience_breakdown?: ApiExperienceEntry[] | null
  education_entries?: ApiEducationEntry[] | null
  education_breakdown?: ApiEducationEntry[] | null
}

export type UiSkillBreakdown = {
  name: string
  proficiency: number
  years: number
  tier: 'core' | 'support'
}

export type UiExperienceBreakdown = {
  company: string
  title: string
  period: string
  relevance: number
  bullets: string[]
  skillsUsed: string[]
}

export type UiEducationBreakdown = {
  degree: string
  institution: string
  period: string
  relevance: number
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function pickSkillName(entry: ApiSkillEntry) {
  return (entry.name || entry.skill || '').trim()
}

function normalizeSkillEntry(entry: ApiSkillEntry, index: number): UiSkillBreakdown | null {
  const name = pickSkillName(entry)
  if (!name) return null
  const proficiency = Math.round(
    entry.proficiency ?? entry.score ?? Math.max(55, 88 - index * 4),
  )
  const years = entry.years ?? entry.years_experience ?? Math.max(0.5, 3 - index * 0.3)
  const tier = entry.tier === 'support' ? 'support' : index < 4 ? 'core' : 'support'
  return { name, proficiency, years: Math.round(years * 10) / 10, tier }
}

function normalizeExperienceEntry(entry: ApiExperienceEntry): UiExperienceBreakdown | null {
  const company = (entry.company || '').trim()
  const title = (entry.title || entry.role || '').trim()
  if (!company && !title) return null

  const from = (entry.from || entry.start_date || '').trim()
  const to = (entry.to || entry.end_date || '').trim()
  const period = (entry.period || [from, to].filter(Boolean).join(' – ')).trim() || '—'

  const highlight = typeof entry.highlight === 'string' ? entry.highlight.trim() : ''
  const extraBullets = entry.bullets || entry.highlights || entry.description || []
  const bullets = [
    ...(highlight ? [highlight] : []),
    ...extraBullets.filter((line) => typeof line === 'string' && line.trim()),
  ]

  const skillsUsed = asArray<string>(entry.skills_used).map((s) => String(s).trim()).filter(Boolean)
  const relevance = Math.round(
    entry.relevance ?? entry.fit_score ?? entry.fit ?? entry.fit_percentage ?? 80,
  )

  return {
    company: company || '',
    title: title || 'Role not listed',
    period,
    relevance,
    bullets: bullets.length > 0 ? bullets : ['Contributions extracted from parsed CV'],
    skillsUsed,
  }
}

function pickExperienceSources(profile: ApiParsedProfile): ApiExperienceEntry[] {
  const sources = [
    profile.experience_breakdown,
    profile.work_experience,
    profile.work_history,
    profile.experience,
  ]
  for (const source of sources) {
    const entries = asArray<ApiExperienceEntry>(source)
    if (entries.length > 0) return entries
  }
  return []
}

function normalizeEducationEntry(entry: ApiEducationEntry): UiEducationBreakdown | null {
  const degree = (entry.degree || entry.qualification || entry.field || '').trim()
  const institution = (entry.institution || entry.school || entry.university || '').trim()
  if (!degree && !institution) return null
  const period = (entry.period || entry.year || entry.end_year || '').trim()
  const relevance = Math.round(entry.relevance ?? entry.fit_score ?? entry.fit ?? 85)
  return {
    degree: degree || institution,
    institution: degree ? institution : '',
    period,
    relevance,
  }
}

function normalizeSkillsFromScores(scores: Record<string, number>) {
  return Object.entries(scores)
    .map(([name, score], index) => normalizeSkillEntry({ name, score }, index))
    .filter((item): item is UiSkillBreakdown => item != null)
}

function parseEducationText(text: string): UiEducationBreakdown[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  const parts = trimmed.split(/[—,·]/).map((part) => part.trim()).filter(Boolean)
  return [{
    degree: parts[0] || trimmed,
    institution: parts.slice(1).join(' · '),
    period: '',
    relevance: 85,
  }]
}

export function mapExperienceBreakdown(entries: unknown[] | null | undefined): UiExperienceBreakdown[] {
  return asArray<ApiExperienceEntry>(entries)
    .map(normalizeExperienceEntry)
    .filter((item): item is UiExperienceBreakdown => item != null)
}

export function mergeParsedProfile(
  profile: ApiParsedProfile | null | undefined,
  item: Record<string, unknown>,
): ApiParsedProfile {
  const base = profile || {}
  const rootExperience = item.experience_breakdown ?? item.work_experience
  return {
    ...base,
    experience_breakdown: (base.experience_breakdown
      ?? base.work_experience
      ?? rootExperience) as ApiExperienceEntry[] | undefined,
    work_experience: (base.work_experience ?? rootExperience) as ApiExperienceEntry[] | undefined,
  }
}

export function extractProfileBreakdowns(
  profile: ApiParsedProfile,
  requirements: Array<{ category?: string; label?: string; candidate_value?: string; status?: string }> = [],
  scoreExperienceBreakdown?: unknown[] | null,
) {
  const skillSources = [
    ...asArray<ApiSkillEntry>(profile.skills_breakdown),
    ...normalizeSkillsFromScores(profile.skill_scores || {}),
  ]

  let skillsBreakdown = skillSources
    .map((entry, index) => normalizeSkillEntry(entry, index))
    .filter((item): item is UiSkillBreakdown => item != null)

  const seenSkills = new Set<string>()
  skillsBreakdown = skillsBreakdown.filter((skill) => {
    const key = skill.name.toLowerCase()
    if (seenSkills.has(key)) return false
    seenSkills.add(key)
    return true
  })

  let experienceBreakdown = mapExperienceBreakdown(scoreExperienceBreakdown)
  if (experienceBreakdown.length === 0) {
    experienceBreakdown = pickExperienceSources(profile)
      .map(normalizeExperienceEntry)
      .filter((item): item is UiExperienceBreakdown => item != null)
  }

  const educationSources = [
    ...asArray<ApiEducationEntry>(profile.education_breakdown),
    ...asArray<ApiEducationEntry>(profile.education_entries),
  ]

  let educationBreakdown = educationSources
    .map(normalizeEducationEntry)
    .filter((item): item is UiEducationBreakdown => item != null)

  const educationText = profile.education?.trim() || profile.education_text?.trim() || ''
  if (educationBreakdown.length === 0 && educationText) {
    educationBreakdown = parseEducationText(educationText)
  }

  const eduRequirement = requirements.find((row) =>
    row.category?.toLowerCase().includes('education'),
  )
  if (educationBreakdown.length === 0 && eduRequirement?.candidate_value) {
    const cvValue = eduRequirement.candidate_value.trim()
    if (cvValue && cvValue !== 'Not found in CV') {
      educationBreakdown = parseEducationText(cvValue).map((entry) => ({
        ...entry,
        relevance: eduRequirement.status === 'matched'
          ? 92
          : eduRequirement.status === 'partial'
            ? 76
            : 58,
      }))
    }
  }

  const summary = profile.summary?.trim() || profile.professional_summary?.trim() || ''

  return {
    summary,
    educationText,
    skillsBreakdown,
    experienceBreakdown,
    educationBreakdown,
  }
}
