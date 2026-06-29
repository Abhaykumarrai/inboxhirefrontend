import { api } from './api'
import type { RazorpaySuccessResponse } from './razorpay'

export type CreateOrderResponse = {
  order_id: string
  amount: number
  currency: string
  key_id: string
  plan_name: string
}

export const PAYMENT_VERIFY_FAILED_MESSAGE = 'Payment verification failed, contact support'

export type BillingPlan = {
  id: string
  name: string
  price_inr: number
  max_gmail_connections: number
  max_drive_connections: number
  max_api_connections: number
  combined_gmail_drive_cap?: number
  max_jobs: number
  ai_credits_included: number
  emails_included: number
}

export type BillingCurrent = {
  plan_id: string
  subscription_status: string
  ai_credits_remaining: number
  ai_credits_used: number
  emails_limit: number
  emails_sent_this_cycle: number
  jobs_created_this_cycle?: number
  billing_cycle_start: string
  billing_cycle_end: string
  plan: BillingPlan
}

export type WorkspaceUsage = {
  planId: string
  planName: string
  subscriptionStatus: string
  priceInr: number
  priceLabel: string
  billingCycle: string
  renews: string | null
  aiCredits: number
  aiCreditsMax: number
  aiCreditsUsed?: number
  emailsIncluded: number
  emailsUsedThisMonth: number
  jobsUsed: number
  jobsMax: number
  gmailMax: number
  driveMax: number
  apiMax: number
  allowDrive: boolean
  allowApi: boolean
  singleConnector: boolean
  isDemo: boolean
  lastPayment: null
  nextPayment: { date: string; amountInr: number; label: string } | null
}

function formatBillingDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

export function isDemoPlan(plan: BillingPlan) {
  return plan.name.toLowerCase() === 'demo' || plan.price_inr === 0
}

export function filterPurchasablePlans(plans: BillingPlan[]) {
  return plans.filter((plan) => !isDemoPlan(plan))
}

export function billingCurrentToUsage(
  current: BillingCurrent,
  purchasablePlans: BillingPlan[] = [],
  jobsUsed?: number,
): WorkspaceUsage {
  const { plan, subscription_status: status } = current
  const isDemo = status === 'demo' || isDemoPlan(plan)
  const starterPlan = purchasablePlans.find((p) => p.name.toLowerCase() === 'starter')
    || purchasablePlans[0]

  return {
    planId: current.plan_id,
    planName: plan.name,
    subscriptionStatus: status,
    priceInr: plan.price_inr,
    priceLabel: plan.price_inr === 0 ? 'Free' : `₹${plan.price_inr.toLocaleString('en-IN')}`,
    billingCycle: isDemo ? 'Trial access' : 'Billed monthly',
    renews: isDemo ? null : formatBillingDate(current.billing_cycle_end),
    aiCredits: current.ai_credits_remaining,
    aiCreditsMax: plan.ai_credits_included,
    aiCreditsUsed: current.ai_credits_used,
    emailsIncluded: current.emails_limit || plan.emails_included,
    emailsUsedThisMonth: current.emails_sent_this_cycle,
    jobsUsed: jobsUsed ?? current.jobs_created_this_cycle ?? 0,
    jobsMax: plan.max_jobs,
    gmailMax: plan.max_gmail_connections,
    driveMax: plan.max_drive_connections,
    apiMax: plan.max_api_connections,
    allowDrive: plan.max_drive_connections > 0,
    allowApi: plan.max_api_connections > 0,
    singleConnector: isDemo && (plan.combined_gmail_drive_cap ?? 1) <= 1,
    isDemo,
    lastPayment: null,
    nextPayment: isDemo && starterPlan
      ? {
          date: 'After upgrade',
          amountInr: starterPlan.price_inr,
          label: `${starterPlan.name} from ₹${starterPlan.price_inr}/mo`,
        }
      : !isDemo
        ? {
            date: formatBillingDate(current.billing_cycle_end),
            amountInr: plan.price_inr,
            label: `${plan.name} plan renewal`,
          }
        : null,
  }
}

export function planToUpgradeOption(plan: BillingPlan) {
  const driveCount = plan.max_drive_connections
  const apiCount = plan.max_api_connections

  return {
    id: plan.id,
    name: plan.name,
    emails: plan.emails_included,
    priceInr: plan.price_inr,
    features: [
      { icon: 'envelope', text: `${plan.max_gmail_connections} Gmail connection${plan.max_gmail_connections === 1 ? '' : 's'}` },
      { icon: 'folder', text: `${driveCount} Drive connection${driveCount === 1 ? '' : 's'}` },
      { icon: 'plug', text: `${apiCount} API connection${apiCount === 1 ? '' : 's'}` },
      { icon: 'database', text: `${plan.ai_credits_included.toLocaleString('en-IN')} AI credits` },
      { icon: 'briefcase', text: `${plan.max_jobs} job${plan.max_jobs === 1 ? '' : 's'}` },
    ],
  }
}

export function getBillingCurrent() {
  return api.get('/api/billing/current') as Promise<BillingCurrent>
}

export function getBillingPlans() {
  return api.get('/api/billing/plans') as Promise<BillingPlan[]>
}

export function createBillingOrder(planId: string) {
  return api.post('/api/billing/create-order', { plan_id: planId }) as Promise<CreateOrderResponse>
}

export async function verifyBillingPayment(payload: RazorpaySuccessResponse) {
  const baseUrl = import.meta.env.VITE_API_URL
  const token = localStorage.getItem('token')

  const res = await fetch(`${baseUrl}/api/billing/verify-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (res.status === 400) {
    throw new Error('PAYMENT_VERIFY_FAILED')
  }

  if (!res.ok) {
    const contentType = res.headers.get('content-type') || ''
    const data = contentType.includes('application/json') ? await res.json() : null
    const detail = typeof data === 'object' && data !== null && 'detail' in data
      ? String((data as { detail?: unknown }).detail)
      : undefined
    throw new Error(detail || 'Something went wrong')
  }
}
