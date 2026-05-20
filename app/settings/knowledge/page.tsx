'use client'

import { useState, useEffect } from 'react'
import Sidebar from '@/components/Sidebar'

const DEFAULT_SYSTEM_PROMPT = `Eres Isabela, asesora virtual de UltraStore 🛍️

UltraStore es una tienda de ropa streetwear y moda urbana premium. Vendemos prendas de marcas reconocidas para hombre y mujer con envío a todo Colombia.

QUIÉN ERES:
- Nombre: Isabela
- Tono: cercana, amigable, conocedora de moda — como una amiga que sabe mucho de ropa
- Nunca uses markdown (asteriscos, negritas, guiones de lista). Solo texto plano y emojis.
- Responde siempre en español colombiano natural. Máximo 3-4 líneas por mensaje a menos que estés mostrando productos.
- No seas insistente ni repitas la misma pregunta dos veces.

CATEGORÍAS DISPONIBLES:
- Jeans (slug: jeans)
- Camisetas (slug: camisetas)
- Outerwear — chaquetas y abrigos (slug: outerwear)
- Shorts (slug: shorts)
- Accesorios (slug: accesorios)

GÉNEROS: Hombre, Mujer, Unisex

POLÍTICA DE ENVÍOS:
- Costo de envío: $15.000 COP a nivel nacional
- Tiempo de entrega: 1 día hábil (sin domingos ni festivos)
- Ciudades principales: Bogotá, Medellín, Cali, Barranquilla, Cartagena y demás ciudades de Colombia

MÉTODOS DE PAGO:
- Bold: tarjeta débito/crédito, PSE, Nequi
- Contraentrega: pagas cuando recibes el paquete

POLÍTICA DE CAMBIOS Y DEVOLUCIONES:
- Cambios dentro de los 5 días hábiles después de recibir el pedido
- El producto debe estar sin uso, con etiquetas
- Para cambios o devoluciones, el cliente debe contactar con su número de pedido

REGLAS IMPORTANTES:
- NUNCA inventes productos, precios ni tallas que no existan en el catálogo
- NUNCA ofrezcas productos agotados (stock = 0)
- Si el cliente pregunta por un producto o marca que no tenemos, dilo honestamente y ofrece alternativas similares
- Si el cliente ya compró antes y vuelve, salúdalo de forma personalizada con su nombre
- Ante quejas o problemas con pedidos, transfiere a un asesor humano con amabilidad`

export default function KnowledgePage() {
  const [systemPrompt, setSystemPrompt] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [temperature, setTemperature] = useState(0.7)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then((data) => {
      setSystemPrompt(data.system_prompt ?? DEFAULT_SYSTEM_PROMPT)
      setModel(data.ai_model ?? 'gpt-4o-mini')
      setTemperature(data.temperature ?? 0.7)
      setLoading(false)
    })
  }, [])

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system_prompt: systemPrompt, ai_model: model, temperature }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <div className="flex h-screen bg-gray-950">
      <Sidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">🧠 Base de conocimiento</h1>
            <p className="text-gray-400 text-sm mt-1">Define el comportamiento y personalidad de Isabela. Incluye información del negocio, políticas, productos y tono de comunicación.</p>
          </div>
          {loading ? (
            <div className="text-gray-500 text-sm">Cargando configuración...</div>
          ) : (
            <form onSubmit={handleSave} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Instrucciones de Isabela (System Prompt)</label>
                <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows={20}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono resize-y"
                  placeholder="Eres Isabela, asesora de UltraStore..."
                />
                <p className="text-xs text-gray-500 mt-1">Incluye información del negocio, marcas, políticas de envío, precios, horarios, etc.</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Modelo IA</label>
                  <select value={model} onChange={(e) => setModel(e.target.value)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-violet-500">
                    <option value="gpt-4o-mini">GPT-4o Mini (Recomendado — más rápido)</option>
                    <option value="gpt-4o">GPT-4o (Más capaz)</option>
                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Temperatura: <span className="text-violet-400">{temperature}</span></label>
                  <input type="range" min={0} max={1} step={0.1} value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))} className="w-full accent-violet-500" />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>Precisa (0)</span><span>Creativa (1)</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving}
                  className="bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors">
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
                {saved && <span className="text-violet-400 text-sm flex items-center gap-1">✓ Guardado correctamente</span>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
