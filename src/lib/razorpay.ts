const RAZORPAY_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

export type CreateOrderResponse = {
  order_id: string
  amount: number
  currency: string
  key_id: string
  plan_name: string
}

export type RazorpaySuccessResponse = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

let scriptPromise: Promise<void> | null = null

function loadRazorpayScript() {
  if (typeof window !== 'undefined' && (window as Window & { Razorpay?: unknown }).Razorpay) {
    return Promise.resolve()
  }
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = RAZORPAY_SCRIPT
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load payment gateway'))
    document.body.appendChild(script)
  })

  return scriptPromise
}

export async function openRazorpayCheckout(
  order: CreateOrderResponse,
  onSuccess: (response: RazorpaySuccessResponse) => void,
  onDismiss?: () => void,
) {
  await loadRazorpayScript()

  const Razorpay = (window as Window & {
    Razorpay: new (options: Record<string, unknown>) => { open: () => void }
  }).Razorpay

  const checkout = new Razorpay({
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    order_id: order.order_id,
    name: 'InboxHire',
    description: `${order.plan_name} plan`,
    handler(response: RazorpaySuccessResponse) {
      onSuccess(response)
    },
    modal: {
      ondismiss() {
        onDismiss?.()
      },
    },
  })

  checkout.open()
}
