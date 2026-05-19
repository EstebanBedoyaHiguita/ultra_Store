import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const results: Record<string, unknown> = {
    env: {
      supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'MISSING',
      service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING',
    },
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('chat_rooms')
      .select('count', { count: 'exact', head: true })
    results.chat_rooms = error ? { error: error.message, code: error.code } : { ok: true, count: data }
  } catch (e) {
    results.chat_rooms = { exception: String(e) }
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('count', { count: 'exact', head: true })
    results.orders = error ? { error: error.message, code: error.code } : { ok: true }
  } catch (e) {
    results.orders = { exception: String(e) }
  }

  return NextResponse.json(results)
}
