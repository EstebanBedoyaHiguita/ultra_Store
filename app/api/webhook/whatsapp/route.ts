import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { supabaseAdmin } from '@/lib/supabase'
import { parseWhatsAppPayload, parseInstagramPayload, sendChannelMessage, sendChannelImage, extractImageUrls, markWhatsAppMessageRead, getWhatsAppMediaAsBase64 } from '@/lib/meta'
import { runAgent, summarizeHistory, RoomKnownData, AgentProduct } from '@/lib/openai-agent'
import { checkKeywordRules, DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'
import type { ChannelType } from '@/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const object = body.object as string

  let parsed
  if (object === 'whatsapp_business_account') {
    parsed = parseWhatsAppPayload(body)
  } else if (object === 'instagram') {
    parsed = parseInstagramPayload(body)
  } else {
    return NextResponse.json({ status: 'ignored' }, { status: 200 })
  }

  if (!parsed) return NextResponse.json({ status: 'ignored' }, { status: 200 })
  waitUntil(processMessage(parsed).catch(console.error))
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}

const UNSUPPORTED_MEDIA_MSG = 'Lo siento, por el momento no puedo procesar este tipo de mensaje. ¿Podrías escribirme en texto lo que necesitas? 😊'

async function processMessage(parsed: {
  from: string; name: string; text: string; messageId: string; timestamp: string
  channel: ChannelType; mediaType?: 'image' | 'audio' | 'video'; mediaId?: string; mediaUrl?: string
}) {
  if (parsed.channel === 'whatsapp') markWhatsAppMessageRead(parsed.messageId)

  // Deduplicate
  const { data: existingMsg } = await supabaseAdmin
    .from('chat_messages')
    .select('id')
    .eq('wa_message_id', parsed.messageId)
    .maybeSingle()
  if (existingMsg) return

  // Get or create room
  const roomKey = parsed.from
  let { data: room } = await supabaseAdmin
    .from('chat_rooms')
    .select('*')
    .eq('wa_id', roomKey)
    .eq('channel', parsed.channel)
    .maybeSingle()

  if (!room) {
    const { data: newRoom } = await supabaseAdmin
      .from('chat_rooms')
      .insert({
        wa_id: roomKey,
        channel: parsed.channel,
        customer_name: parsed.name,
        customer_phone: parsed.from,
        status: 'bot',
        last_message: parsed.text,
        last_message_at: new Date().toISOString(),
        window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()
    room = newRoom
  } else {
    const updates: Record<string, unknown> = {
      last_message: parsed.text,
      last_message_at: new Date().toISOString(),
      window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      unread_count: (room.unread_count ?? 0) + 1,
    }
    if (room.customer_name === 'Desconocido' && parsed.name !== 'Desconocido') {
      updates.customer_name = parsed.name
    }
    await supabaseAdmin.from('chat_rooms').update(updates).eq('id', room.id)
    room = { ...room, ...updates }
  }

  if (!room) return

  const inboundContent = parsed.mediaType
    ? parsed.mediaType === 'image' ? `[Imagen${parsed.text ? `: ${parsed.text}` : ''}]`
      : parsed.mediaType === 'audio' ? '[Audio]' : '[Video]'
    : parsed.text

  await supabaseAdmin.from('chat_messages').insert({
    room_id: room.id,
    wa_message_id: parsed.messageId,
    direction: 'inbound',
    sender_type: 'user',
    content: inboundContent,
    message_type: parsed.mediaType ?? 'text',
  })

  if (room.status === 'closed') {
    await supabaseAdmin.from('chat_rooms').update({
      status: 'bot',
      close_reason: null,
      closed_by: null,
      window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).eq('id', room.id)
    room = { ...room, status: 'bot' }
  }

  if (room.status !== 'bot') return

  if (parsed.mediaType === 'audio' || parsed.mediaType === 'video') {
    const waId = await sendChannelMessage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, UNSUPPORTED_MEDIA_MSG)
    await supabaseAdmin.from('chat_messages').insert({
      room_id: room.id, direction: 'outbound', sender_type: 'bot', content: UNSUPPORTED_MEDIA_MSG,
      wa_message_id: waId ?? undefined,
    })
    await supabaseAdmin.from('chat_rooms').update({ last_message: UNSUPPORTED_MEDIA_MSG, last_message_at: new Date().toISOString() }).eq('id', room.id)
    return
  }

  let imageMediaUrl: string | undefined
  if (parsed.mediaType === 'image') {
    if (parsed.mediaId) {
      imageMediaUrl = (await getWhatsAppMediaAsBase64(parsed.mediaId)) ?? undefined
    } else if (parsed.mediaUrl) {
      imageMediaUrl = parsed.mediaUrl
    }
  }

  // Load agent config
  let { data: config } = await supabaseAdmin.from('chat_agent_config').select('*').maybeSingle()
  if (!config) {
    const { data: newConfig } = await supabaseAdmin.from('chat_agent_config').insert({ transfer_rules: DEFAULT_TRANSFER_RULES }).select().single()
    config = newConfig
  }

  const transferRules = Array.isArray(config?.transfer_rules) ? config.transfer_rules : DEFAULT_TRANSFER_RULES
  const keywordCheck = checkKeywordRules(parsed.text, transferRules)
  if (keywordCheck.triggered) {
    await supabaseAdmin.from('chat_rooms').update({ status: 'human' }).eq('id', room.id)
    await sendChannelMessage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, 'En este momento te voy a conectar con un asesor. Por favor espera un momento. 🙏')
    return
  }

  // Get conversation history
  const { data: historyRaw } = await supabaseAdmin
    .from('chat_messages')
    .select('*')
    .eq('room_id', room.id)
    .order('created_at', { ascending: false })
    .limit(10)
  const history = (historyRaw ?? []).reverse()

  const roomData: RoomKnownData = {
    id: room.id,
    name: room.customer_name || undefined,
    gender: room.customer_gender || undefined,
    address: room.customer_address || undefined,
    city: room.customer_city || undefined,
    phone: room.customer_phone || undefined,
  }

  const agentResponse = await runAgent(
    parsed.text || (parsed.mediaType === 'image' ? 'El cliente envió una imagen.' : ''),
    history.map((m) => ({
      id: m.id, room_id: m.room_id, direction: m.direction,
      sender_type: m.sender_type, content: m.content, wa_message_id: m.wa_message_id,
      message_type: m.message_type ?? 'text', created_at: m.created_at,
    })),
    config?.system_prompt ?? '',
    transferRules,
    config?.ai_model ?? 'gpt-4o-mini',
    config?.temperature ?? 0.7,
    room.context_summary ?? '',
    roomData,
    imageMediaUrl
  )

  const { cleanText } = extractImageUrls(agentResponse.text)

  if (agentResponse.products.length > 0) {
    for (const product of (agentResponse.products as AgentProduct[]).slice(0, 2)) {
      const caption = `${product.name}\n$${product.price.toLocaleString('es-CO')} COP\n${product.description}`
      const content = product.imageUrl ? `${product.imageUrl}\n${caption}` : caption
      let waId: string | null = null
      if (product.imageUrl) {
        waId = await sendChannelImage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, product.imageUrl, caption)
      } else {
        waId = await sendChannelMessage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, caption)
      }
      await supabaseAdmin.from('chat_messages').insert({
        room_id: room.id, direction: 'outbound', sender_type: 'bot', content,
        wa_message_id: waId ?? undefined,
      })
    }
  } else {
    const waId = await sendChannelMessage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, cleanText)
    await supabaseAdmin.from('chat_messages').insert({
      room_id: room.id, direction: 'outbound', sender_type: 'bot', content: cleanText,
      wa_message_id: waId ?? undefined,
    })
  }

  // Summarize if >6 messages (fire-and-forget, errors logged)
  void (async () => {
    try {
      const { count } = await supabaseAdmin.from('chat_messages').select('id', { count: 'exact', head: true }).eq('room_id', room.id)
      if ((count ?? 0) > 6) {
        const { data: allMsgs } = await supabaseAdmin.from('chat_messages').select('*').eq('room_id', room.id).order('created_at')
        const summary = await summarizeHistory((allMsgs ?? []).map((m) => ({
          id: m.id, room_id: m.room_id, direction: m.direction,
          sender_type: m.sender_type, content: m.content, wa_message_id: m.wa_message_id,
          message_type: m.message_type ?? 'text', created_at: m.created_at,
        })))
        if (summary) await supabaseAdmin.from('chat_rooms').update({ context_summary: summary }).eq('id', room.id)
      }
    } catch (err) { console.error('[summarize]', err) }
  })()

  const roomUpdates: Record<string, unknown> = {
    last_message: agentResponse.text,
    last_message_at: new Date().toISOString(),
  }
  if (agentResponse.transfer) {
    roomUpdates.status = 'human'
    await sendChannelMessage(parsed.channel as 'whatsapp' | 'instagram', parsed.from, 'Te voy a conectar con un asesor. ¡Ya te atienden! 🙏')
  }
  if (agentResponse.orderCreated) {
    roomUpdates.status = 'closed'
    roomUpdates.close_reason = 'Pedido realizado'
    roomUpdates.closed_by = 'bot'
  }
  await supabaseAdmin.from('chat_rooms').update(roomUpdates).eq('id', room.id)
}
