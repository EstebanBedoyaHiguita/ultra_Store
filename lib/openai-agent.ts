import OpenAI from 'openai'
import { getProducts, getCategories, getProductVariants, createOrder } from './ultrastore-api'
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
  imageUrl: string
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
      name: 'get_categories',
      description: 'Lista todas las categorías de ropa disponibles en UltraStore (Jeans, Camisetas, Outerwear, Shorts, Accesorios).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Obtiene el catálogo de UltraStore con filtros opcionales. Usa category_slug para filtrar por categoría (jeans, camisetas, outerwear, shorts, accesorios). Usa gender para filtrar por género (hombre, mujer). Usa search para buscar por nombre o marca. SIEMPRE llama esta función antes de decir que un producto no existe.',
      parameters: {
        type: 'object',
        properties: {
          category_slug: { type: 'string', description: 'Slug de la categoría (ej: jeans, camisetas)' },
          gender: { type: 'string', description: 'Género: hombre o mujer. Omitir para mostrar todos.' },
          search: { type: 'string', description: 'Texto libre para buscar por nombre o marca' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_variants',
      description: 'Obtiene las tallas y colores disponibles con stock de un producto específico. Llama esta función cuando el cliente quiera saber qué tallas hay o antes de confirmar un pedido.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'ID del producto obtenido de get_products' },
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
      case 'get_products': {
        const products = await getProducts({
          categorySlug: args.category_slug as string | undefined,
          gender: args.gender as string | undefined,
          search: args.search as string | undefined,
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
- Si el cliente pregunta por productos, trata de inferir género por el nombre si es obvio.
- Si no es claro, pregunta amablemente: "¿Buscas ropa de hombre, mujer o manejas ambas opciones? 😊"
- Llama update_customer_info con el género cuando lo sepas.
- Al mostrar productos, filtra por el género del cliente + unisex.

FORMATO DE RESPUESTA — CRÍTICO:
- PROHIBIDO usar asteriscos, negritas ni markdown. Solo texto plano, emojis y saltos de línea.
- Ejemplo de producto correcto:
  👕 Supreme Box Logo Tee
  $280.000 COP
  Talla disponibles: S, M, L, XL
  Camiseta icónica de Supreme en algodón premium
  https://url-imagen.jpg
- NUNCA digas que no puedes mostrar imágenes. Las imágenes se envían automáticamente.
- Muestra máximo 3 productos a la vez. Si hay más, menciona que hay más opciones.
- NUNCA inventes productos. Solo muestra lo que retorne get_products.

FLUJO DE PEDIDO — SIGUE ESTE ORDEN:
1. Cliente expresa interés en comprar → llama get_products con filtros apropiados.
2. Muestra productos → cliente elige uno → llama get_product_variants para mostrar tallas disponibles.
3. Cliente elige talla → pregunta cantidad si no lo indicó.
4. Muestra resumen del carrito y pregunta si quiere agregar algo más o confirmar.
5. DATOS OBLIGATORIOS antes de crear el pedido:
   a) Nombre: si no lo tienes, pídelo. Cuando lo dé, llama update_customer_info.
   b) Dirección: pídela. Cuando la dé, confirma y llama update_customer_info.
   c) Ciudad y departamento.
   d) Método de pago: "¿Prefieres pagar por Bold (tarjeta/PSE) o contraentrega? 💳"
6. ANTES de llamar create_order verifica que tienes: nombre, dirección, ciudad y método de pago.
7. Llama create_order INMEDIATAMENTE. NO escribas nada antes. NO inventes precios ni totales.
8. SOLO después de que create_order retorne éxito, escribe el resumen con los valores EXACTOS:

✅ Pedido registrado #(orderNumber real)
- (quantity)x (product_name) talla (size): $(lineTotal) COP
Subtotal: $(subtotal real) COP
Envío: $15.000 COP
Total: $(total real) COP

Luego envía SIEMPRE este mensaje:
"📦 Tu pedido llegará el ${getDeliveryDate()}. Recuerda que no realizamos entregas los domingos ni días festivos."

Luego despídete con:
"¡Gracias por comprar en UltraStore [nombre]! 🛍️✨ Si tienes alguna duda sobre tu pedido, aquí estamos. ¡Hasta pronto!"

IMPORTANTE: Al final de cada respuesta, si detectas alguna de estas situaciones, incluye en la ÚLTIMA línea:
{"transfer":true,"reason":"motivo"}
Situaciones que requieren transferencia:
- Queja, reclamo o insatisfacción
- El cliente pide hablar con una persona
- Problema con un pedido que no puedes resolver
Si NO hay que transferir, no incluyas ese JSON.`

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

      if (tc.function.name === 'get_products') {
        try {
          const raw = JSON.parse(result)
          const list = Array.isArray(raw) ? raw : (raw?.data ?? [])
          for (const p of list) {
            const img = Array.isArray(p.images) ? (p.images as string[])[0] : ''
            const price = typeof p.base_price === 'number' ? p.base_price : 0
            collectedProducts.push({
              id: p.id ?? '',
              name: p.name ?? '',
              price,
              description: p.description ?? '',
              imageUrl: img ?? '',
              gender: p.gender ?? '',
              category: p.category?.name ?? '',
            })
            if (img) collectedImageUrls.push(img)
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
  const mentionedProducts = collectedProducts.filter((p) => textLower.includes(p.name.toLowerCase()))

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
