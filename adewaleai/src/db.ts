// ─── db.ts ─── localStorage + backend persistence layer ──────────────────────

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
const ARTIFACTS_PREFIX = 'graphrag_artifacts_'

const COLORS = [
  '#d9bbfc',  // purple
  '#b8f0cc',  // green
  '#a8d8f8',  // blue
  '#ffd9a0',  // orange
  '#ffb8d9',  // pink
]

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Sync ─────────────────────────────────────────────────────────────────

export async function syncFromBackend(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/sessions`)
    if (!res.ok) return
    const backendSessions: Session[] = await res.json()
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(backendSessions))
    
    // For each session, we could sync messages, but to avoid many requests, 
    // we'll just fetch them on demand or assume the cache is okay for now.
    // In a real app we might bulk sync.
    for (const session of backendSessions) {
      const mRes = await fetch(`${API_URL}/sessions/${session.id}/messages`)
      if (mRes.ok) {
        const msgs = await mRes.json()
        localStorage.setItem(MESSAGES_PREFIX + session.id, JSON.stringify(msgs))
      }
    }
  } catch (e) {
    console.error("Backend sync failed:", e)
  }
}

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
  
  // Async backend sync
  fetch(`${API_URL}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session)
  }).catch(console.error)
}

export function deleteSession(id: string): void {
  const sessions = getSessions().filter(s => s.id !== id)
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  localStorage.removeItem(MESSAGES_PREFIX + id)
  
  fetch(`${API_URL}/sessions/${id}`, { method: 'DELETE' }).catch(console.error)
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
    
    // Resave to backend
    fetch(`${API_URL}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session)
    }).catch(console.error)
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
  
  fetch(`${API_URL}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message)
  }).catch(console.error)
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

// ── Per-session Artifacts ─────────────────────────────────────────────────

export interface ArtifactFile {
  name: string
  size: string
  type: string
}

export function getArtifacts(sessionId: string): ArtifactFile[] {
  try {
    const raw = localStorage.getItem(ARTIFACTS_PREFIX + sessionId)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addArtifact(sessionId: string, file: ArtifactFile): ArtifactFile[] {
  const existing = getArtifacts(sessionId)
  const updated = [file, ...existing]
  localStorage.setItem(ARTIFACTS_PREFIX + sessionId, JSON.stringify(updated))
  return updated
}

export function clearArtifacts(sessionId: string): void {
  localStorage.removeItem(ARTIFACTS_PREFIX + sessionId)
}

export function deleteSessionArtifacts(sessionId: string): void {
  localStorage.removeItem(ARTIFACTS_PREFIX + sessionId)
}
