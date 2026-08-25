// ─── db.ts ─── localStorage persistence layer ──────────────────────────────

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  files?: { name: string; size: string }[]
  timestamp: number
}

export interface Session {
  id: string
  title: string
  time: string
  color: string
  createdAt: number
}

const SESSIONS_KEY = 'graphrag_sessions'
const MESSAGES_PREFIX = 'graphrag_messages_'

const COLORS = [
  'var(--color-purple)',
  'var(--color-green)',
  'var(--color-blue)',
  'var(--color-orange)',
  'var(--color-pink)',
]

// ── Sessions ──────────────────────────────────────────────────────────────

export function getSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveSession(session: Session): void {
  const sessions = getSessions()
  const idx = sessions.findIndex(s => s.id === session.id)
  if (idx >= 0) {
    sessions[idx] = session
  } else {
    sessions.unshift(session)
  }
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

export function deleteSession(id: string): void {
  const sessions = getSessions().filter(s => s.id !== id)
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  localStorage.removeItem(MESSAGES_PREFIX + id)
}

export function createSession(firstMessage?: string): Session {
  const id = Date.now().toString()
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]
  const title = firstMessage
    ? firstMessage.slice(0, 40) + (firstMessage.length > 40 ? '…' : '')
    : 'New session'
  const session: Session = {
    id,
    title,
    color,
    time: 'Just now',
    createdAt: Date.now(),
  }
  saveSession(session)
  return session
}

export function updateSessionTitle(id: string, firstMessage: string): void {
  const sessions = getSessions()
  const session = sessions.find(s => s.id === id)
  if (session && session.title === 'New session') {
    session.title = firstMessage.slice(0, 40) + (firstMessage.length > 40 ? '…' : '')
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  }
}

// ── Messages ──────────────────────────────────────────────────────────────

export function getMessages(sessionId: string): Message[] {
  try {
    const raw = localStorage.getItem(MESSAGES_PREFIX + sessionId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveMessage(sessionId: string, message: Message): void {
  const messages = getMessages(sessionId)
  messages.push(message)
  localStorage.setItem(MESSAGES_PREFIX + sessionId, JSON.stringify(messages))
}

// ── Time formatting ───────────────────────────────────────────────────────

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}
