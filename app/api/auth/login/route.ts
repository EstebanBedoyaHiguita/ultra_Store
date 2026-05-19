import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) return NextResponse.json({ error: 'Credenciales requeridas' }, { status: 400 })

  const { data: admin } = await supabaseAdmin
    .from('admin_users')
    .select('id, email, name, role, password_hash, is_active')
    .eq('email', email.toLowerCase().trim())
    .single()

  if (!admin || !admin.is_active) {
    return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })
  }

  // Dynamic import to avoid edge runtime issues
  const bcrypt = await import('bcryptjs')
  const valid = await bcrypt.compare(password, admin.password_hash)
  if (!valid) return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 })

  const session = { id: admin.id, email: admin.email, name: admin.name, role: admin.role }
  const cookieStore = await cookies()
  cookieStore.set('ultrastore-admin-session', Buffer.from(JSON.stringify(session)).toString('base64'), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  })
  cookieStore.set('agent_name', admin.name, { maxAge: 60 * 60 * 24 * 7, path: '/' })

  return NextResponse.json({ ok: true, name: admin.name, role: admin.role })
}

export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete('ultrastore-admin-session')
  cookieStore.delete('agent_name')
  return NextResponse.json({ ok: true })
}
