export type ConversationStatus = 'bot' | 'human' | 'closed'
export type ChannelType = 'whatsapp' | 'instagram'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageSender = 'user' | 'bot' | 'human'
export type TransferRuleType = 'keyword' | 'intent'
export type OrderSource = 'ecommerce' | 'chatbot'

export interface IRoom {
  id: string
  wa_id: string
  channel: ChannelType
  status: ConversationStatus
  customer_name: string
  customer_gender: string
  customer_address: string
  customer_city: string
  customer_phone: string
  assigned_to?: string
  close_reason?: string
  closed_by?: string
  context_summary: string
  last_message: string
  last_message_at: string
  window_expires_at: string | null
  unread_count: number
  created_at: string
  updated_at: string
}

export interface IMessage {
  id: string
  room_id: string
  wa_message_id?: string
  direction: MessageDirection
  sender_type: MessageSender
  content: string
  message_type: string
  created_at: string
}

export interface ITransferRule {
  id: string
  name: string
  type: TransferRuleType
  keywords?: string[]
  intent?: string
  active: boolean
}

export interface IAgentConfig {
  id: string
  system_prompt: string
  ai_model: string
  temperature: number
  transfer_rules: ITransferRule[]
}

export interface ICloseReason {
  id: string
  name: string
  active: boolean
  created_at: string
}

// Supabase product types
export interface UltraProduct {
  id: string
  reference: string
  name: string
  slug: string
  description: string
  base_price: number
  gender: string  // hombre | mujer | unisex
  images: string[]
  is_active: boolean
  brand: { id: string; name: string }
  category: { id: string; name: string; slug: string }
  variants: UltraVariant[]
}

export interface UltraVariant {
  id: string
  product_id: string
  size: string
  color: string
  color_hex: string
  stock: number
  price_override: number | null
  sku: string
}

export interface UltraCategory {
  id: string
  name: string
  slug: string
  image_url: string
}

export interface UltraBrand {
  id: string
  name: string
  logo_url: string
}

// Unified order from Supabase (both ecommerce and chatbot)
export interface IOrder {
  id: string
  user_id: string | null
  guest_email: string | null
  guest_phone: string | null
  status: string
  total: number
  shipping_address: {
    full_name: string
    address: string
    city: string
    department: string
    notes?: string
  }
  payment_method: string
  source: OrderSource
  chat_room_id: string | null
  created_at: string
  items?: IOrderItem[]
}

export interface IOrderItem {
  id: string
  order_id: string
  product_id: string
  variant_id: string | null
  quantity: number
  unit_price: number
  product?: { name: string; images: string[] }
  variant?: { size: string; color: string }
}
