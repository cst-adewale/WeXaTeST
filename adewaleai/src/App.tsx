import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, BarChart2, Link as LinkIcon, FileText, Brain, Search, Paperclip, File, ChevronLeft, ChevronRight, Info, MoreVertical, Trash2 } from 'lucide-react'
import {
  getSessions, createSession, deleteSession as dbDeleteSession,
  getMessages, saveMessage, updateSessionTitle, formatRelativeTime,
  type Session, type Message
} from './db'

const SUGGESTIONS = [
  { icon: <LinkIcon size={18} />, label: 'Find connections', desc: 'How are these papers related to each other?' },
  { icon: <FileText size={18} />, label: 'Summarise a paper', desc: 'Give me a concise summary of the uploaded paper' },
  { icon: <Brain size={18} />, label: 'Multi-hop reasoning', desc: 'Trace the citation chain from Author A to Topic C' },
  { icon: <Search size={18} />, label: 'Compare authors', desc: 'What do these two researchers have in common?' },
]

const GREETINGS = [
  "Hello", "Bonjour", "Hola", "Ciao", "Hallo",
  "Olá", "Namaste", "Konnichiwa", "Nǐ hǎo", "Annyeonghaseyo",
  "Marhaba", "Shalom", "Jambo", "Privet", "Hej",
  "Yassas", "Merhaba", "Szia", "Cześć", "Sawaddee"
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function App() {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true)
  const [currentView, setCurrentView] = useState<'chat' | 'info' | 'visualize'>('chat')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [greeting, setGreeting] = useState(GREETINGS[0])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load sessions from DB on mount
  useEffect(() => {
    const stored = getSessions()
    setSessions(stored)
    if (stored.length > 0) {
      setActiveSessionId(stored[0].id)
      setMessages(getMessages(stored[0].id))
    }
  }, [])

  // Random greeting interval
  useEffect(() => {
    if (currentView !== 'chat' || messages.length > 0) return
    const interval = setInterval(() => {
      let next = greeting
      while (next === greeting) {
        next = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]
      }
      setGreeting(next)
    }, 3500)
    return () => clearInterval(interval)
  }, [greeting, currentView, messages.length])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isThinking])

  // Close dot menu on outside click
  useEffect(() => {
    const handler = () => setOpenMenuId(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const switchSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    setMessages(getMessages(sessionId))
    setInputValue('')
    setAttachedFiles([])
    setCurrentView('chat')
  }, [])

  const handleNewChat = () => {
    const session = createSession()
    setSessions(getSessions())
    setActiveSessionId(session.id)
    setMessages([])
    setInputValue('')
    setAttachedFiles([])
    setCurrentView('chat')
  }

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    dbDeleteSession(id)
    const remaining = getSessions()
    setSessions(remaining)
    if (activeSessionId === id) {
      if (remaining.length > 0) {
        switchSession(remaining[0].id)
      } else {
        setActiveSessionId(null)
        setMessages([])
      }
    }
    setOpenMenuId(null)
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return
    setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)])
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const handleSend = async () => {
    const text = inputValue.trim()
    if (!text && attachedFiles.length === 0) return

    // Create a session if none exists
    let sessionId = activeSessionId
    if (!sessionId) {
      const session = createSession(text)
      setSessions(getSessions())
      setActiveSessionId(session.id)
      sessionId = session.id
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      files: attachedFiles.map(f => ({ name: f.name, size: formatBytes(f.size) })),
      timestamp: Date.now(),
    }

    saveMessage(sessionId, userMsg)
    // Update session title from first message
    updateSessionTitle(sessionId, text)
    setSessions(getSessions())

    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setAttachedFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setIsThinking(true)

    setTimeout(() => {
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I\'ve retrieved context from your knowledge graph. Based on the multi-hop traversal across your uploaded papers, here is what the graph reveals about the connections in your query.',
        timestamp: Date.now(),
      }
      saveMessage(sessionId!, assistantMsg)
      setMessages(prev => [...prev, assistantMsg])
      setIsThinking(false)
    }, 2000)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSuggestionClick = (text: string) => {
    setInputValue(text)
    setCurrentView('chat')
    textareaRef.current?.focus()
  }

  return (
    <div className={`app-shell ${isSidebarExpanded ? '' : 'sidebar-collapsed'}`}>

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="avatar-circle">
            <div className="avatar-plus"><Plus size={10} strokeWidth={4} /></div>
          </div>
          <div className="user-info">
            <div className="user-name">Adewale</div>
            <div className="user-badge">Premium</div>
          </div>
        </div>

        <div className="sidebar-footer">
          <button className={`new-chat-btn ${currentView === 'chat' ? 'active-view' : ''}`} onClick={handleNewChat} id="new-chat-btn">
            <Plus size={14} strokeWidth={3} /> <span className="btn-label">New session</span>
          </button>
          <button className={`visualize-btn ${currentView === 'visualize' ? 'active-view' : ''}`} onClick={() => setCurrentView('visualize')} id="visualize-btn">
            <BarChart2 size={14} strokeWidth={2.5} /> <span className="btn-label">Visualize</span>
          </button>
          <button className={`info-btn ${currentView === 'info' ? 'active-view' : ''}`} onClick={() => setCurrentView('info')} id="info-btn">
            <Info size={14} strokeWidth={2.5} /> <span className="btn-label">Info</span>
          </button>
        </div>

        <div className="sidebar-section-label">Recent Sessions</div>

        <div className="session-list">
          {sessions.length === 0 && (
            <div className="sessions-empty">No sessions yet</div>
          )}
          {sessions.map(session => (
            <div
              key={session.id}
              className={`session-item ${activeSessionId === session.id ? 'active' : ''}`}
              onClick={() => switchSession(session.id)}
            >
              <div className="session-dot" style={{ background: session.color }} />
              <div className="session-meta">
                <div className="session-title">{session.title}</div>
                <div className="session-time">{formatRelativeTime(session.createdAt)}</div>
              </div>
              <div className="session-menu-wrap">
                <button
                  className="session-dots-btn"
                  onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === session.id ? null : session.id) }}
                  aria-label="Session options"
                >
                  <MoreVertical size={14} />
                </button>
                {openMenuId === session.id && (
                  <div className="session-dropdown">
                    <button
                      className="session-dropdown-item delete"
                      onClick={e => handleDeleteSession(e, session.id)}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="sidebar-bottom-toggle">
          <button
            className="sidebar-toggle"
            onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
            aria-label="Toggle Sidebar"
          >
            {isSidebarExpanded ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>
      </aside>

      {/* ── Main Chat ── */}
      <main className="chat-main">

        {/* Header */}
        <header className="chat-header">
          <div className="chat-header-left">
            <span className="sidebar-logo">
              Graph<span>RAG</span>
            </span>
          </div>
          <div className="status-badge">
            <div className="status-dot" />
            Database connected
          </div>
        </header>

        {/* Messages / Info View */}
        <div className="messages-area">
          {currentView === 'info' ? (
            <div className="empty-state">
              <h1 className="empty-state-title">
                Ask your<br />knowledge graph
              </h1>
              <p className="empty-state-sub">
                Upload research papers and ask questions. The system traverses your graph using multi-hop Cypher queries to ground every answer in facts.
              </p>
              <div className="suggestion-grid">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    className="suggestion-card"
                    onClick={() => handleSuggestionClick(s.desc)}
                    id={`suggestion-${i}`}
                  >
                    <div className="suggestion-icon">{s.icon}</div>
                    <div className="suggestion-label">{s.label}</div>
                    <div className="suggestion-desc">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : currentView === 'visualize' ? (
            <div className="empty-state" style={{ margin: 'auto' }}>
              <BarChart2 size={48} color="var(--color-green)" style={{ marginBottom: 16 }} />
              <h2 style={{ fontFamily: 'var(--font-display)' }}>Graph Visualization</h2>
              <p style={{ color: 'var(--muted-ink)', marginTop: 8 }}>Your knowledge graph visualization will appear here.</p>
            </div>
          ) : (
            <>
              {messages.length === 0 && !isThinking && (
                <div className="chat-placeholder">
                  <h1 className="greeting-text">
                    <span key={greeting} className="greeting-hello">{greeting}</span>, Adewale
                  </h1>
                  <p className="greeting-sub">Start a new conversation...</p>
                </div>
              )}
              {messages.map(msg => (
                <div key={msg.id} className={`message ${msg.role}`}>
                  <div className="message-sender">
                    {msg.role === 'user' ? 'You' : 'GraphRAG'}
                  </div>
                  <div className="message-bubble">
                    {msg.content}
                    {msg.files && msg.files.length > 0 && msg.files.map((f, i) => (
                      <div key={i} className="file-attachment">
                        <span className="file-icon"><File size={14} /></span>
                        <span className="file-name">{f.name}</span>
                        <span className="file-size">{f.size}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {isThinking && (
                <div className="message assistant">
                  <div className="message-sender">GraphRAG</div>
                  <div className="thinking-bubble">
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                    <div className="thinking-dot" />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area — only on chat view */}
        {currentView === 'chat' && <div className="input-area">
          {attachedFiles.length > 0 && (
            <div className="attached-files">
              {attachedFiles.map((file, i) => (
                <div key={i} className="attached-file-chip">
                  <File size={12} />
                  <span>{file.name}</span>
                  <button
                    className="chip-remove"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="input-card">
            <textarea
              ref={textareaRef}
              id="chat-input"
              rows={2}
              placeholder="Ask me anything…"
              value={inputValue}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
            />
            <div className="input-actions">
              <div className="input-left-actions">
                <button
                  className="upload-btn"
                  onClick={() => fileInputRef.current?.click()}
                  id="upload-btn"
                >
                  <Paperclip size={14} /> Attach PDF
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                  id="file-input"
                />
              </div>
              <button
                className="send-btn"
                onClick={handleSend}
                disabled={!inputValue.trim() && attachedFiles.length === 0}
                id="send-btn"
              >
                Send ↑
              </button>
            </div>
          </div>
          <p className="input-hint">Press Enter to send · Shift + Enter for new line</p>
        </div>}

      </main>
    </div>
  )
}
