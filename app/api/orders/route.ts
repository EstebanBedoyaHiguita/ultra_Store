import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source') // 'ecommerce' | 'chatbot' | null = all
  const status = searchParams.get('status')

  let query = supabaseAdmin
    .from('orders')
    .select(`
      id, guest_phone, guest_email, status, total, shipping_address,
      payment_method, created_at,
      order_items(id, quantity, unit_price, product_id,
        products(name, images)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) {
    console.error('[orders GET]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Enrich with source/chat_room_id if columns exist (added by schema-chat.sql)
  let enriched: Record<string, unknown>[] = (data ?? []) as Record<string, unknown>[]
  try {
    const { data: withSource } = await supabaseAdmin
      .from('orders')
      .select('id, source, chat_room_id')
      .in('id', enriched.map((o) => o.id as string))
    if (withSource) {
      const map = Object.fromEntries(withSource.map((r) => [r.id, r]))
      enriched = enriched.map((o) => ({ ...o, source: map[o.id as string]?.source ?? 'ecommerce', chat_room_id: map[o.id as string]?.chat_room_id ?? null }))
    }
  } catch { /* columns not yet added — default source to ecommerce */ }

  if (source && source !== 'all') {
    enriched = enriched.filter((o) => (o.source ?? 'ecommerce') === source)
  }

  return NextResponse.json(enriched)
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('orders').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
