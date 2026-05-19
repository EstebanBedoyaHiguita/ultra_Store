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
      payment_method, source, chat_room_id, created_at,
      order_items(id, quantity, unit_price, product_id,
        products(name, images)
      )
    `)
    .order('created_at', { ascending: false })
    .limit(200)

  if (source) query = query.eq('source', source)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function PATCH(req: NextRequest) {
  const { id, status } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('orders').update({ status }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
