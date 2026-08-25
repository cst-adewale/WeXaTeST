import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, BarChart2, Link as LinkIcon, FileText, Brain, Search, Paperclip, File, ChevronLeft, ChevronRight, Info, MoreVertical, Trash2, Wifi, Battery, MessageSquare } from 'lucide-react'
import SessionGraphVisualizer from './components/SessionGraphVisualizer'
import {
  getSessions, createSession, deleteSession as dbDeleteSession,
  getMessages, saveMessage, updateSessionTitle, formatRelativeTime, syncFromBackend,
  getArtifacts, addArtifact, clearArtifacts,
  type Session, type Message, type ArtifactFile
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
  // Session-scoped artifacts: Record<sessionId, ArtifactFile[]>
  const [sessionArtifacts, setSessionArtifacts] = useState<Record<string, ArtifactFile[]>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Derived: artifacts for the active session
  const uploadedFiles = activeSessionId ? (sessionArtifacts[activeSessionId] ?? []) : []

  // Load sessions on mount — artifacts are loaded per-session on demand
  useEffect(() => {
    const stored = getSessions()
    setSessions(stored)
    if (stored.length > 0) {
      const firstId = stored[0].id
      setActiveSessionId(firstId)
      setMessages(getMessages(firstId))
      // Pre-load artifacts for the first session
      const arts: Record<string, ArtifactFile[]> = {}
      stored.forEach(s => { arts[s.id] = getArtifacts(s.id) })
      setSessionArtifacts(arts)
    }

    // Sync with backend async and then refresh state
    syncFromBackend().then(() => {
      const synced = getSessions()
      setSessions(synced)
      const arts: Record<string, ArtifactFile[]> = {}
      synced.forEach(s => { arts[s.id] = getArtifacts(s.id) })
      setSessionArtifacts(arts)
      if (activeSessionId) {
        setMessages(getMessages(activeSessionId))
      } else if (synced.length > 0) {
        setActiveSessionId(synced[0].id)
        setMessages(getMessages(synced[0].id))
      }
    })
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

    // Upload files to backend and track them per session
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
            console.log('Uploaded successfully:', result)
          }
        } catch (uploadErr) {
          console.error('Upload error:', uploadErr)
        }
        // Record artifact under current session
        const art: ArtifactFile = {
          name: file.name,
          size: formatBytes(file.size),
          type: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'unknown')
        }
        const updated = addArtifact(sessionId!, art)
        setSessionArtifacts(prev => ({ ...prev, [sessionId!]: updated }))
      }
    }

    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setAttachedFiles([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setIsThinking(true)
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
      let res;
      
      if (attachedFiles.length > 0) {
        // Use multipart /chat endpoint to send both question & file context together
        const formData = new FormData()
        formData.append('question', text || `Reviewing attached documents: ${attachedFiles.map(f => f.name).join(', ')}`)
        formData.append('history', JSON.stringify(messages)) // pass chat history
        attachedFiles.forEach(file => {
          formData.append('files', file)
        })

        res = await fetch(`${API_URL}/chat`, {
          method: 'POST',
          body: formData, // browser sets Content-Type boundary automatically
        });
      } else {
        // standard question ask with history payload
        res = await fetch(`${API_URL}/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            question: text,
            history: messages // pass chat history
          }),
        });
      }

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
          <div className="chat-header-status-bar">
            <span className="status-bar-location">Lagos, Nigeria</span>
            <span className="status-bar-divider">|</span>
            <LiveClock />
            <Wifi size={14} strokeWidth={2} className="status-bar-icon" />
            <Battery size={16} strokeWidth={2} className="status-bar-icon" />
          </div>
          <div className="status-badge">
            <div className="status-dot" />
            Database connected
          </div>
        </header>

        {/* Messages / Info View */}
        <div className={`messages-area${currentView === 'visualize' ? ' messages-area--fullscreen' : ''}`}>
          {currentView === 'info' ? (
            <div className="info-page">
              <div className="info-hero">
                <span className="sidebar-logo" style={{ fontSize: 28, letterSpacing: '-0.07em' }}>Graph<span>RAG</span></span>
                <h1 className="info-title">Academic Paper Knowledge Assistant</h1>
                <p className="info-subtitle">A smart assistant designed to help you search, connect, and understand academic papers through a Neo4j/CognoDB knowledge graph.</p>
              </div>

              <div className="info-section-grid">
                <div className="info-card info-card--purple">
                  <div className="info-card-icon"><FileText size={22} strokeWidth={2.5} /></div>
                  <h3>Upload Papers</h3>
                  <p>Upload academic papers in PDF format. The system automatically extracts key details — authors, topics, and citations.</p>
                </div>
                <div className="info-card info-card--green">
                  <div className="info-card-icon"><LinkIcon size={22} strokeWidth={2.5} /></div>
                  <h3>Build a Knowledge Graph</h3>
                  <p>Extracted entities are linked together as nodes and edges in a CognoDB (Neo4j) graph database, preserving the natural structure of research.</p>
                </div>
                <div className="info-card info-card--blue">
                  <div className="info-card-icon"><MessageSquare size={22} strokeWidth={2.5} /></div>
                  <h3>Ask Questions</h3>
                  <p>Chat with the assistant to query across the graph. Multi-hop Cypher queries traverse connected relationships to ground every answer in facts.</p>
                </div>
              </div>

              <div className="info-section">
                <h2 className="info-section-title">Why a Graph Database?</h2>
                <div className="info-why-grid">
                  <div className="info-why-item">
                    <span className="info-why-num">01</span>
                    <div>
                      <h4>Relationship-Driven Context</h4>
                      <p>Papers form a rich web — authors collaborate, papers cite others, documents share overlapping topics. Storing this as nodes and edges preserves the natural structure of the data.</p>
                    </div>
                  </div>
                  <div className="info-why-item">
                    <span className="info-why-num">02</span>
                    <div>
                      <h4>Efficient Multi-Hop Traversals</h4>
                      <p>Queries like <em>"Find the citation chain from Devlin to Vaswani"</em> require traversing multiple hops. In SQL this means slow nested JOINs. In a graph database, it's milliseconds.</p>
                    </div>
                  </div>
                  <div className="info-why-item">
                    <span className="info-why-num">03</span>
                    <div>
                      <h4>Contextual RAG Retrieval</h4>
                      <p>Standard RAG uses simple vector search and loses relational context. Our pipeline retrieves entire sub-graphs, giving the LLM richer, structured, and factual context.</p>
                    </div>
                  </div>
                  <div className="info-why-item">
                    <span className="info-why-num">04</span>
                    <div>
                      <h4>Evolutionary Schema</h4>
                      <p>Research fields evolve rapidly. New entities (funding agencies, universities, journals) can be added as nodes and relationships dynamically — no costly table migrations.</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="info-section">
                <h2 className="info-section-title">Graph Data Model</h2>
                <div className="info-model-grid">
                  <div className="info-model-nodes">
                    {[{node:'Paper', props:'title, year, abstract', color:'var(--color-blue)'}, {node:'Author', props:'name', color:'var(--color-purple)'}, {node:'Topic', props:'name', color:'var(--color-green)'}].map(n => (
                      <div key={n.node} className="info-node-pill" style={{ borderColor: 'var(--ink)', background: n.color }}>
                        <span className="info-node-label">{n.node}</span>
                        <span className="info-node-props">{n.props}</span>
                      </div>
                    ))}
                  </div>
                  <div className="info-model-rels">
                    {[{rel:'WROTE', from:'Author', to:'Paper'}, {rel:'DISCUSSES', from:'Paper', to:'Topic'}, {rel:'CITES', from:'Paper', to:'Paper'}, {rel:'COLLABORATES_WITH', from:'Author', to:'Author'}].map(r => (
                      <div key={r.rel} className="info-rel-row">
                        <span className="info-rel-from">{r.from}</span>
                        <span className="info-rel-arrow">──[{r.rel}]──▶</span>
                        <span className="info-rel-to">{r.to}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : currentView === 'visualize' ? (
            <SessionGraphVisualizer
              sessions={sessions}
              activeSessionId={activeSessionId}
              uploadedFiles={uploadedFiles}
              onSelectSession={(id) => switchSession(id)}
            />
          ) : currentView === 'artifacts' ? (
            <div className="empty-state" style={{ margin: 'auto', width: '100%', maxWidth: '800px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: '1.7px solid var(--ink)', paddingBottom: 12 }}>
                <div>
                  <h2 style={{ fontFamily: 'var(--font-display)', margin: '0 0 4px' }}>Session Artifacts</h2>
                  {activeSessionId && sessions.find(s => s.id === activeSessionId) && (
                    <div style={{ fontSize: '12px', color: 'var(--muted-ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: sessions.find(s => s.id === activeSessionId)?.color, display: 'inline-block', border: '1px solid var(--ink)' }} />
                      {sessions.find(s => s.id === activeSessionId)?.title}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (!activeSessionId) return
                    clearArtifacts(activeSessionId)
                    setSessionArtifacts(prev => ({ ...prev, [activeSessionId]: [] }))
                  }}
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
                  Clear Session
                </button>
              </div>
              {uploadedFiles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--muted-ink)' }}>
                  <FileText size={48} style={{ marginBottom: 16, opacity: 0.5, margin: '0 auto' }} />
                  <p>No files uploaded in this session yet. Attach files in the chat to see them here.</p>
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
                        background: 'var(--paper)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        position: 'relative',
                        boxShadow: '3px 3px 0 var(--ink)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '8px',
                          background: sessions.find(s => s.id === activeSessionId)?.color || '#d9bbfc',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          border: '1.5px solid var(--ink)'
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
                          if (!activeSessionId) return
                          const updatedArts = uploadedFiles.filter((_, i) => i !== idx)
                          localStorage.setItem(`graphrag_artifacts_${activeSessionId}`, JSON.stringify(updatedArts))
                          setSessionArtifacts(prev => ({ ...prev, [activeSessionId]: updatedArts }))
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
                    <MarkdownBubble content={msg.content} />
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

// ── LiveClock ──────────────────────────────────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const fmt = time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return <span className="status-bar-clock">{fmt}</span>
}

// ── MarkdownBubble ────────────────────────────────────────────────────────
function MarkdownBubble({ content }: { content: string }) {
  // Split into paragraphs / blocks
  const blocks = content.split('\n\n')

  return (
    <div className="markdown-content">
      {blocks.map((block, bIdx) => {
        const lines = block.split('\n')
        
        // Check if list block
        const isList = lines.every(line => {
          const trimmed = line.trim()
          return trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)
        })

        if (isList) {
          const listType = lines[0].trim().match(/^\d+\.\s/) ? 'ol' : 'ul'
          const items = lines.map(line => {
            const cleanText = line.trim().replace(/^(-\s|\*\s|\d+\.\s)/, '')
            return parseInlineMarkdown(cleanText)
          })

          if (listType === 'ol') {
            return (
              <ol key={bIdx} className="markdown-list">
                {items.map((item, idx) => <li key={idx}>{item}</li>)}
              </ol>
            )
          } else {
            return (
              <ul key={bIdx} className="markdown-list">
                {items.map((item, idx) => <li key={idx}>{item}</li>)}
              </ul>
            )
          }
        }

        // Standard paragraph
        return (
          <p key={bIdx} className="markdown-para">
            {lines.map((line, lIdx) => (
              <span key={lIdx}>
                {parseInlineMarkdown(line)}
                {lIdx < lines.length - 1 && <br />}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function parseInlineMarkdown(text: string) {
  // Regex to match **bold**
  const boldRegex = /\*\*(.*?)\*\*/g
  const parts = []
  let lastIndex = 0
  let match

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    parts.push(<strong key={match.index}>{match[1]}</strong>)
    lastIndex = boldRegex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

