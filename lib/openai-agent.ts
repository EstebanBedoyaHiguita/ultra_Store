import OpenAI from 'openai'
import { getProducts, getCategories, getBrands, getProductVariants, createOrder } from './ultrastore-api'
import { checkIntentRules } from './transfer-rules'
import type { IMessage, ITransferRule } from '@/types'

let _openai: OpenAI | null = null
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

export interface AgentProduct {
  id: string
  name: string
  price: number
  description: string
  images: string[]
  variantsText: string
  gender: string
  category: string
}

export interface AgentResponse {
  text: string
  transfer: boolean
  transferReason?: string
  imageUrls: string[]
  products: AgentProduct[]
  orderCreated: boolean
}

export interface RoomKnownData {
  id?: string
  name?: string
  gender?: string
  address?: string
  city?: string
  phone?: string
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_brands',
      description: 'Retorna las marcas disponibles para una categoría y género. Llama esta función cuando el cliente exprese interés en una categoría (jeans, camisetas, etc.) para mostrarle las marcas disponibles antes de mostrar productos.',
      parameters: {
        type: 'object',
        properties: {
          category_slug: { type: 'string', description: 'Slug de la categoría: jeans, camisetas, outerwear, shorts, accesorios' },
          gender: { type: 'string', description: 'Género: hombre o mujer. Omitir para todos.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Obtiene hasta 5 productos con sus variantes (tallas y colores). Llama esta función SOLO después de que el cliente haya elegido una marca. Filtra siempre por brand_name y category_slug.',
      parameters: {
        type: 'object',
        properties: {
          category_slug: { type: 'string', description: 'Slug de la categoría (ej: jeans, camisetas)' },
          brand_name: { type: 'string', description: 'Nombre exacto de la marca elegida por el cliente' },
          gender: { type: 'string', description: 'Género: hombre o mujer.' },
          search: { type: 'string', description: 'Búsqueda libre por nombre de producto (solo si no hay brand_name)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_variants',
      description: 'Obtiene tallas y colores con stock de un producto específico. Úsala SOLO si el cliente pregunta por variantes de un producto ya mostrado y necesitas info actualizada. IMPORTANTE: usa el campo "id" UUID del producto, nunca el nombre.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'UUID del producto obtenido del campo "id" en get_products.' },
        },
        required: ['product_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_customer_info',
      description: 'LLAMA ESTA FUNCIÓN INMEDIATAMENTE cada vez que el cliente te dé su nombre, género, dirección o ciudad. No esperes a tener todos los datos. Una llamada por cada dato nuevo.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Nombre del cliente' },
          gender: { type: 'string', description: 'Preferencia de género: hombre, mujer o unisex' },
          address: { type: 'string', description: 'Dirección de entrega' },
          city: { type: 'string', description: 'Ciudad de entrega' },
          phone: { type: 'string', description: 'Teléfono del cliente' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'OBLIGATORIO: Registra el pedido en el sistema cuando el cliente confirme. NUNCA escribas el resumen del pedido sin haber llamado esta función. Retorna orderNumber y total reales — usa SOLO esos valores.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Productos del pedido',
            items: {
              type: 'object',
              properties: {
                product_id: { type: 'string', description: 'ID del producto de get_products' },
                variant_id: { type: 'string', description: 'ID del variant (talla/color) de get_product_variants' },
                product_name: { type: 'string', description: 'Nombre del producto' },
                size: { type: 'string', description: 'Talla elegida' },
                quantity: { type: 'number', description: 'Cantidad' },
                unit_price: { type: 'number', description: 'Precio unitario en COP' },
              },
              required: ['product_name', 'quantity', 'unit_price'],
            },
          },
          address: { type: 'string', description: 'Dirección de entrega' },
          city: { type: 'string', description: 'Ciudad' },
          department: { type: 'string', description: 'Departamento' },
          payment_method: { type: 'string', enum: ['bold', 'contraentrega'], description: 'Método de pago' },
          notes: { type: 'string', description: 'Notas adicionales (opcional)' },
        },
        required: ['items', 'address', 'city', 'payment_method'],
      },
    },
  },
]

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  roomData: RoomKnownData,
  onRoomUpdate: (data: Partial<RoomKnownData>) => void
): Promise<string> {
  console.log('[Tool]', name, JSON.stringify(args))
  try {
    switch (name) {
      case 'get_categories': {
        const cats = await getCategories()
        return JSON.stringify(cats)
      }
      case 'get_brands': {
        const brands = await getBrands({
          categorySlug: args.category_slug as string | undefined,
          gender: args.gender as string | undefined,
        })
        return JSON.stringify(brands)
      }
      case 'get_products': {
        const products = await getProducts({
          categorySlug: args.category_slug as string | undefined,
          gender: args.gender as string | undefined,
          search: args.search as string | undefined,
          brandName: args.brand_name as string | undefined,
        })
        console.log('[get_products] count:', products.length, '| first product variants:', (products[0] as unknown as Record<string, unknown>)?.variants)
        return JSON.stringify(products)
      }
      case 'get_product_variants': {
        const variants = await getProductVariants(args.product_id as string)
        console.log('[get_product_variants] product_id:', args.product_id, '| count:', variants.length, '| data:', JSON.stringify(variants))
        return JSON.stringify(variants)
      }
      case 'update_customer_info': {
        const update: Partial<RoomKnownData> = {}
        if (args.name) update.name = args.name as string
        if (args.gender) update.gender = args.gender as string
        if (args.address) update.address = args.address as string
        if (args.city) update.city = args.city as string
        if (args.phone) update.phone = args.phone as string
        if (Object.keys(update).length > 0) {
          onRoomUpdate(update)
          if (roomData.id) {
            const { supabaseAdmin } = await import('./supabase')
            await supabaseAdmin
              .from('chat_rooms')
              .update({
                ...(update.name && { customer_name: update.name }),
                ...(update.gender && { customer_gender: update.gender }),
                ...(update.address && { customer_address: update.address }),
                ...(update.city && { customer_city: update.city }),
                ...(update.phone && { customer_phone: update.phone }),
              })
              .eq('id', roomData.id)
          }
        }
        return JSON.stringify({ success: true })
      }
      case 'create_order': {
        const customerName = roomData.name ?? ''
        if (!customerName || customerName === 'Desconocido') {
          return JSON.stringify({
            status: 'error',
            instruction: 'NO puedes crear el pedido todavía. Pregunta primero el nombre del cliente y llama update_customer_info. Luego intenta create_order de nuevo.',
          })
        }
        if (!roomData.id) return JSON.stringify({ status: 'error', instruction: 'No hay sala de conversación activa.' })

        const rawItems = args.items as Array<{
          product_id?: string; variant_id?: string; product_name: string
          size?: string; quantity: number; unit_price: number
        }>

        const result = await createOrder({
          roomId: roomData.id,
          customerName,
          customerPhone: roomData.phone ?? roomData.id,
          address: args.address as string,
          city: args.city as string,
          department: (args.department as string) ?? '',
          notes: args.notes as string | undefined,
          paymentMethod: (args.payment_method as 'bold' | 'contraentrega') ?? 'contraentrega',
          items: rawItems.map((i) => ({
            productId: i.product_id ?? '',
            variantId: i.variant_id,
            productName: i.product_name,
            size: i.size,
            quantity: i.quantity,
            unitPrice: i.unit_price,
          })),
        })

        return JSON.stringify(result)
      }
      default:
        return 'Tool not found'
    }
  } catch (err) {
    console.error('[Tool ERROR]', name, err instanceof Error ? err.message : err)
    return JSON.stringify({ status: 'sin_datos', instruccion: 'Usa la información del sistema para responder. No menciones errores técnicos.' })
  }
}

export async function summarizeHistory(messages: IMessage[]): Promise<string> {
  if (messages.length === 0) return ''
  const transcript = messages
    .map((m) => `${m.direction === 'inbound' ? 'Cliente' : m.sender_type === 'bot' ? 'Isabela' : 'Asesor'}: ${m.content.substring(0, 300)}`)
    .join('\n')

  const res = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: `Eres un asistente que resume conversaciones de WhatsApp para UltraStore, una tienda de ropa.
Extrae y lista TODOS los hechos relevantes:
- Nombre del cliente (si se mencionó)
- Género/preferencia (hombre, mujer, unisex)
- Productos que vio o le interesaron
- Tallas que mencionó
- Dirección y ciudad (si se mencionó)
- Estado del pedido (si hay uno en curso)
- Otros datos relevantes
Máximo 200 palabras en español.`,
      },
      { role: 'user', content: 'Resume esta conversación:\n' + transcript },
    ],
  })
  return res.choices[0].message.content ?? ''
}

function getDeliveryDate(): string {
  const TZ = 'America/Bogota'
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TZ }))
  const delivery = new Date(now)
  delivery.setDate(delivery.getDate() + 1)

  const holidays = new Set([
    '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
    '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
    '2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02',
    '2026-11-16','2026-12-08','2026-12-25',
    '2027-01-01','2027-01-11','2027-03-22','2027-03-25','2027-03-26',
    '2027-05-01','2027-05-10','2027-05-31','2027-06-07','2027-06-28',
    '2027-07-20','2027-08-07','2027-08-16','2027-10-18','2027-11-01',
    '2027-11-15','2027-12-08','2027-12-25',
  ])

  const toDateStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })
  for (let i = 0; i < 14; i++) {
    const dow = new Date(delivery.toLocaleString('en-US', { timeZone: TZ })).getDay()
    if (dow !== 0 && !holidays.has(toDateStr(delivery))) break
    delivery.setDate(delivery.getDate() + 1)
  }

  const days = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  const local = new Date(delivery.toLocaleString('en-US', { timeZone: TZ }))
  return `${days[local.getDay()]} ${local.getDate()} de ${months[local.getMonth()]}`
}

const TRANSFER_INSTRUCTIONS = `
SALUDO INICIAL:
- Primera vez: "¡Hola! 👋 Soy Isabela, tu asesora virtual de UltraStore 🛍️ ¿En qué te puedo ayudar hoy?"
- Si ya tienes el nombre: "¡Hola [nombre]! 😊 Bienvenido/a de nuevo a UltraStore. ¿En qué te ayudo?"
- NUNCA uses "Desconocido" como nombre.

IDENTIFICACIÓN DE GÉNERO:
- Infiere género por nombre si es obvio. Si no, pregunta: "¿Buscas ropa de hombre o mujer? 😊"
- Llama update_customer_info con el género en cuanto lo sepas.

FLUJO DE CATÁLOGO — SIGUE EXACTAMENTE ESTE ORDEN:

PASO 1 — MARCAS:
- Cuando el cliente indique qué quiere (jeans, camisetas, etc.), llama get_brands con category_slug y gender.
- Muestra las marcas disponibles y pregunta cuál le interesa. Ejemplo:
  "Tenemos estas marcas en jeans de mujer 👖:
  • Sabka
  • Carhartt
  • Stüssy
  ¿Cuál te llama la atención?"

PASO 2 — PRODUCTOS CON TALLAS Y COLORES:
- Cuando el cliente elija una marca, llama get_products con category_slug + brand_name + gender.
- get_products ya incluye las variantes (tallas y colores) de cada producto. Lee el campo "variants".
- Por cada producto muestra SIEMPRE este formato exacto (texto plano, sin asteriscos):

  👕 [nombre del producto]
  Precio: $[base_price] COP
  [descripción breve]
  Colores y tallas disponibles:
  [color 1]: tallas [lista de tallas con stock > 0]
  [color 2]: tallas [lista de tallas con stock > 0]

- Las imágenes SE ENVÍAN AUTOMÁTICAMENTE por el sistema después de cada producto. NUNCA escribas "[Imagen]", "[Foto]" ni ningún placeholder. NUNCA digas que no puedes mostrar imágenes.
- Si el cliente pide ver fotos de un producto ya mencionado, llama get_products de nuevo con la misma marca y categoría — las imágenes se enviarán automáticamente.
- Si un producto no tiene variantes con stock, indícalo como "Agotado" y no lo ofrezcas.
- Muestra máximo 5 productos. NUNCA inventes productos ni variantes.

PASO 3 — SELECCIÓN:
- Cliente elige producto + color + talla → confirma la selección y pregunta la cantidad.
- Muestra resumen del carrito antes de pedir datos de envío.

PASO 4 — DATOS DE ENVÍO Y PEDIDO:
DATOS OBLIGATORIOS (recógelos en este orden):
a) Nombre completo → llama update_customer_info inmediatamente.
b) Dirección de entrega → llama update_customer_info.
c) Ciudad y departamento.
d) Método de pago: "¿Pagas con Bold (tarjeta/PSE) o contraentrega? 💳"

ANTES de llamar create_order verifica que tienes: nombre, dirección, ciudad y método de pago.
Llama create_order SIN escribir nada antes. NO inventes totales.
SOLO después del éxito de create_order escribe:

✅ Pedido registrado #(orderNumber real)
- (qty)x (nombre) color (color) talla (talla): $(precio) COP
Subtotal: $(subtotal real) COP
Envío: $15.000 COP
Total: $(total real) COP

"📦 Tu pedido llegará el ${getDeliveryDate()}. No hacemos entregas domingos ni festivos."
"¡Gracias por comprar en UltraStore [nombre]! 🛍️✨ ¡Hasta pronto!"

TRANSFERENCIA — incluye en la ÚLTIMA línea si aplica:
{"transfer":true,"reason":"motivo"}
Situaciones: queja/reclamo, el cliente pide hablar con una persona, problema con pedido.
Si NO aplica, no incluyas el JSON.`

export async function runAgent(
  userMessage: string,
  conversationHistory: IMessage[],
  systemPrompt: string,
  transferRules: ITransferRule[],
  model = 'gpt-4o-mini',
  temperature = 0.7,
  contextSummary = '',
  roomData: RoomKnownData = {},
  mediaUrl?: string
): Promise<AgentResponse> {
  const summarySection = contextSummary ? `\nCONTEXTO PREVIO:\n${contextSummary}\n` : ''

  const knownLines: string[] = []
  if (roomData.name && roomData.name !== 'Desconocido') knownLines.push(`- Nombre: ${roomData.name}`)
  if (roomData.gender) knownLines.push(`- Preferencia de género: ${roomData.gender}`)
  if (roomData.address) knownLines.push(`- Dirección: ${roomData.address}`)
  if (roomData.city) knownLines.push(`- Ciudad: ${roomData.city}`)

  const currentRoomData = { ...roomData }
  const onRoomUpdate = (update: Partial<RoomKnownData>) => { Object.assign(currentRoomData, update) }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + summarySection + TRANSFER_INSTRUCTIONS },
    ...conversationHistory.slice(-12).map((m) => ({
      role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.content,
    })),
  ]

  if (knownLines.length > 0) {
    messages.push({
      role: 'system',
      content: `⚠️ DATOS YA GUARDADOS — NO VOLVER A PREGUNTAR:\n${knownLines.join('\n')}\nÚsalos para personalizar la respuesta.`,
    })
  }

  if (mediaUrl) {
    messages.push({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: mediaUrl, detail: 'auto' } },
        { type: 'text', text: userMessage || 'El cliente envió esta imagen.' },
      ],
    })
  } else {
    messages.push({ role: 'user', content: userMessage })
  }

  let response = await getOpenAI().chat.completions.create({ model, temperature, messages, tools, tool_choice: 'auto' })

  const collectedProducts: AgentProduct[] = []
  const collectedImageUrls: string[] = []
  let orderCreated = false
  let variantQueryCalled = false
  let productsQueryCalled = false

  while (response.choices[0].finish_reason === 'tool_calls') {
    const assistantMessage = response.choices[0].message
    messages.push(assistantMessage)

    type FnCall = { type: 'function'; id: string; function: { name: string; arguments: string } }
    const toolCalls = ((assistantMessage.tool_calls ?? []) as FnCall[]).filter((tc) => tc.type === 'function')

    for (const tc of toolCalls) {
      const args = JSON.parse(tc.function.arguments || '{}')
      const result = await executeTool(tc.function.name, args, currentRoomData, onRoomUpdate)

      if (tc.function.name === 'create_order') {
        try { if (JSON.parse(result).success === true) orderCreated = true } catch { /* */ }
      }

      if (tc.function.name === 'get_product_variants') {
        variantQueryCalled = true
      }

      if (tc.function.name === 'get_products') {
        productsQueryCalled = true
        try {
          const raw = JSON.parse(result)
          const list = Array.isArray(raw) ? raw : (raw?.data ?? [])
          console.log('[get_products] total:', list.length, '| first images:', list[0]?.images)
          for (const p of list) {
            const imgs: string[] = Array.isArray(p.images) ? (p.images as string[]).filter(Boolean) : []
            const price = typeof p.base_price === 'number' ? p.base_price : 0
            // Format variants grouped by color
            const variants: { size: string; color: string; stock: number }[] = Array.isArray(p.variants) ? p.variants : []
            const byColor: Record<string, string[]> = {}
            for (const v of variants) {
              if ((v.stock ?? 0) > 0) {
                if (!byColor[v.color]) byColor[v.color] = []
                byColor[v.color].push(v.size)
              }
            }
            const variantsText = Object.keys(byColor).length > 0
              ? Object.entries(byColor).map(([color, sizes]) => `${color}: tallas ${sizes.join(', ')}`).join('\n')
              : 'Agotado'
            collectedProducts.push({
              id: p.id ?? '',
              name: p.name ?? '',
              price,
              description: p.description ?? '',
              images: imgs,
              variantsText,
              gender: p.gender ?? '',
              category: p.category?.name ?? '',
            })
            imgs.forEach((img) => collectedImageUrls.push(img))
          }
        } catch { /* */ }
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }

    response = await getOpenAI().chat.completions.create({ model, temperature, messages, tools, tool_choice: 'auto' })
  }

  let fullText = response.choices[0].message.content ?? ''

  if (!orderCreated && fullText.includes('[orderNumber]')) {
    console.error('[AGENT] Bot wrote order template without calling create_order — removing')
    fullText = fullText.replace(/✅ Pedido registrado #\[orderNumber\][\s\S]*?(?=📦|$)/u, '').trim()
    if (!fullText) fullText = 'Hubo un problema al registrar el pedido. Por favor intenta de nuevo.'
  }

  const textLower = fullText.toLowerCase()
  // Solo suprimir cards si se consultaron variantes SIN una nueva búsqueda de productos
  // (pregunta de seguimiento sobre algo ya mostrado, no primera presentación)
  const suppressCards = variantQueryCalled && !productsQueryCalled
  const mentionedProducts = suppressCards
    ? []
    : collectedProducts.filter((p) => textLower.includes(p.name.toLowerCase()))

  const lines = fullText.split('\n')
  const lastLine = lines[lines.length - 1].trim()
  let transfer = false
  let transferReason: string | undefined
  let cleanText = fullText

  try {
    if (lastLine.startsWith('{') && lastLine.includes('"transfer"')) {
      const parsed = JSON.parse(lastLine)
      if (parsed.transfer === true) {
        transfer = true
        transferReason = parsed.reason
        cleanText = lines.slice(0, -1).join('\n').trim()
        const intentCheck = checkIntentRules(parsed.reason ?? '', transferRules)
        if (intentCheck.triggered) { transfer = true; transferReason = intentCheck.ruleName }
      }
    }
  } catch { /* no transfer JSON */ }

  return { text: cleanText, transfer, transferReason, imageUrls: collectedImageUrls, products: mentionedProducts, orderCreated }
}
