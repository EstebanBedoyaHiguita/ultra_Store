'use client'

import type { IMessage } from '@/types'

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
}

export default function MessageBubble({ message }: { message: IMessage }) {
  const isInbound = message.direction === 'inbound'
  const isHuman = message.sender_type === 'human'

  // Detect image URL on its own line
  const imageMatch = message.content.match(/^(https?:\/\/\S+\.(jpg|jpeg|png|webp|gif))(\n|$)/i)
  const imageUrl = imageMatch?.[1]
  const textPart = imageUrl ? message.content.replace(imageUrl, '').trim() : message.content

  return (
    <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-1`}>
      <div className={`max-w-xs lg:max-w-md xl:max-w-lg rounded-2xl px-3.5 py-2 ${
        isInbound
          ? 'bg-gray-800 text-white rounded-tl-sm'
          : isHuman
            ? 'bg-green-700 text-white rounded-tr-sm'
            : 'bg-blue-800 text-white rounded-tr-sm'
      }`}>
        {!isInbound && (
          <p className="text-[10px] font-semibold mb-0.5 opacity-70">
            {isHuman ? '👤 Asesor' : '🛍️ Isabela'}
          </p>
        )}
        {imageUrl && (
          <img src={imageUrl} alt="product" className="rounded-xl mb-1.5 max-w-full object-cover" />
        )}
        {textPart && (
          <p className="text-sm whitespace-pre-wrap break-words">{textPart}</p>
        )}
        <p className={`text-[10px] mt-1 ${isInbound ? 'text-gray-500' : 'text-white/50'} text-right`}>
          {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  )
}
