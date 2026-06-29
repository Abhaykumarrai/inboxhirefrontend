const BASE_URL = import.meta.env.VITE_API_URL

export async function speak(text: string, languageCode: string | null = null) {
  const token = localStorage.getItem('token')
  const res = await fetch(`${BASE_URL}/api/voice/speak`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, language_code: languageCode }),
  })

  if (res.status === 401) {
    if (token) {
      localStorage.removeItem('token')
      sessionStorage.removeItem('must_change_password')
      window.location.href = '/'
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    let detail = 'Could not play voice reply'
    try {
      const data = await res.json()
      if (typeof data === 'object' && data !== null && 'detail' in data) {
        detail = String(data.detail)
      }
    } catch {
      /* response may not be JSON */
    }
    throw new Error(detail)
  }

  const blob = await res.blob()
  const audioUrl = URL.createObjectURL(blob)
  const audio = new Audio(audioUrl)

  audio.addEventListener('ended', () => URL.revokeObjectURL(audioUrl), { once: true })
  audio.addEventListener('error', () => URL.revokeObjectURL(audioUrl), { once: true })

  return audio
}

export function playAgentReply(text: string, languageCode: string | null = null) {
  speak(text, languageCode)
    .then((audio) => audio.play())
    .catch(() => {
      /* voice playback is optional — don't block the chat UI */
    })
}
