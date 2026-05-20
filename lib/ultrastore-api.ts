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
}): Promise<{ id: string; name: string }[]> {
  let query = supabaseAdmin
    .from('products')
    .select('brand_id, brand:brands(id, name)')
    .eq('is_active', true)

  if (filters?.categorySlug) {
    const { data: cat } = await supabaseAdmin
      .from('categories')
      .select('id')
      .eq('slug', filters.categorySlug)
      .single()
    if (cat) query = query.eq('category_id', cat.id)
  }

  const { data, error } = await query
  if (error) { console.error('[ultrastore] getBrands:', error.message); return [] }

  const seen = new Set<string>()
  const brands: { id: string; name: string }[] = []
  for (const row of (data ?? [])) {
    const b = (row as unknown as { brand: { id: string; name: string } }).brand
    if (b && !seen.has(b.id)) {
      seen.add(b.id)
      brands.push({ id: b.id, name: b.name })
    }
  }
  return brands
}

export async function getProducts(filters?: {
  categorySlug?: string
  gender?: string
  search?: string
  brandName?: string
}): Promise<UltraProduct[]> {
  let query = supabaseAdmin
    .from('products')
    .select(`
      id, name, description, base_price, gender, images,
      brand:brands(id, name),
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

  if (filters?.brandName) {
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id')
      .ilike('name', `%${filters.brandName}%`)
      .single()
    if (brand) query = query.eq('brand_id', brand.id)
  } else if (filters?.gender && filters.gender !== 'unisex') {
    // Only filter by gender when no brand is specified
    query = query.in('gender', [filters.gender, 'unisex'])
  }

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(5)
  if (error) { console.error('[ultrastore] getProducts:', error.message); return [] }
  return (data ?? []) as unknown as UltraProduct[]
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
    productId: string
    variantId?: string
    productName: string
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

  const orderItems = params.items.map((item) => ({
    order_id: order.id,
    product_id: item.productId,
    variant_id: item.variantId ?? null,
    quantity: item.quantity,
    unit_price: item.unitPrice,
  }))

  const { error: itemsErr } = await supabaseAdmin.from('order_items').insert(orderItems)
  if (itemsErr) console.error('[ultrastore] createOrder items:', itemsErr.message)

  const orderNumber = `US-${order.id.slice(0, 8).toUpperCase()}`

  return { success: true, orderId: order.id, orderNumber, subtotal, total }
}
