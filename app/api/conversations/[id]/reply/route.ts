import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendChannelMessage } from '@/lib/meta'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { text } = await req.json()
  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  if (!text?.trim()) return NextResponse.json({ error: 'Message text required' }, { status: 400 })

  const { data: room } = await supabaseAdmin.from('chat_rooms').select('*').eq('id', id).single()
  if (!room) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const channel = (room.channel ?? 'whatsapp') as 'whatsapp' | 'instagram'
  const waId = await sendChannelMessage(channel, room.wa_id, text)

  const { data: message } = await supabaseAdmin.from('chat_messages').insert({
    room_id: room.id,
    direction: 'outbound',
    sender_type: 'human',
    content: text,
    wa_message_id: waId ?? undefined,
  }).select().single()

  await supabaseAdmin.from('chat_rooms').update({
    last_message: text,
    last_message_at: new Date().toISOString(),
    assigned_to: agentName,
  }).eq('id', id)

  return NextResponse.json(message)
}
