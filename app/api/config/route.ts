import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { DEFAULT_TRANSFER_RULES } from '@/lib/transfer-rules'

export async function GET() {
  let { data: config } = await supabaseAdmin.from('chat_agent_config').select('*').maybeSingle()
  if (!config) {
    const { data: newConfig } = await supabaseAdmin
      .from('chat_agent_config')
      .insert({ transfer_rules: DEFAULT_TRANSFER_RULES })
      .select()
      .single()
    config = newConfig
  }
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  const { system_prompt, ai_model, temperature } = await req.json()
  let { data: config } = await supabaseAdmin.from('chat_agent_config').select('id').maybeSingle()

  if (config) {
    const { data: updated } = await supabaseAdmin
      .from('chat_agent_config')
      .update({ system_prompt, ai_model, temperature, updated_at: new Date().toISOString() })
      .eq('id', config.id)
      .select()
      .single()
    return NextResponse.json(updated)
  }

  const { data: created } = await supabaseAdmin
    .from('chat_agent_config')
    .insert({ system_prompt, ai_model, temperature })
    .select()
    .single()
  return NextResponse.json(created)
}
