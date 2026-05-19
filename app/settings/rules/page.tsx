'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'
import type { ITransferRule } from '@/types'

export default function RulesPage() {
  const [rules, setRules] = useState<ITransferRule[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/config/rules').then((r) => r.json()).then((d) => { setRules(d); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true)
    await fetch('/api/config/rules', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  function toggleRule(id: string) {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, active: !r.active } : r))
  }

  function updateKeywords(id: string, value: string) {
    setRules((prev) => prev.map((r) => r.id === id ? { ...r, keywords: value.split(',').map((k) => k.trim()).filter(Boolean) } : r))
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">⚡ Reglas de transferencia</h1>
            <p className="text-gray-400 text-sm mt-1">Define cuándo Isabela debe derivar la conversación a un asesor humano.</p>
          </div>
          {loading ? <div className="text-gray-500 text-sm">Cargando...</div> : (
            <div className="space-y-4">
              {rules.map((rule) => (
                <div key={rule.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-white font-medium text-sm">{rule.name}</p>
                      <span className="text-xs text-gray-500 uppercase">{rule.type}</span>
                    </div>
                    <button onClick={() => toggleRule(rule.id)}
                      className={`w-11 h-6 rounded-full transition-colors ${rule.active ? 'bg-violet-600' : 'bg-gray-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full mx-1 transition-transform ${rule.active ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  {rule.type === 'keyword' && (
                    <div>
                      <label className="text-xs text-gray-400 mb-1 block">Palabras clave (separadas por coma)</label>
                      <input type="text" value={(rule.keywords ?? []).join(', ')} onChange={(e) => updateKeywords(rule.id, e.target.value)}
                        className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500"
                      />
                    </div>
                  )}
                  {rule.type === 'intent' && (
                    <p className="text-xs text-gray-500">Intent: <span className="text-gray-300">{rule.intent}</span></p>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-3 pt-2">
                <button onClick={handleSave} disabled={saving}
                  className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors">
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                {saved && <span className="text-violet-400 text-sm">✓ Guardado</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
