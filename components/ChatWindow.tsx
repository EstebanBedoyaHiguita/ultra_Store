'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import type { IRoom, IMessage, ICloseReason } from '@/types'
import MessageBubble from './MessageBubble'

interface Props {
  conversation: IRoom
  onStatusChange: () => void
}

export default function ChatWindow({ conversation, onStatusChange }: Props) {
  const [messages, setMessages] = useState<IMessage[]>([])
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [takingOver, setTakingOver] = useState(false)
  const [showContactCard, setShowContactCard] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeReasons, setCloseReasons] = useState<ICloseReason[]>([])
  const [selectedReasonId, setSelectedReasonId] = useState('')
  const [closing, setClosing] = useState(false)
  const [showReopenModal, setShowReopenModal] = useState(false)
  const [reopenTemplate, setReopenTemplate] = useState('')
  const [reopening, setReopening] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isAtBottomRef = useRef(true)

  function checkIfAtBottom() {
    const el = scrollContainerRef.current
    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/conversations/${conversation.id}/messages`)
    if (res.ok) setMessages(await res.json())
  }, [conversation.id])

  useEffect(() => {
    fetchMessages()
    const interval = setInterval(fetchMessages, 3000)
    return () => clearInterval(interval)
  }, [fetchMessages])

  useEffect(() => { isAtBottomRef.current = true; bottomRef.current?.scrollIntoView({ behavior: 'instant' }) }, [conversation.id])
  useEffect(() => { if (isAtBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function handleTakeover() {
    setTakingOver(true)
    await fetch(`/api/conversations/${conversation.id}/takeover`, { method: 'POST' })
    onStatusChange()
    setTakingOver(false)
  }

  async function handleReturnToBot() {
    await fetch(`/api/conversations/${conversation.id}/takeover`, { method: 'DELETE' })
    onStatusChange()
  }

  async function handleSendReply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!reply.trim() || sending) return
    setSending(true)
    const text = reply.trim()
    setReply('')
    const res = await fetch(`/api/conversations/${conversation.id}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    })
    if (res.ok) await fetchMessages()
    setSending(false)
  }

  async function handleOpenCloseModal() {
    const res = await fetch('/api/config/close-reasons')
    if (res.ok) setCloseReasons((await res.json()).filter((r: ICloseReason) => r.active))
    setSelectedReasonId('')
    setShowCloseModal(true)
  }

  async function handleClose(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!selectedReasonId || closing) return
    setClosing(true)
    const res = await fetch(`/api/conversations/${conversation.id}/close`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ closeReasonId: selectedReasonId }),
    })
    setClosing(false)
    if (res.ok) { setShowCloseModal(false); onStatusChange() }
  }

  async function handleReopen(e: React.FormEvent) {
    e.preventDefault()
    if (!reopenTemplate.trim() || reopening) return
    setReopening(true)
    const res = await fetch(`/api/conversations/${conversation.id}/reopen`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateName: 'hello_world', languageCode: 'en_US', bodyText: reopenTemplate }),
    })
    setReopening(false)
    if (res.ok) { setShowReopenModal(false); onStatusChange() }
  }

  const isHuman = conversation.status === 'human'
  const isBot = conversation.status === 'bot'
  const isClosed = conversation.status === 'closed'
  const windowExpired = conversation.window_expires_at != null && new Date(conversation.window_expires_at) < new Date()
  const windowMinutesLeft = conversation.window_expires_at && !windowExpired
    ? Math.max(0, Math.round((new Date(conversation.window_expires_at).getTime() - Date.now()) / 60000))
    : null

  return (
    <div className="flex h-full bg-gray-950">
      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800 bg-gray-900">
          <button onClick={() => setShowContactCard((v) => !v)}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left">
            <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-white font-semibold">
              {(conversation.customer_name || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-white font-medium text-sm underline decoration-dotted flex items-center gap-1.5">
                {conversation.customer_name || 'Desconocido'}
                {conversation.channel === 'instagram' && <span title="Instagram">📸</span>}
              </h3>
              <p className="text-gray-400 text-xs">{conversation.customer_phone}</p>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {(isBot || isHuman) && windowExpired && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-900/60 text-red-300 border border-red-700">⏰ Ventana cerrada</span>
            )}
            {(isBot || isHuman) && !windowExpired && windowMinutesLeft !== null && windowMinutesLeft < 60 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-yellow-900/60 text-yellow-300 border border-yellow-700">⏳ {windowMinutesLeft}m restantes</span>
            )}
            {(isBot || isHuman) && !windowExpired && windowMinutesLeft !== null && windowMinutesLeft >= 60 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-900/40 text-green-400 border border-green-800">✅ Ventana {Math.floor(windowMinutesLeft / 60)}h abierta</span>
            )}
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              isHuman ? 'bg-green-900/60 text-green-300 border border-green-700'
              : isBot ? 'bg-blue-900/60 text-blue-300 border border-blue-700'
              : 'bg-gray-800 text-gray-400 border border-gray-700'
            }`}>
              {isHuman ? `👤 Humano${conversation.assigned_to ? ` · ${conversation.assigned_to}` : ''}` : isBot ? '🤖 Isabela activa' : '✅ Cerrado'}
            </span>
            {isBot && (
              <button onClick={handleTakeover} disabled={takingOver}
                className="bg-green-600 hover:bg-green-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                {takingOver ? 'Tomando...' : 'Tomar conversación'}
              </button>
            )}
            {isHuman && (
              <button onClick={handleReturnToBot}
                className="bg-blue-700 hover:bg-blue-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                Devolver a Isabela
              </button>
            )}
            {(isBot || isHuman) && (
              <button onClick={handleOpenCloseModal}
                className="bg-red-700 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                🔴 Cerrar
              </button>
            )}
            {isClosed && (
              <button onClick={() => setShowReopenModal(true)}
                className="bg-violet-700 hover:bg-violet-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
                📨 Retomar
              </button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollContainerRef} onScroll={checkIfAtBottom} className="flex-1 overflow-y-auto px-5 py-4 space-y-1">
          {messages.length === 0 && <div className="text-center text-gray-600 text-sm pt-16">No hay mensajes aún</div>}
          {messages.map((msg) => <MessageBubble key={msg.id} message={msg} />)}
          <div ref={bottomRef} />
        </div>

        {/* Reply input */}
        {isHuman && (
          <form onSubmit={handleSendReply} className="px-4 py-3 border-t border-gray-800 bg-gray-900 flex gap-2">
            <input type="text" value={reply} onChange={(e) => setReply(e.target.value)}
              placeholder="Escribe una respuesta..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button type="submit" disabled={!reply.trim() || sending}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors">
              {sending ? '...' : 'Enviar'}
            </button>
          </form>
        )}
        {isBot && (
          <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900 text-center">
            <p className="text-xs text-gray-500">Isabela está respondiendo automáticamente. Haz clic en &quot;Tomar conversación&quot; para responder manualmente.</p>
          </div>
        )}
        {isClosed && (
          <div className="px-4 py-2.5 border-t border-gray-800 bg-gray-900 text-center">
            <p className="text-xs text-gray-500">Conversación cerrada. Usa &quot;Retomar&quot; para reabrir la ventana.</p>
          </div>
        )}
      </div>

      {/* Contact card panel */}
      {showContactCard && (
        <div className="w-72 flex-shrink-0 border-l border-gray-800 bg-gray-900 flex flex-col overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
            <h3 className="text-white font-semibold text-sm">Datos del contacto</h3>
            <button onClick={() => setShowContactCard(false)} className="text-gray-500 hover:text-white text-lg transition-colors">×</button>
          </div>
          <div className="flex flex-col items-center gap-2 py-5 border-b border-gray-800">
            <div className="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center text-white text-2xl font-bold">
              {(conversation.customer_name || '?').charAt(0).toUpperCase()}
            </div>
            <p className="text-white font-medium text-sm">{conversation.customer_name || 'Desconocido'}</p>
            <p className="text-gray-500 text-xs">{conversation.customer_phone}</p>
          </div>
          <div className="flex flex-col gap-0 px-4 py-4">
            {[
              { label: 'Género / Preferencia', value: conversation.customer_gender },
              { label: 'Dirección', value: conversation.customer_address },
              { label: 'Ciudad', value: conversation.customer_city },
              { label: 'Estado', value: conversation.status },
              ...(conversation.assigned_to ? [{ label: 'Asignado a', value: conversation.assigned_to }] : []),
              ...(conversation.close_reason ? [{ label: 'Motivo de cierre', value: conversation.close_reason }] : []),
            ].map(({ label, value }) => (
              <div key={label} className="mb-3">
                <p className="text-gray-500 text-xs mb-0.5">{label}</p>
                <p className="text-white text-sm">{value || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reopen modal */}
      {showReopenModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-white font-semibold text-base mb-1">Retomar conversación</h2>
            <p className="text-gray-400 text-xs mb-4">Envía un mensaje de WhatsApp para reabrir la ventana de 24h.</p>
            <form onSubmit={handleReopen} className="flex flex-col gap-4">
              <textarea
                value={reopenTemplate} onChange={(e) => setReopenTemplate(e.target.value)}
                rows={3} placeholder="Hola! Te contactamos desde UltraStore 🛍️..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowReopenModal(false)}
                  className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors">Cancelar</button>
                <button type="submit" disabled={!reopenTemplate.trim() || reopening}
                  className="bg-violet-700 hover:bg-violet-600 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  {reopening ? 'Enviando...' : '📨 Enviar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4">
            <h2 className="text-white font-semibold text-base mb-1">Cerrar conversación</h2>
            <p className="text-gray-400 text-xs mb-4">Selecciona el motivo de cierre.</p>
            <form onSubmit={handleClose} className="flex flex-col gap-3">
              {closeReasons.length === 0 ? (
                <p className="text-yellow-400 text-xs">No hay motivos configurados. Ve a Configuración → Motivos de cierre.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {closeReasons.map((r) => (
                    <label key={r.id} className="flex items-center gap-3 cursor-pointer p-2.5 rounded-xl hover:bg-gray-800 transition-colors">
                      <input type="radio" name="reason" value={r.id} checked={selectedReasonId === r.id}
                        onChange={() => setSelectedReasonId(r.id)} className="accent-red-500" />
                      <span className="text-white text-sm">{r.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2 justify-end mt-1">
                <button type="button" onClick={() => setShowCloseModal(false)}
                  className="text-gray-400 hover:text-white text-sm px-4 py-2 rounded-lg transition-colors">Cancelar</button>
                <button type="submit" disabled={!selectedReasonId || closing || closeReasons.length === 0}
                  className="bg-red-700 hover:bg-red-600 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                  {closing ? 'Cerrando...' : 'Confirmar cierre'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
