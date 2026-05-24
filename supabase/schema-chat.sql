-- ============================================================
-- Chat UltraStore — tablas de conversaciones
-- Ejecutar en el SQL Editor de Supabase
-- ============================================================

-- 1. Modificar orders para identificar origen
ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'ecommerce';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS chat_room_id UUID;

-- 1b. Agregar product_name a order_items para mostrar nombres aunque product_id sea null

-- 1c. Carrito persistente por conversación
ALTER TABLE chat_rooms ADD COLUMN IF NOT EXISTS cart JSONB DEFAULT '[]';
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_name TEXT;

-- 2. Salas de conversación (una por cliente/canal)
CREATE TABLE IF NOT EXISTS chat_rooms (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_id         TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'whatsapp',   -- whatsapp | instagram
  status        TEXT NOT NULL DEFAULT 'bot',         -- bot | human | closed
  customer_name TEXT,
  customer_gender TEXT,                              -- hombre | mujer | unisex
  customer_address TEXT,
  customer_city TEXT,
  customer_phone TEXT,
  assigned_to   TEXT,
  close_reason  TEXT,
  closed_by     TEXT,
  context_summary TEXT,
  last_message  TEXT,
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  window_expires_at TIMESTAMPTZ,
  unread_count  INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(wa_id, channel)
);

-- 3. Mensajes de cada sala
CREATE TABLE IF NOT EXISTS chat_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id        UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  wa_message_id  TEXT UNIQUE,
  direction      TEXT NOT NULL,   -- inbound | outbound
  sender_type    TEXT NOT NULL,   -- user | bot | human
  content        TEXT NOT NULL,
  message_type   TEXT DEFAULT 'text',  -- text | image | audio | video
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Configuración del agente IA
CREATE TABLE IF NOT EXISTS chat_agent_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  system_prompt TEXT,
  ai_model      TEXT DEFAULT 'gpt-4o-mini',
  temperature   FLOAT DEFAULT 0.7,
  transfer_rules JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Motivos de cierre configurables
CREATE TABLE IF NOT EXISTS chat_close_reasons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  active     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_chat_rooms_status      ON chat_rooms(status);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_last_msg    ON chat_rooms(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room     ON chat_messages(room_id, created_at ASC);

-- RLS (Row Level Security) — service_role bypasses all
ALTER TABLE chat_rooms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_agent_config  ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_close_reasons ENABLE ROW LEVEL SECURITY;

-- Solo service_role puede leer/escribir (el dashboard usa service_role key)
CREATE POLICY "service_role_all_chat_rooms"    ON chat_rooms         FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_chat_messages" ON chat_messages      FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_agent_config"  ON chat_agent_config  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_close_reasons" ON chat_close_reasons FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Grants explícitos para service_role
GRANT ALL ON public.chat_rooms TO service_role;
GRANT ALL ON public.chat_messages TO service_role;
GRANT ALL ON public.chat_agent_config TO service_role;
GRANT ALL ON public.chat_close_reasons TO service_role;

-- Motivos de cierre por defecto
INSERT INTO chat_close_reasons (name) VALUES
  ('Pedido realizado'),
  ('Consulta resuelta'),
  ('Cliente no respondió'),
  ('Canceló el pedido')
ON CONFLICT DO NOTHING;
