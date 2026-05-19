import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Server-side client (full access, bypasses RLS)
export const supabaseAdmin = createClient(url, serviceKey)

// Browser client (public, respects RLS)
export const supabase = createClient(url, anonKey)
