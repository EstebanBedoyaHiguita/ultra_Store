const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN
const INSTAGRAM_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN
const INSTAGRAM_BUSINESS_ID = process.env.INSTAGRAM_BUSINESS_ID
const API_VERSION = 'v25.0'

// ── WhatsApp ──────────────────────────────────────────────────────────────────

const WA_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`

async function sendToWhatsApp(payload: Record<string, unknown>): Promise<string | null> {
  if (!PHONE_NUMBER_ID || !WA_TOKEN) { console.error('WhatsApp credentials not configured'); return null }
  const res = await fetch(WA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) { console.error('WA send error:', await res.json()); return null }
  const data = await res.json()
  return data.messages?.[0]?.id ?? null
}

export async function markWhatsAppMessageRead(messageId: string): Promise<void> {
  if (!PHONE_NUMBER_ID || !WA_TOKEN) return
  fetch(WA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  }).catch(() => {})
}

export async function sendWhatsAppMessage(to: string, text: string): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp', recipient_type: 'individual', to,
    type: 'text', text: { body: text },
  })
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string): Promise<string | null> {
  return sendToWhatsApp({
    messaging_product: 'whatsapp', recipient_type: 'individual', to,
    type: 'image', image: { link: imageUrl, ...(caption ? { caption } : {}) },
  })
}

export async function sendWhatsAppTemplate(
  to: string, templateName: string, languageCode: string,
  components: Record<string, unknown>[] = []
): Promise<{ messageId: string | null; error: string | null }> {
  if (!PHONE_NUMBER_ID || !WA_TOKEN) return { messageId: null, error: 'WhatsApp credentials not configured' }
  const res = await fetch(WA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template',
      template: { name: templateName, language: { code: languageCode }, ...(components.length > 0 ? { components } : {}) },
    }),
  })
  const data = await res.json()
  if (!res.ok) {
    const msg = data?.error?.message ?? JSON.stringify(data)
    console.error('WA template error:', msg)
    return { messageId: null, error: msg }
  }
  return { messageId: data.messages?.[0]?.id ?? null, error: null }
}

export async function getWhatsAppMediaAsBase64(mediaId: string): Promise<string | null> {
  if (!WA_TOKEN) return null
  const metaRes = await fetch(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_TOKEN}` },
  })
  if (!metaRes.ok) return null
  const metaData = await metaRes.json()
  const mimeType = (metaData.mime_type as string) ?? 'image/jpeg'
  const mediaRes = await fetch(metaData.url as string, { headers: { Authorization: `Bearer ${WA_TOKEN}` } })
  if (!mediaRes.ok) return null
  const base64 = Buffer.from(await mediaRes.arrayBuffer()).toString('base64')
  return `data:${mimeType};base64,${base64}`
}

// ── Instagram ─────────────────────────────────────────────────────────────────

const IG_URL = `https://graph.facebook.com/${API_VERSION}/${INSTAGRAM_BUSINESS_ID}/messages`

async function sendToInstagram(recipientId: string, payload: Record<string, unknown>): Promise<string | null> {
  if (!INSTAGRAM_TOKEN || !INSTAGRAM_BUSINESS_ID) { console.error('Instagram credentials not configured'); return null }
  const res = await fetch(`${IG_URL}?access_token=${INSTAGRAM_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, ...payload }),
  })
  const data = await res.json()
  if (!res.ok) { console.error('IG send error:', data); return null }
  return data.message_id ?? null
}

async function sendInstagramMessage(recipientId: string, text: string): Promise<string | null> {
  return sendToInstagram(recipientId, { message: { text } })
}

async function sendInstagramImage(recipientId: string, imageUrl: string, caption?: string): Promise<string | null> {
  const id = await sendToInstagram(recipientId, {
    message: { attachment: { type: 'image', payload: { url: imageUrl, is_reusable: true } } },
  })
  if (caption && id) await sendInstagramMessage(recipientId, caption)
  return id
}

// ── Channel-agnostic helpers ──────────────────────────────────────────────────

export async function sendChannelMessage(
  channel: 'whatsapp' | 'instagram',
  recipientId: string,
  text: string
): Promise<string | null> {
  if (channel === 'whatsapp') return sendWhatsAppMessage(recipientId, text)
  return sendInstagramMessage(recipientId, text)
}

export async function sendChannelImage(
  channel: 'whatsapp' | 'instagram',
  recipientId: string,
  imageUrl: string,
  caption?: string
): Promise<string | null> {
  if (channel === 'whatsapp') return sendWhatsAppImage(recipientId, imageUrl, caption)
  return sendInstagramImage(recipientId, imageUrl, caption)
}

// ── Webhook parsers ───────────────────────────────────────────────────────────

export interface IncomingMessage {
  from: string
  name: string
  text: string
  messageId: string
  timestamp: string
  channel: 'whatsapp' | 'instagram'
  mediaType?: 'image' | 'audio' | 'video'
  mediaId?: string
  mediaUrl?: string
}

export function parseWhatsAppPayload(body: Record<string, unknown>): IncomingMessage | null {
  try {
    const entry = (body.entry as Record<string, unknown>[])?.[0]
    const value = ((entry?.changes as Record<string, unknown>[])?.[0])?.value as Record<string, unknown>
    const message = (value?.messages as Record<string, unknown>[])?.[0]
    if (!message) return null

    const contact = (value?.contacts as Record<string, unknown>[])?.[0]
    const name = ((contact?.profile as Record<string, unknown>)?.name as string) ?? 'Desconocido'
    const base = { from: message.from as string, name, messageId: message.id as string, timestamp: message.timestamp as string, channel: 'whatsapp' as const }

    if (message.type === 'text') return { ...base, text: (message.text as Record<string, unknown>)?.body as string }
    if (message.type === 'image') {
      const img = message.image as Record<string, unknown>
      return { ...base, text: (img?.caption as string) ?? '', mediaType: 'image', mediaId: img?.id as string }
    }
    if (message.type === 'audio') return { ...base, text: '', mediaType: 'audio' }
    if (message.type === 'video') return { ...base, text: '', mediaType: 'video' }
    return null
  } catch { return null }
}

export function parseInstagramPayload(body: Record<string, unknown>): IncomingMessage | null {
  try {
    if (body.object !== 'instagram') return null
    const entry = (body.entry as Record<string, unknown>[])?.[0]
    const messaging = (entry?.messaging as Record<string, unknown>[])?.[0]
    if (!messaging) return null
    const message = messaging.message as Record<string, unknown>
    if (!message || message.is_echo) return null

    const sender = messaging.sender as Record<string, unknown>
    const base = { from: sender.id as string, name: 'Desconocido', messageId: message.mid as string, timestamp: String(messaging.timestamp ?? Date.now()), channel: 'instagram' as const }

    if (message.text) return { ...base, text: message.text as string }
    const attachments = message.attachments as Record<string, unknown>[] | undefined
    const att = attachments?.[0]
    if (!att) return null
    const attType = att.type as string
    const payload = att.payload as Record<string, unknown>
    if (attType === 'image') return { ...base, text: '', mediaType: 'image', mediaUrl: payload?.url as string }
    if (attType === 'audio') return { ...base, text: '', mediaType: 'audio' }
    if (attType === 'video') return { ...base, text: '', mediaType: 'video' }
    return null
  } catch { return null }
}

export function extractImageUrls(text: string): { cleanText: string; imageUrls: string[] } {
  const imageUrls: string[] = []
  let cleaned = text.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_m, _a, url) => { imageUrls.push(url); return '' })
  cleaned = cleaned.split('\n').filter((line) => {
    const trimmed = line.trim()
    const match = trimmed.match(/^(?:-?\s*(?:Imagen|imagen|img):\s*)?(https?:\/\/\S+)$/)
    if (match?.[1]) { imageUrls.push(match[1]); return false }
    return true
  }).join('\n')
  return { cleanText: cleaned.trim(), imageUrls }
}
