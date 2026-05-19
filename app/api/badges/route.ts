import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  const [{ count: unreadChats }, { count: pendingOrders }] = await Promise.all([
    supabaseAdmin.from('chat_rooms').select('id', { count: 'exact', head: true }).gt('unread_count', 0).neq('status', 'closed'),
    supabaseAdmin.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'pendiente'),
  ])
  return NextResponse.json({ unreadChats: unreadChats ?? 0, pendingOrders: pendingOrders ?? 0 })
}
