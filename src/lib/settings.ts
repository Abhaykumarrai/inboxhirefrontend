import { api } from './api'

export type ScoringWeights = {
  skills_weight: number
  experience_weight: number
  education_weight: number
  location_weight: number
  profile_weight: number
  recency_weight: number
}

export const SCORING_WEIGHT_FIELDS: (keyof ScoringWeights)[] = [
  'skills_weight',
  'experience_weight',
  'education_weight',
  'location_weight',
  'profile_weight',
  'recency_weight',
]

export const SCORING_WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  skills_weight: 'Skills',
  experience_weight: 'Experience',
  education_weight: 'Education',
  location_weight: 'Location',
  profile_weight: 'Profile Completeness',
  recency_weight: 'Recency',
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  skills_weight: 35,
  experience_weight: 25,
  education_weight: 15,
  location_weight: 10,
  profile_weight: 10,
  recency_weight: 5,
}

export function getScoringWeightsTotal(weights: ScoringWeights) {
  return SCORING_WEIGHT_FIELDS.reduce((sum, key) => sum + (weights[key] ?? 0), 0)
}

export function isValidScoringWeights(weights: ScoringWeights) {
  return getScoringWeightsTotal(weights) === 100
    && SCORING_WEIGHT_FIELDS.every((key) => (weights[key] ?? 0) >= 0)
}

export async function fetchScoringWeights(): Promise<ScoringWeights> {
  return api.get('/api/settings/scoring-weights')
}

export async function saveScoringWeights(weights: ScoringWeights): Promise<void> {
  await api.put('/api/settings/scoring-weights', weights)
}

export async function resetScoringWeights(): Promise<ScoringWeights> {
  const data = await api.post('/api/settings/scoring-weights/reset') as { weights: ScoringWeights }
  return data.weights
}
