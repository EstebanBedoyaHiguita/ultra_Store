import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { closeReasonId } = await req.json()
  if (!closeReasonId) return NextResponse.json({ error: 'closeReasonId required' }, { status: 400 })

  const cookieStore = await cookies()
  const agentName = cookieStore.get('agent_name')?.value ?? 'Asesor'

  const { data: reason } = await supabaseAdmin.from('chat_close_reasons').select('name').eq('id', closeReasonId).single()
  if (!reason) return NextResponse.json({ error: 'Close reason not found' }, { status: 404 })

  const { error } = await supabaseAdmin.from('chat_rooms').update({
    status: 'closed',
    close_reason: reason.name,
    closed_by: agentName,
  }).eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
