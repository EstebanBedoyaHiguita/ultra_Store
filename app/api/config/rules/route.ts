import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const { data: config } = await supabaseAdmin.from('chat_agent_config').select('transfer_rules').maybeSingle()
  return NextResponse.json(config?.transfer_rules ?? [])
}

export async function PUT(req: NextRequest) {
  const { rules } = await req.json()
  const { data: config } = await supabaseAdmin.from('chat_agent_config').select('id').maybeSingle()
  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 404 })

  await supabaseAdmin.from('chat_agent_config').update({ transfer_rules: rules }).eq('id', config.id)
  return NextResponse.json({ success: true })
}
