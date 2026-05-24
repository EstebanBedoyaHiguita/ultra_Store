import { supabaseAdmin } from './supabase'
import type { UltraProduct, UltraCategory } from '@/types'

export async function getCategories(): Promise<UltraCategory[]> {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('id, name, slug, image_url')
    .order('name')

  if (error) { console.error('[ultrastore] getCategories:', error.message); return [] }
  return data ?? []
}

export async function getBrands(filters?: {
  categorySlug?: string
  gender?: string
}): Promise<{ id: string; name: string }[]> {
  let query = supabaseAdmin
    .from('products')
    .select('brand_id, brand:brands(id, name), variants:product_variants(stock)')
    .eq('is_active', true)

  if (filters?.categorySlug) {
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', filters.categorySlug)
      .single()
    if (cat) query = query.eq('category_id', cat.id)
  }

  const normalizedGender = filters?.gender?.toLowerCase().trim()
  if (normalizedGender && normalizedGender !== 'unisex') {
    query = query.or(`gender.ilike.${normalizedGender},gender.ilike.unisex`)
  }

  let { data, error } = await query
  if (error) { console.error('[ultrastore] getBrands:', error.message); return [] }

  // Fallback sin filtro de género si no hay resultados
  if ((data ?? []).length === 0 && normalizedGender) {
    const { data: fallback } = await supabaseAdmin
      .from('products')
      .select('brand_id, brand:brands(id, name), variants:product_variants(stock)')
      .eq('is_active', true)
    data = fallback
  }

  const seen = new Set<string>()
  const brands: { id: string; name: string }[] = []
  for (const row of (data ?? [])) {
    const r = row as unknown as { brand: { id: string; name: string }; variants: { stock: number }[] }
    const hasStock = (r.variants ?? []).some((v) => (v.stock ?? 0) > 0)
    if (r.brand && hasStock && !seen.has(r.brand.id)) {
      seen.add(r.brand.id)
      brands.push({ id: r.brand.id, name: r.brand.name })
    }
  }
  return brands
}

export async function getProducts(filters?: {
  categorySlug?: string
  gender?: string
  search?: string
  brandName?: string
  color?: string
  size?: string
}): Promise<UltraProduct[]> {
  let query = supabaseAdmin
    .from('products')
    .select(`
      id, name, description, base_price, gender, images,
      brand:brands(name),
      category:categories(name, slug),
      variants:product_variants(id, size, color, stock)
    `)
    .eq('is_active', true)

  if (filters?.categorySlug) {
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', filters.categorySlug)
      .single()
    if (cat) query = query.eq('category_id', cat.id)
  }

  const normalizedGender = filters?.gender?.toLowerCase().trim()
  if (filters?.brandName) {
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id')
      .ilike('name', `%${filters.brandName}%`)
      .single()
    if (brand) query = query.eq('brand_id', brand.id)
  } else if (normalizedGender && normalizedGender !== 'unisex') {
    query = query.or(`gender.ilike.${normalizedGender},gender.ilike.unisex`)
  }

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  let { data, error } = await query.order('created_at', { ascending: false }).limit(10)
  if (error) { console.error('[ultrastore] getProducts:', error.message); return [] }

  // If no results with gender filter and no brand specified, retry without gender
  if ((data ?? []).length === 0 && filters?.gender && !filters.brandName) {
    const { data: fallback } = await supabaseAdmin
      .from('products')
      .select(`
        id, name, description, base_price, gender, images,
        brand:brands(id, name),
        category:categories(name, slug),
        variants:product_variants(id, size, color, stock)
      `)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10)
    data = fallback
  }

  let products = (data ?? []) as unknown as UltraProduct[]

  // Post-filter by color and/or size on variants
  const filterColor = filters?.color?.toLowerCase().trim()
  const filterSize = filters?.size?.toLowerCase().trim()
  if (filterColor || filterSize) {
    products = products.filter((p) => {
      const variants = (p as unknown as { variants: { size: string; color: string; stock: number }[] }).variants ?? []
      return variants.some((v) => {
        if ((v.stock ?? 0) === 0) return false
        const colorMatch = !filterColor || v.color.toLowerCase().includes(filterColor)
        const sizeMatch = !filterSize || v.size.toLowerCase() === filterSize
        return colorMatch && sizeMatch
      })
    })
  }

  return products
}

export async function getProductById(id: string): Promise<UltraProduct | null> {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select(`
      id, name, description, base_price, gender, images,
      brand:brands(name),
      category:categories(name, slug),
      variants:product_variants(id, size, color, stock)
    `)
    .eq('id', id)
    .single()

  if (error) { console.error('[ultrastore] getProductById:', error.message); return null }
  return data as unknown as UltraProduct
}

export async function getProductVariants(productId: string) {
  const { data, error } = await supabaseAdmin
    .from('product_variants')
    .select('*')
    .eq('product_id', productId)
    .gt('stock', 0)
    .order('size')

  if (error) { console.error('[ultrastore] getProductVariants:', error.message); return [] }
  return data ?? []
}

export async function createOrder(params: {
  roomId: string
  customerName: string
  customerPhone: string
  address: string
  city: string
  department: string
  notes?: string
  paymentMethod: 'bold' | 'contraentrega'
  items: Array<{
    productId?: string
    variantId?: string
    productName?: string
    size?: string
    quantity: number
    unitPrice: number
  }>
}): Promise<{ success: boolean; orderId?: string; orderNumber?: string; subtotal?: number; total?: number; error?: string }> {
  const subtotal = params.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0)
  const shipping = 15000
  const total = subtotal + shipping

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .insert({
      guest_phone: params.customerPhone,
      guest_email: null,
      status: 'pendiente',
      total,
      shipping_address: {
        full_name: params.customerName,
        address: params.address,
        city: params.city,
        department: params.department,
        notes: params.notes ?? '',
      },
      payment_method: params.paymentMethod,
      source: 'chatbot',
      chat_room_id: params.roomId,
    })
    .select('id')
    .single()

  if (orderErr || !order) {
    console.error('[ultrastore] createOrder insert:', orderErr?.message)
    return { success: false, error: orderErr?.message ?? 'Error al crear el pedido' }
  }

  const isUUID = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  const toUUID = (s: string | undefined) => (s && isUUID(s) ? s : null)

  // Fetch real prices from DB to avoid model hallucinating wrong prices
  const productIds = params.items.map((i) => toUUID(i.productId)).filter(Boolean) as string[]
  const realPrices: Record<string, number> = {}
  if (productIds.length > 0) {
    const { data: priceRows } = await supabaseAdmin
      .from('products')
      .select('id, base_price')
      .in('id', productIds)
    for (const row of (priceRows ?? [])) realPrices[row.id] = row.base_price
  }

  const orderItems = params.items.map((item) => {
    const pid = toUUID(item.productId)
    const realPrice = pid ? (realPrices[pid] ?? item.unitPrice) : item.unitPrice
    return {
      order_id: order.id,
      product_id: pid,
      variant_id: toUUID(item.variantId),
      product_name: item.productName ?? null,
      quantity: item.quantity,
      unit_price: realPrice,
    }
  })

  // Recalculate subtotal and total with real prices
  const realSubtotal = orderItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
  const realTotal = realSubtotal + shipping

  const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(orderItems)
  if (itemsErr) {
    console.error('[ultrastore] createOrder items:', itemsErr.message, itemsErr.code)
    // Fallback: reintentar sin product_name por si la columna no existe aún
    const itemsWithoutName = orderItems.map(({ product_name: _pn, ...rest }) => rest)
    const { error: itemsErr2 } = await supabaseAdmin.from('order_items').insert(itemsWithoutName)
    if (itemsErr2) console.error('[ultrastore] createOrder items fallback:', itemsErr2.message, itemsErr2.code)
    else console.log('[ultrastore] createOrder items fallback OK (product_name column missing?)')
  }

  // Descontar stock de cada variante
  for (const item of params.items) {
    let vid = toUUID(item.variantId)

    // Si no hay variant_id válido pero sí hay product_id + size, buscar el variant
    if (!vid && toUUID(item.productId) && item.size) {
      const { data: found } = await supabaseAdmin
        .from('product_variants')
        .select('id, stock')
        .eq('product_id', toUUID(item.productId) as string)
        .ilike('size', item.size.trim())
        .gt('stock', 0)
        .limit(1)
        .single()
      if (found) vid = found.id
    }

    if (!vid) {
      console.log('[ultrastore] createOrder: no variant_id para item', item.productName, item.size)
      continue
    }

    const { data: variant } = await supabaseAdmin
      .from('product_variants')
      .select('stock')
      .eq('id', vid)
      .single()
    if (variant) {
      await supabaseAdmin
        .from('product_variants')
        .update({ stock: Math.max(0, variant.stock - item.quantity) })
        .eq('id', vid)
      console.log('[ultrastore] stock descontado: variant', vid, '→', Math.max(0, variant.stock - item.quantity))
    }
  }

  // Update order total with real prices if they differ
  if (realTotal !== total) {
    await supabaseAdmin.from('orders').update({ total: realTotal }).eq('id', order.id)
  }

  const orderNumber = `US-${order.id.slice(0, 8).toUpperCase()}`

  return { success: true, orderId: order.id, orderNumber, subtotal: realSubtotal, total: realTotal }
}
