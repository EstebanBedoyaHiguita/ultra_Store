import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendWhatsAppTemplate } from '@/lib/meta'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { templateName, languageCode = 'es', variables = [], bodyText = '' } = await req.json()
  if (!templateName) return NextResponse.json({ error: 'templateName requerido' }, { status: 400 })

  const { data: room } = await supabaseAdmin.from('chat_rooms').select('*').eq('id', id).single()
  if (!room) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  const components = variables.length > 0
    ? [{ type: 'body', parameters: variables.map((v: string) => ({ type: 'text', text: v })) }]
    : []

  const { messageId: waMessageId, error: metaError } = await sendWhatsAppTemplate(room.wa_id, templateName, languageCode, components)
  if (metaError || !waMessageId) {
    return NextResponse.json({ error: metaError ?? 'Meta no devolvió ID del mensaje' }, { status: 500 })
  }

  const content = bodyText || `[Plantilla: ${templateName}]`
  await supabaseAdmin.from('chat_messages').insert({
    room_id: room.id, direction: 'outbound', sender_type: 'bot', content, wa_message_id: waMessageId,
  })

  await supabaseAdmin.from('chat_rooms').update({
    status: 'bot',
    window_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    last_message: content,
    last_message_at: new Date().toISOString(),
  }).eq('id', id)

  return NextResponse.json({ success: true, waMessageId })
}
