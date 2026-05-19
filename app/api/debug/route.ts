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
    const { data: rows, error, status, statusText } = await supabaseAdmin
      .from('chat_rooms')
      .select('id')
      .limit(1)
    results.chat_rooms = error
      ? { error: error.message, code: error.code, details: error.details, hint: error.hint, status, statusText }
      : { ok: true, rows: rows?.length ?? 0 }
  } catch (e) {
    results.chat_rooms = { exception: String(e) }
  }

  try {
    const { error: ordersError } = await supabaseAdmin
      .from('orders')
      .select('id')
      .limit(1)
    results.orders = ordersError ? { error: ordersError.message, code: ordersError.code } : { ok: true }
  } catch (e) {
    results.orders = { exception: String(e) }
  }

  try {
    const { data: variants, error: varError } = await supabaseAdmin
      .from('product_variants')
      .select('id, stock')
      .limit(3)
    results.product_variants = varError
      ? { error: varError.message, code: varError.code }
      : { ok: true, sample: variants }
  } catch (e) {
    results.product_variants = { exception: String(e) }
  }

  return NextResponse.json(results)
}
