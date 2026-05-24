import OpenAI from 'openai'
import { getProducts, getCategories, getBrands, getProductVariants, getProductById, createOrder, addToCart, getCart, clearCart } from './ultrastore-api'
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
  variantImages: string[]
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
          gender: { type: 'string', description: 'Género del cliente: hombre, mujer, unisex' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: 'Obtiene productos con sus variantes (tallas y colores). Usa color y size para filtrar cuando el cliente los especifique.',
      parameters: {
        type: 'object',
        properties: {
          category_slug: { type: 'string', description: 'Slug de la categoría (ej: jeans, camisetas)' },
          brand_name: { type: 'string', description: 'Nombre exacto de la marca elegida por el cliente' },
          gender: { type: 'string', description: 'Género: hombre o mujer.' },
          search: { type: 'string', description: 'Búsqueda libre por nombre de producto' },
          color: { type: 'string', description: 'Color solicitado por el cliente (ej: azul, negro, blanco)' },
          size: { type: 'string', description: 'Talla solicitada por el cliente (ej: S, M, L, 8, 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_variants',
      description: 'Obtiene tallas y colores con stock de un producto específico. IMPORTANTE: product_id debe ser el campo "id" UUID (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) que retornó get_products. NUNCA uses el nombre del producto, un número, ni ningún otro valor.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'UUID del producto, campo "id" de get_products. Formato: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
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
      name: 'add_to_cart',
      description: 'Agrega un producto al carrito del cliente. Llama esta función CADA VEZ que el cliente confirme una talla y color de un producto. El sistema guarda el precio real automáticamente.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string', description: 'UUID del producto de get_products' },
          product_name: { type: 'string', description: 'Nombre del producto' },
          color: { type: 'string', description: 'Color elegido' },
          size: { type: 'string', description: 'Talla elegida' },
          quantity: { type: 'number', description: 'Cantidad (default 1)' },
          unit_price: { type: 'number', description: 'Precio unitario en COP (el sistema lo verifica)' },
        },
        required: ['product_name', 'color', 'size', 'quantity', 'unit_price'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_order',
      description: 'Registra el pedido SOLO cuando el cliente confirme explícitamente el resumen. Los productos se toman del carrito guardado — NO necesitas pasarlos aquí.',
      parameters: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Dirección de entrega' },
          city: { type: 'string', description: 'Ciudad' },
          department: { type: 'string', description: 'Departamento' },
          payment_method: { type: 'string', enum: ['bold', 'contraentrega'], description: 'Método de pago' },
          notes: { type: 'string', description: 'Notas adicionales (opcional)' },
        },
        required: ['address', 'city', 'payment_method'],
      },
    },
  },
]

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  roomData: RoomKnownData,
  onRoomUpdate: (data: Partial<RoomKnownData>) => void,
  onVariantImages: (images: string[]) => void
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
          color: args.color as string | undefined,
          size: args.size as string | undefined,
        })
        console.log('[get_products] count:', products.length, '| first product variants:', (products[0] as unknown as Record<string, unknown>)?.variants)
        return JSON.stringify(products)
      }
      case 'get_product_variants': {
        const pid = args.product_id as string
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pid ?? '')
        if (!isUUID) {
          return JSON.stringify({ error: 'product_id inválido. Debes usar el campo "id" (UUID) que retornó get_products, no el nombre ni ningún otro valor.' })
        }
        const variants = await getProductVariants(pid)
        console.log('[get_product_variants] product_id:', pid, '| count:', variants.length)
        const product = await getProductById(pid)
        if (!product && variants.length === 0) {
          return JSON.stringify({ error: `No se encontró ningún producto con id "${pid}". Debes usar EXACTAMENTE el campo "id" que retornó get_products en esta misma conversación, sin modificarlo.` })
        }
        if (product && Array.isArray(product.images) && product.images.length > 0) {
          onVariantImages(product.images as string[])
        }
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
            const { error: updateErr } = await supabaseAdmin
              .from('chat_rooms')
              .update({
                ...(update.name && { customer_name: update.name }),
                ...(update.gender && { customer_gender: update.gender }),
                ...(update.address && { customer_address: update.address }),
                ...(update.city && { customer_city: update.city }),
                ...(update.phone && { customer_phone: update.phone }),
              })
              .eq('id', roomData.id)
            if (updateErr) console.error('[update_customer_info] DB error:', updateErr.message)
            else console.log('[update_customer_info] saved:', JSON.stringify(update))
          } else {
            console.warn('[update_customer_info] no roomData.id — data not persisted')
          }
        }
        return JSON.stringify({ success: true })
      }
      case 'add_to_cart': {
        if (!roomData.id) return JSON.stringify({ error: 'No hay sala activa' })
        const cart = await addToCart(roomData.id, {
          product_id: (args.product_id as string) ?? null,
          product_name: args.product_name as string,
          color: args.color as string,
          size: args.size as string,
          quantity: (args.quantity as number) ?? 1,
          unit_price: args.unit_price as number,
        })
        const cartText = cart.map((i) => `${i.quantity}x ${i.product_name} ${i.color} talla ${i.size} — $${i.unit_price.toLocaleString('es-CO')} COP`).join('\n')
        return JSON.stringify({ success: true, cart_summary: cartText, total_items: cart.length })
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

        // Read items from DB cart
        const cartItems = await getCart(roomData.id)
        if (cartItems.length === 0) {
          return JSON.stringify({ status: 'error', instruction: 'El carrito está vacío. El cliente debe agregar productos antes de crear el pedido.' })
        }

        console.log('[create_order] cart items:', JSON.stringify(cartItems))

        const result = await createOrder({
          roomId: roomData.id,
          customerName,
          customerPhone: roomData.phone ?? roomData.id,
          address: args.address as string,
          city: args.city as string,
          department: (args.department as string) ?? '',
          notes: args.notes as string | undefined,
          paymentMethod: (args.payment_method as 'bold' | 'contraentrega') ?? 'contraentrega',
          items: cartItems.map((i) => ({
            productId: i.product_id ?? '',
            productName: i.product_name,
            size: i.size,
            quantity: i.quantity,
            unitPrice: i.unit_price,
          })),
        })

        if (result.success) await clearCart(roomData.id)
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
═══ REGLAS GENERALES ═══
- NUNCA uses "Desconocido" como nombre.
- Máximo 3-4 líneas por mensaje salvo cuando muestres productos.
- Si el contexto previo menciona un pedido ya registrado (#US-...), ese pedido está completo. Saluda de nuevo y pregunta en qué puedes ayudar.
- Sé conversacional y cercana. Conecta con el cliente antes de cerrar la venta. No seas una máquina de pedidos.
- NUNCA asumas una talla. Si el cliente no la mencionó, siempre pregunta.
- NUNCA incluyas talla en ningún mensaje a menos que el cliente la haya dicho explícitamente.

═══ SLUGS (úsalos exactos en las funciones) ═══
jeans / pantalones → "jeans"
camisetas / camisas / tops / remeras → "camisetas"
shorts / bermudas → "shorts"
outerwear / chaquetas / abrigos → "outerwear"
accesorios / gorras / bolsos → "accesorios"

═══ FLUJO DE VENTA — SIGUE ESTE ORDEN ═══

▸ PASO 1 — GÉNERO (OBLIGATORIO)
El género es POR BÚSQUEDA, no es un dato fijo del cliente. El mismo cliente puede pedir para hombre en un mensaje y para mujer en el siguiente.
SIEMPRE pregunta el género ANTES de llamar get_brands o get_products, EXCEPTO si el cliente lo mencionó en su mensaje actual.
→ Si el cliente dijo "para hombre", "para mi novia", "para mujer", "para mí", etc.: detecta el género de esa frase y úsalo en el PASO 2. NO lo guardes ni lo trates como preferencia permanente.
→ Si NO mencionó el género en su mensaje actual: pregunta SOLO "¿Buscas para hombre o mujer? 😊" y DETENTE.
→ NUNCA uses un género de mensajes anteriores para filtrar una nueva búsqueda.
REGLA CRÍTICA: Cada vez que el cliente pida ver productos, pregunta o detecta el género para ESA búsqueda.

▸ PASO 2 — MARCAS
→ Llama get_brands(category_slug, gender) con el slug de la categoría y el género confirmado en el PASO 1.
→ Muestra solo las marcas que retornó la función. NUNCA uses marcas de memoria ni de otra categoría anterior.
→ Pregunta cuál le interesa.

▸ PASO 3 — PRODUCTOS
→ Llama get_products(category_slug, brand_name, gender).
→ Si el cliente especificó un color (ej: "azul", "negro"), pásalo en el parámetro color.
→ Si el cliente especificó una talla (ej: "talla 8", "M"), pásala en el parámetro size.
→ SOLO muestra los productos que retornó la función. NUNCA inventes ni agregues productos de memoria.
→ Por cada producto muestra este formato en texto plano:

👕 [nombre exacto del producto]
Precio: $[precio] COP
[descripción]
Colores y tallas disponibles:
[color]: tallas [tallas con stock > 0]

→ Las imágenes las envía el sistema automáticamente después de los productos. NUNCA escribas "[Imagen]", "[Foto]" ni ningún placeholder.
→ Termina preguntando: "¿Alguno te llama la atención? 😊"

⚠️ CUANDO EL CLIENTE PIDE MÁS OPCIONES O DICE QUE NO LE GUSTÓ LO MOSTRADO:
→ SIEMPRE vuelve a llamar get_products con parámetros diferentes (sin brand_name, con search, o diferente categoría).
→ NUNCA digas "no tengo más opciones" sin antes haber llamado get_products de nuevo.
→ Si el cliente menciona un color o talla específica, llama get_products(search="[color o característica]") para buscar eso.
→ Si realmente no hay nada en la categoría, sugiere otra categoría y llama get_products con ese nuevo slug.

▸ PASO 4 — REACCIÓN AL INTERÉS Y CARRITO
Cuando el cliente exprese interés en un producto o color:

PRIMERO reacciona con entusiasmo genuino y natural (1-2 líneas), por ejemplo:
→ "¡Excelente elección! Esa pieza es de lo más exclusivo que tenemos, te va a encantar 🔥"
→ "Uff sí, esa es una de las favoritas 😍 Manejamos lo más nuevo del mercado."
→ "Muy buena vista, esa tiene un estilo increíble 👌"
Varía el mensaje, nunca repitas la misma frase.

Si el cliente NO mencionó talla:
→ Pregunta SOLO la talla: "¿En qué talla la quieres? Tenemos: [tallas disponibles]"
NUNCA asumas ni menciones una talla. SIEMPRE pregunta.

Cuando el cliente confirme una talla:

Si es la primera vez para ese producto (no hay fotos en el historial):
→ Llama get_product_variants(product_id) UNA SOLA VEZ.
   • product_id = campo "id" UUID (formato xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
→ El sistema manda las fotos automáticamente.
→ Si hay stock: confirma "Listo, [producto] [color] talla [talla] agregado 🛒"
→ Si agotada: "Ay qué pena 😕 Esa talla está agotada. Tenemos: [alternativas]. ¿Alguna te funciona?"

Si ya hay fotos en el historial para ese producto:
→ NO llames get_product_variants de nuevo.
→ Confirma: "Listo, [producto] [color] talla [talla] agregado 🛒"

⚠️ CRÍTICO — CUANDO EL CLIENTE CONFIRMA UNA TALLA Y COLOR:
→ Llama INMEDIATAMENTE add_to_cart con product_id, product_name, color, size, quantity=1, unit_price.
→ Confirma: "Listo, [producto] [color] talla [talla] agregado al carrito 🛒"
→ Luego pregunta: "¿Quieres ver algo más o con esto cerramos el pedido? 😊"
→ NUNCA pidas datos de envío ni método de pago todavía.
→ El carrito se muestra en el sistema — no necesitas recordar los productos anteriores.

▸ PASO 5 — DATOS Y PEDIDO
Solo entra aquí cuando el cliente diga que quiere cerrar el pedido.

Paso 5a — Recopila y GUARDA cada dato en el momento que el cliente lo dé:
- Nombre completo → llama update_customer_info(name) INMEDIATAMENTE al recibirlo
- Dirección → llama update_customer_info(address) INMEDIATAMENTE al recibirlo
- Ciudad → llama update_customer_info(city) INMEDIATAMENTE al recibirlo
- Método de pago → pregunta "¿Pagas con Bold (tarjeta/PSE/Nequi) o contraentrega? 💳" (no se guarda con función)
NUNCA esperes a tener todos los datos para llamar update_customer_info. Llámala UNA VEZ por cada dato nuevo.

⚠️ CRÍTICO — RECIBIR EL MÉTODO DE PAGO NO ES CONFIRMACIÓN.
Paso 5b — Después del método de pago, busca la sección "🛒 CARRITO ACTUAL" en tu contexto y copia EXACTAMENTE esos productos en el resumen. NO uses tu memoria ni el historial de conversación para construir el resumen — USA SOLO EL CARRITO.
"Listo [nombre], te confirmo el pedido:
[COPIA EXACTA de cada línea del 🛒 CARRITO ACTUAL]
Envío: $15.000 COP
Total: $[subtotal del carrito + 15000] COP
¿Confirmamos? ✅"

Si el carrito está vacío o no aparece en el contexto, NO muestres resumen — dile al cliente que no hay productos en el carrito todavía.

Paso 5c — Espera "sí", "listo", "confirmo" o confirmación explícita.
→ SOLO ENTONCES llama create_order (sin items — el sistema los toma del carrito).
→ Solo después del éxito de create_order escribe:

✅ Pedido registrado #[orderNumber real]
[qty]x [producto] [color] talla [talla]: $[precio] COP
Subtotal: $[subtotal real] COP
Envío: $15.000 COP
Total: $[total real] COP
📦 Tu pedido llegará el ${getDeliveryDate()}. Sin domingos ni festivos.
¡Gracias por comprar en UltraStore [nombre]! 🛍️✨

═══ TRANSFERENCIA ═══
Si hay queja, reclamo o el cliente pide un asesor humano, escribe en la ÚLTIMA línea:
{"transfer":true,"reason":"motivo"}
Si no aplica, NO lo incluyas.`

export async function runAgent(
  userMessage: string,
  conversationHistory: IMessage[],
  systemPrompt: string,
  transferRules: ITransferRule[],
  model = 'gpt-4o-mini',
  temperature = 0.7,
  contextSummary = '',
  roomData: RoomKnownData = {},
  mediaUrl?: string,
  cartItems: import('./ultrastore-api').CartItem[] = []
): Promise<AgentResponse> {
  const summarySection = contextSummary ? `\nCONTEXTO PREVIO:\n${contextSummary}\n` : ''

  const knownLines: string[] = []
  if (roomData.name && roomData.name !== 'Desconocido') knownLines.push(`- Nombre: ${roomData.name}`)
  // Gender NO se incluye en knownLines — el cliente puede pedir para hombre o mujer en cualquier mensaje
  // El modelo debe usar el género que el cliente mencione en cada solicitud de productos
  if (roomData.address) knownLines.push(`- Dirección: ${roomData.address}`)
  if (roomData.city) knownLines.push(`- Ciudad: ${roomData.city}`)

  if (cartItems.length > 0) {
    const cartLines = cartItems.map((i) => `  • ${i.quantity}x ${i.product_name} ${i.color} talla ${i.size} — $${i.unit_price.toLocaleString('es-CO')} COP`).join('\n')
    const cartSubtotal = cartItems.reduce((s, i) => s + i.unit_price * i.quantity, 0)
    knownLines.push(`\n🛒 CARRITO ACTUAL (ya confirmado por el cliente):\n${cartLines}\n  Subtotal: $${cartSubtotal.toLocaleString('es-CO')} COP`)
  }

  const currentRoomData = { ...roomData }
  const onRoomUpdate = (update: Partial<RoomKnownData>) => { Object.assign(currentRoomData, update) }

  const isFirstMessage = conversationHistory.length === 0 && !contextSummary
  const greetingInstruction = isFirstMessage
    ? `\n⚠️ PRIMER MENSAJE DEL CLIENTE: Es un usuario nuevo. Preséntate con entusiasmo: dí tu nombre (Isabela), que eres asesora de UltraStore, y pregunta en qué puedes ayudar. No hagas más preguntas en ese mensaje.\n`
    : ''

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt + summarySection + greetingInstruction + TRANSFER_INSTRUCTIONS },
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
  const variantProductImages: string[] = [] // images to send when user selects a talla
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
      const result = await executeTool(tc.function.name, args, currentRoomData, onRoomUpdate, (imgs) => { imgs.forEach((i) => variantProductImages.push(i)) })

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
          console.log('[get_products] total:', list.length, '| first id:', list[0]?.id, '| first images:', list[0]?.images)
          for (const p of list) {
            const imgs: string[] = Array.isArray(p.images) ? (p.images as string[]).filter(Boolean) : []
            const price = typeof p.base_price === 'number' ? p.base_price : 0
            // Format variants grouped by color
            const variants: { size: string; color: string; stock: number }[] = Array.isArray(p.variants) ? p.variants : []
            // Normalize color names to avoid duplicates (ej: "Negro" y "Negra" → "Negro")
            const normalizeColor = (c: string) => c.trim().toLowerCase().replace(/a$/, 'o').replace(/\b\w/g, (l) => l.toUpperCase())
            const byColor: Record<string, string[]> = {}
            for (const v of variants) {
              if ((v.stock ?? 0) > 0) {
                const color = normalizeColor(v.color)
                if (!byColor[color]) byColor[color] = []
                if (!byColor[color].includes(v.size)) byColor[color].push(v.size)
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

  const suppressCards = variantQueryCalled && !productsQueryCalled
  const mentionedProducts = suppressCards ? [] : collectedProducts

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

  return { text: cleanText, transfer, transferReason, imageUrls: collectedImageUrls, products: mentionedProducts, variantImages: variantProductImages, orderCreated }
}
