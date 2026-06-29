export function parseSkillsInput(text: string) {
  return text
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean)
}

export function formatSkillsInput(skills: string[] = []) {
  return skills.join(', ')
}

export function parseOptionalInt(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export function validateJobFormFields({
  expMin,
  expMax,
  scanFromDate,
  scanToDate,
}: {
  expMin: string
  expMax: string
  scanFromDate: string
  scanToDate: string
}) {
  const errors: Record<string, string> = {}
  const min = parseOptionalInt(expMin)
  const max = parseOptionalInt(expMax)

  if (min != null && max != null && min > max) {
    errors.experience = 'Minimum experience cannot exceed maximum.'
  }

  if (scanFromDate && scanToDate && scanFromDate > scanToDate) {
    errors.scanDates = 'Start date must be on or before end date.'
  }

  return errors
}
