'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import type { ICloseReason } from '@/types'

export default function CloseReasonsPage() {
  const [reasons, setReasons] = useState<ICloseReason[]>([])
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function fetchReasons() {
    const res = await fetch('/api/config/close-reasons')
    if (res.ok) setReasons(await res.json())
  }

  useEffect(() => { fetchReasons() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim() || adding) return
    setAdding(true)
    const res = await fetch('/api/config/close-reasons', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName.trim() }),
    })
    if (res.ok) { setNewName(''); await fetchReasons() }
    setAdding(false)
  }

  async function handleToggle(id: string, active: boolean) {
    await fetch(`/api/config/close-reasons/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !active }),
    })
    await fetchReasons()
  }

  async function handleDelete(id: string) {
    await fetch(`/api/config/close-reasons/${id}`, { method: 'DELETE' })
    await fetchReasons()
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">🔴 Motivos de cierre</h1>
            <p className="text-gray-400 text-sm mt-1">Configura los motivos que los agentes pueden seleccionar al cerrar una conversación.</p>
          </div>
          <form onSubmit={handleAdd} className="flex gap-3 mb-6">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Nuevo motivo de cierre..."
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button type="submit" disabled={!newName.trim() || adding}
              className="bg-violet-600 hover:bg-violet-500 disabled:bg-gray-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors">
              {adding ? 'Agregando...' : '+ Agregar'}
            </button>
          </form>
          <div className="space-y-2">
            {reasons.map((r) => (
              <div key={r.id} className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
                <span className={`text-sm ${r.active ? 'text-white' : 'text-gray-500 line-through'}`}>{r.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleToggle(r.id, r.active)}
                    className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                      r.active ? 'bg-green-500/20 text-green-300 border-green-500/30' : 'bg-gray-700 text-gray-400 border-gray-600'
                    }`}>
                    {r.active ? 'Activo' : 'Inactivo'}
                  </button>
                  <button onClick={() => handleDelete(r.id)} className="text-gray-500 hover:text-red-400 transition-colors text-sm px-1">✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
