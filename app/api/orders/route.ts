import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source') // 'ecommerce' | 'chatbot' | null = all
  const status = searchParams.get('status')

  let baseQuery = supabaseAdmin
    .from('orders')
    .select('id, guest_phone, guest_email, status, total, shipping_address, payment_method, created_at, source, chat_room_id')
    .order('created_at', { ascending: false })
    .limit(200)

  if (status) baseQuery = baseQuery.eq('status', status)

  const { data, error } = await baseQuery
  if (error) {
    console.error('[orders GET]', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let enriched: Record<string, unknown>[] = (data ?? []).map((o) => ({
    ...o,
    source: o.source ?? 'ecommerce',
  }))

  if (source && source !== 'all') {
    enriched = enriched.filter((o) => o.source === source)
  }

  // Fetch order_items + product names separately to avoid nested join permission issues
  const orderIds = enriched.map((o) => o.id as string)
  if (orderIds.length > 0) {
    try {
      const { data: items, error: itemsError } = await supabaseAdmin
        .from('order_items')
        .select('id, order_id, quantity, unit_price, product_id')
        .in('order_id', orderIds)
      if (itemsError) console.error('[orders GET] order_items error:', itemsError.message, itemsError.code)

      const productIds = [...new Set((items ?? []).map((i) => i.product_id).filter(Boolean))]
      let productMap: Record<string, { name: string; images: string[] }> = {}
      if (productIds.length > 0) {
        const { data: products, error: productsError } = await supabaseAdmin
          .from('products')
          .select('id, name, images')
          .in('id', productIds)
        if (productsError) console.error('[orders GET] products error:', productsError.message, productsError.code)
        productMap = Object.fromEntries((products ?? []).map((p) => [p.id, { name: p.name, images: p.images ?? [] }]))
      }

      const itemsByOrder: Record<string, unknown[]> = {}
      for (const item of (items ?? [])) {
        if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = []
        const productInfo = productMap[item.product_id] ?? null
        itemsByOrder[item.order_id].push({
          id: item.id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          product_id: item.product_id,
          products: productInfo,
        })
      }

      enriched = enriched.map((o) => ({ ...o, order_items: itemsByOrder[o.id as string] ?? [] }))
    } catch (err) {
      console.error('[orders GET] items fetch error:', err)
    }
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
