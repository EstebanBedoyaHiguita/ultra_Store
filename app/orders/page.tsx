'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

type OrderStatus = 'pendiente' | 'confirmado' | 'despachado' | 'entregado' | 'cancelado'
type OrderSource = 'ecommerce' | 'chatbot'

interface Order {
  id: string
  guest_phone: string | null
  guest_email: string | null
  status: OrderStatus
  total: number
  shipping_address: { full_name: string; address: string; city: string; department: string; notes?: string }
  payment_method: string
  source: OrderSource
  chat_room_id: string | null
  created_at: string
  order_items?: Array<{ id: string; quantity: number; unit_price: number; products?: { name: string; images: string[] } }>
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  pendiente: 'Pendiente', confirmado: 'Confirmado', despachado: 'Despachado',
  entregado: 'Entregado', cancelado: 'Cancelado',
}
const STATUS_COLORS: Record<OrderStatus, string> = {
  pendiente: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  confirmado: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  despachado: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
  entregado: 'bg-green-500/20 text-green-300 border-green-500/30',
  cancelado: 'bg-red-500/20 text-red-300 border-red-500/30',
}
const SOURCE_BADGE: Record<OrderSource, string> = {
  ecommerce: '🛒 E-commerce',
  chatbot: '💬 Chatbot',
}
const SOURCE_COLORS: Record<OrderSource, string> = {
  ecommerce: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  chatbot: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<OrderSource | 'all'>('all')
  const [updating, setUpdating] = useState<string | null>(null)

  async function fetchOrders() {
    const qs = sourceFilter !== 'all' ? `?source=${sourceFilter}` : ''
    const res = await fetch(`/api/orders${qs}`)
    if (res.ok) setOrders(await res.json())
    setLoading(false)
  }

  useEffect(() => { setLoading(true); fetchOrders() }, [sourceFilter])

  async function handleStatusChange(id: string, status: OrderStatus) {
    setUpdating(id)
    const res = await fetch('/api/orders', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    if (res.ok) setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status } : o))
    setUpdating(null)
  }

  const fmt = (n: number) => `$${n.toLocaleString('es-CO')} COP`
  const fmtDate = (d: string) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const allStatuses = Object.keys(STATUS_LABELS) as OrderStatus[]

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">📦 Pedidos UltraStore</h1>
            <p className="text-gray-400 text-sm mt-1">Pedidos del e-commerce y del chatbot unificados</p>
          </div>

          {/* Source filter */}
          <div className="flex gap-2 mb-6">
            {(['all', 'ecommerce', 'chatbot'] as const).map((s) => (
              <button key={s} onClick={() => setSourceFilter(s)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  sourceFilter === s ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}>
                {s === 'all' ? 'Todos' : SOURCE_BADGE[s]}
              </button>
            ))}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-5 gap-3 mb-8">
            {allStatuses.map((s) => {
              const count = orders.filter((o) => o.status === s).length
              return (
                <div key={s} className={`rounded-xl border p-4 ${STATUS_COLORS[s]}`}>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs mt-1 opacity-80">{STATUS_LABELS[s]}</div>
                </div>
              )
            })}
          </div>

          {loading ? (
            <div className="text-gray-500 text-sm">Cargando pedidos...</div>
          ) : orders.length === 0 ? (
            <div className="text-center text-gray-600 py-16">
              <div className="text-4xl mb-3">📦</div>
              <p>No hay pedidos registrados aún</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map((order) => (
                <div key={order.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between p-4 cursor-pointer"
                    onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <div className="text-white font-semibold text-sm font-mono">#{order.id.slice(0, 8).toUpperCase()}</div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${SOURCE_COLORS[order.source ?? 'ecommerce']}`}>
                            {SOURCE_BADGE[order.source ?? 'ecommerce']}
                          </span>
                        </div>
                        <div className="text-gray-400 text-xs mt-0.5">{fmtDate(order.created_at)}</div>
                      </div>
                      <div>
                        <div className="text-white text-sm">{order.shipping_address?.full_name || order.guest_phone || '—'}</div>
                        <div className="text-gray-500 text-xs">{order.guest_phone}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-white font-semibold text-sm">{fmt(order.total)}</div>
                        <div className="text-gray-500 text-xs">{order.payment_method}</div>
                      </div>
                      <select
                        value={order.status}
                        disabled={updating === order.id}
                        onChange={(e) => { e.stopPropagation(); handleStatusChange(order.id, e.target.value as OrderStatus) }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-xs font-semibold px-3 py-1.5 rounded-lg border cursor-pointer focus:outline-none disabled:opacity-50 ${STATUS_COLORS[order.status]} bg-transparent`}
                      >
                        {allStatuses.map((s) => (
                          <option key={s} value={s} className="bg-gray-900 text-white">{STATUS_LABELS[s]}</option>
                        ))}
                      </select>
                      <span className="text-gray-500 text-sm">{expanded === order.id ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {expanded === order.id && (
                    <div className="border-t border-gray-700 p-4 space-y-4">
                      {order.order_items && order.order_items.length > 0 && (
                        <div>
                          <div className="text-gray-400 text-xs uppercase tracking-wide mb-2">Productos</div>
                          <div className="space-y-1">
                            {order.order_items.map((item) => (
                              <div key={item.id} className="flex justify-between text-sm">
                                <span className="text-gray-300">{item.quantity}x {item.products?.name ?? 'Producto'}</span>
                                <span className="text-gray-400">{fmt(item.unit_price * item.quantity)}</span>
                              </div>
                            ))}
                          </div>
                          <div className="border-t border-gray-700 mt-3 pt-3">
                            <div className="flex justify-between text-sm font-semibold text-white">
                              <span>Total</span><span>{fmt(order.total)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {order.shipping_address && (
                        <div>
                          <div className="text-gray-400 text-xs uppercase tracking-wide mb-2">Dirección de entrega</div>
                          <div className="text-sm text-gray-300">
                            {order.shipping_address.full_name && <div className="font-medium">{order.shipping_address.full_name}</div>}
                            {order.shipping_address.address}<br />
                            {order.shipping_address.city}, {order.shipping_address.department}
                            {order.shipping_address.notes && <><br /><span className="text-gray-500 italic">Nota: {order.shipping_address.notes}</span></>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
