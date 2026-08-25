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
  const [currentView, setCurrentView] = useState<'chat' | 'info' | 'visualize' | 'artifacts'>('chat')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [isThinking, setIsThinking] = useState(false)
  const [greeting, setGreeting] = useState(GREETINGS[0])
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; size: string; type: string }[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load sessions and uploaded files from DB/localStorage on mount
  useEffect(() => {
    const stored = getSessions()
    setSessions(stored)
    if (stored.length > 0) {
      setActiveSessionId(stored[0].id)
      setMessages(getMessages(stored[0].id))
    }
    try {
      const files = localStorage.getItem('uploaded_files')
      if (files) {
        setUploadedFiles(JSON.parse(files))
      }
    } catch (e) {
      console.error(e)
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

    // Upload files to backend if any are attached
    if (attachedFiles.length > 0) {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      for (const file of attachedFiles) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          const uploadRes = await fetch(`${API_URL}/upload`, {
            method: 'POST',
            body: formData
          })
          if (uploadRes.ok) {
            const result = await uploadRes.json()
            console.log("Uploaded successfully:", result)
          }
        } catch (uploadErr) {
          console.error("Upload error:", uploadErr)
        }
      }

      // Add to local state and localStorage
      const newUploads = attachedFiles.map(f => ({
        name: f.name,
        size: formatBytes(f.size),
        type: f.type || (f.name.endsWith('.pdf') ? 'application/pdf' : 'unknown')
      }))
      const updatedList = [...newUploads, ...uploadedFiles]
      setUploadedFiles(updatedList)
      localStorage.setItem('uploaded_files', JSON.stringify(updatedList))
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setAttachedFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setIsThinking(true)
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      const res = await fetch(`${API_URL}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: text }),
      });
      if (!res.ok) {
        throw new Error(`Server returned error status ${res.status}`);
      }
      const data = await res.json();
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer || 'No response from system.',
        timestamp: Date.now(),
      };
      saveMessage(sessionId!, assistantMsg);
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: Failed to fetch response from backend API. ${err.message || err}`,
        timestamp: Date.now(),
      };
      saveMessage(sessionId!, assistantMsg);
      setMessages(prev => [...prev, assistantMsg]);
    } finally {
      setIsThinking(false);
    }
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
          <button className={`info-btn ${currentView === 'artifacts' ? 'active-view' : ''}`} onClick={() => setCurrentView('artifacts')} id="artifacts-btn">
            <File size={14} strokeWidth={2.5} /> <span className="btn-label">Artifacts</span>
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
          ) : currentView === 'artifacts' ? (
            <div className="empty-state" style={{ margin: 'auto', width: '100%', maxWidth: '800px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1.7px solid var(--ink)', paddingBottom: 12 }}>
                <h2 style={{ fontFamily: 'var(--font-display)', margin: 0 }}>Uploaded Artifacts</h2>
                <button 
                  onClick={() => { setUploadedFiles([]); localStorage.removeItem('uploaded_files'); }}
                  style={{ 
                    background: 'transparent', 
                    border: '1.7px solid var(--ink)', 
                    padding: '6px 12px', 
                    borderRadius: '6px', 
                    fontSize: '11px', 
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-sans)',
                    color: 'var(--ink)'
                  }}
                >
                  Clear All
                </button>
              </div>
              {uploadedFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted-ink)' }}>
                  <FileText size={48} style={{ marginBottom: 16, opacity: 0.5, margin: '0 auto' }} />
                  <p>No artifacts uploaded yet. Attach files in the chat to see them here.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, width: '100%' }}>
                  {uploadedFiles.map((file, idx) => (
                    <div 
                      key={idx} 
                      style={{ 
                        border: '1.7px solid var(--ink)', 
                        borderRadius: '12px', 
                        padding: '16px', 
                        background: 'var(--card-bg, transparent)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        position: 'relative'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ 
                          width: '36px', 
                          height: '36px', 
                          borderRadius: '8px', 
                          background: 'var(--color-purple)', 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center',
                          color: '#fff',
                          flexShrink: 0
                        }}>
                          {file.type.startsWith('image/') ? <Brain size={18} /> : <FileText size={18} />}
                        </div>
                        <div style={{ overflow: 'hidden', textAlign: 'left' }}>
                          <div style={{ fontWeight: 600, fontSize: '13px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--ink)' }} title={file.name}>
                            {file.name}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted-ink)' }}>{file.size}</div>
                        </div>
                      </div>
                      <div style={{ marginTop: 8, fontSize: '11px', color: 'var(--muted-ink)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, textAlign: 'left' }}>
                        {file.type.split('/')[1] || 'document'}
                      </div>
                      <button
                        onClick={() => {
                          const updated = uploadedFiles.filter((_, i) => i !== idx);
                          setUploadedFiles(updated);
                          localStorage.setItem('uploaded_files', JSON.stringify(updated));
                        }}
                        style={{
                          position: 'absolute',
                          top: 12,
                          right: 12,
                          background: 'none',
                          border: 'none',
                          color: 'var(--muted-ink)',
                          cursor: 'pointer',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          padding: 0
                        }}
                        aria-label="Remove artifact"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
                    {msg.role === 'user' ? 'You' : (
                      <span className="sidebar-logo">
                        Graph<span>RAG</span>
                      </span>
                    )}
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
                  <div className="message-sender">
                    <span className="sidebar-logo">
                      Graph<span>RAG</span>
                    </span>
                  </div>
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
                  <Paperclip size={14} /> Attach files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md,image/*"
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
