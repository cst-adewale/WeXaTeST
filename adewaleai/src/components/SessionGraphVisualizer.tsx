import { useEffect, useRef, useCallback, useState } from 'react'
import { getMessages } from '../db'
import type { Session } from '../db'

// ─── Types ─────────────────────────────────────────────────────────────────

type NodeType = 'root' | 'session' | 'user-msg' | 'ai-msg' | 'Paper' | 'Author' | 'Topic'

interface GraphNode {
  id: string
  type: NodeType
  label: string
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  color: string
  borderColor: string
  shadowColor: string
  sessionId?: string
  msgContent?: string
  pinned?: boolean
}

interface GraphEdge {
  source: string
  target: string
  strength: number
  label?: string
}

interface Pulse {
  id: number
  pathNodeIds: string[]
  t: number
  segIdx: number
  speed: number
  color: string
  radius: number
}

// ─── Constants ─────────────────────────────────────────────────────────────
const COLORS = {
  bg: '#fdfdfb',         // Paper color
  grid: '#dfdfd9',       // Line color
  ink: '#171717',        // Solid black ink
  purple: '#d9bbfc',
  green: '#6dd68d',
  blue: '#a8d4ff',
  orange: '#ffb683',
  pink: '#ffaee4',
  paper: '#ffffff',
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  uploadedFiles: { name: string; size: string; type: string }[]
  onSelectSession: (id: string) => void
}

let pulseIdCounter = 0

export default function SessionGraphVisualizer({ sessions, activeSessionId, uploadedFiles, onSelectSession }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [filter, setFilter] = useState<'All' | 'Papers' | 'Authors' | 'Topics'>('All')
  const [viewMode, setViewMode] = useState<'session' | 'global'>('session')
  const [nodeCount, setNodeCount] = useState(0)

  const stateRef = useRef({
    neoNodes: [] as any[],
    neoLinks: [] as any[],
    nodes: [] as GraphNode[],
    edges: [] as GraphEdge[],
    pulses: [] as Pulse[],
    hoveredNodeId: null as string | null,
    tooltip: null as { x: number; y: number; label: string; sub: string } | null,
    animFrame: 0,
    pulseTimer: 0,
    simTicks: 0,
    offset: { x: 0, y: 0 },
    scale: 1,
    dragging: false,
    dragStart: { x: 0, y: 0 },
    offsetStart: { x: 0, y: 0 },
  })

  // ── Fetch Neo4j Graph ──────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/graph`)
      .then(res => res.json())
      .then(data => {
        stateRef.current.neoNodes = data.nodes || []
        stateRef.current.neoLinks = data.links || []
        buildGraph(canvasRef.current?.offsetWidth || 800, canvasRef.current?.offsetHeight || 600)
      })
      .catch(console.error)
  }, [activeSessionId, viewMode, filter])

  // Helper to measure text width
  const measureNodeDimensions = (ctx: CanvasRenderingContext2D, label: string, type: NodeType) => {
    ctx.font = '12px "Bricolage Grotesque", sans-serif'
    const textWidth = ctx.measureText(label).width
    let w = textWidth + 24
    let h = 28
    let radius = 6

    if (type === 'root' || type === 'session') {
      w = textWidth + 32
      h = 36
      radius = 12
    } else if (type === 'Paper') {
      w = Math.max(120, textWidth + 20)
      h = 44
      radius = 4
    }

    return { w, h, radius }
  }

  // ── Build graph ────────────────────────────────────────────────────────
  const buildGraph = useCallback((w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const cx = w / 2
    const cy = h / 2
    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []

    // ── Mode 1: Active Session Flowchart Mesh ──
    if (viewMode === 'session' && activeSessionId) {
      const activeSession = sessions.find(s => s.id === activeSessionId)
      if (activeSession) {
        const sessionColor = activeSession.color.startsWith('var(')
          ? resolveVar(activeSession.color)
          : activeSession.color

        // 1. Session node (Flowchart start)
        const sDim = measureNodeDimensions(ctx, activeSession.title, 'session')
        nodes.push({
          id: `session-${activeSession.id}`,
          type: 'session',
          label: activeSession.title,
          x: cx - 200,
          y: cy,
          vx: 0, vy: 0,
          width: sDim.w,
          height: sDim.h,
          color: sessionColor,
          borderColor: COLORS.ink,
          shadowColor: COLORS.ink,
        })

        // 2. Message sequence nodes (rendered in a horizontal flow)
        const msgs = getMessages(activeSession.id)
        let lastMsgId = `session-${activeSession.id}`
        
        msgs.forEach((msg, idx) => {
          const isUser = msg.role === 'user'
          const mDim = measureNodeDimensions(ctx, isUser ? 'You' : 'GraphRAG', isUser ? 'user-msg' : 'ai-msg')
          const mx = cx - 100 + idx * 280
          const my = cy + (idx % 2 === 0 ? -120 : 120)

          nodes.push({
            id: `msg-${activeSession.id}-${idx}`,
            type: isUser ? 'user-msg' : 'ai-msg',
            label: isUser ? 'You' : 'GraphRAG',
            msgContent: msg.content,
            x: mx,
            y: my,
            vx: 0, vy: 0,
            width: mDim.w,
            height: mDim.h,
            color: isUser ? COLORS.blue : COLORS.green,
            borderColor: COLORS.ink,
            shadowColor: COLORS.ink,
          })

          edges.push({
            source: lastMsgId,
            target: `msg-${activeSession.id}-${idx}`,
            strength: 0.05,
          })
          lastMsgId = `msg-${activeSession.id}-${idx}`

          // 3. Connect to relevant database elements (mesh effect)
          const content = msg.content.toLowerCase()
          stateRef.current.neoNodes.forEach(nn => {
            if (filter !== 'All' && nn.type !== filter) return

            const labelLower = (nn.label || nn.id).toLowerCase()
            if (content.includes(labelLower) || (nn.type === 'Paper' && idx === msgs.length - 1 && Math.random() > 0.7)) {
              let nodeExists = nodes.find(n => n.id === `neo-${nn.id}`)
              if (!nodeExists) {
                const nnDim = measureNodeDimensions(ctx, nn.label || nn.id, nn.type as NodeType)
                let cColor = COLORS.paper
                if (nn.type === 'Author') cColor = COLORS.purple
                if (nn.type === 'Topic') cColor = COLORS.orange

                nodeExists = {
                  id: `neo-${nn.id}`,
                  type: nn.type as NodeType,
                  label: nn.label || nn.id,
                  x: mx + (Math.random() - 0.5) * 200,
                  y: my + (msg.role === 'user' ? -180 : 180),
                  vx: 0, vy: 0,
                  width: nnDim.w,
                  height: nnDim.h,
                  color: cColor,
                  borderColor: COLORS.ink,
                  shadowColor: COLORS.ink,
                }
                nodes.push(nodeExists)
              }

              edges.push({
                source: `msg-${activeSession.id}-${idx}`,
                target: nodeExists.id,
                strength: 0.015,
              })
            }
          })
        })
      }
    } else {
      // ── Mode 2: Global Database Mesh ──
      const rootDim = measureNodeDimensions(ctx, 'GraphRAG Core', 'root')
      nodes.push({
        id: 'root',
        type: 'root',
        label: 'GraphRAG Core',
        x: cx, y: cy,
        vx: 0, vy: 0,
        width: rootDim.w,
        height: rootDim.h,
        color: COLORS.purple,
        borderColor: COLORS.ink,
        shadowColor: COLORS.ink,
        pinned: true,
      })

      stateRef.current.neoNodes.forEach((nn, idx) => {
        if (filter !== 'All' && nn.type !== filter) return

        const angle = (idx / stateRef.current.neoNodes.length) * Math.PI * 2
        const dist = 240 + Math.random() * 120
        const nnDim = measureNodeDimensions(ctx, nn.label || nn.id, nn.type as NodeType)
        
        let cColor = COLORS.paper
        if (nn.type === 'Author') cColor = COLORS.purple
        if (nn.type === 'Topic') cColor = COLORS.orange

        nodes.push({
          id: `neo-${nn.id}`,
          type: nn.type as NodeType,
          label: nn.label || nn.id,
          x: cx + Math.cos(angle) * dist,
          y: cy + Math.sin(angle) * dist,
          vx: 0, vy: 0,
          width: nnDim.w,
          height: nnDim.h,
          color: cColor,
          borderColor: COLORS.ink,
          shadowColor: COLORS.ink,
        })

        edges.push({
          source: 'root',
          target: `neo-${nn.id}`,
          strength: 0.02,
        })
      })

      stateRef.current.neoLinks.forEach(link => {
        const sourceExists = nodes.some(n => n.id === `neo-${link.source}`)
        const targetExists = nodes.some(n => n.id === `neo-${link.target}`)
        if (sourceExists && targetExists) {
          edges.push({
            source: `neo-${link.source}`,
            target: `neo-${link.target}`,
            strength: 0.04,
            label: link.rel
          })
        }
      })
    }

    stateRef.current.nodes = nodes
    stateRef.current.edges = edges
    stateRef.current.simTicks = 0
    setNodeCount(nodes.length)
  }, [sessions, activeSessionId, filter, viewMode])

  // ── Force simulation tick ──────────────────────────────────────────────
  const simulateTick = useCallback(() => {
    const { nodes, edges, simTicks } = stateRef.current
    if (simTicks > 400) return
    stateRef.current.simTicks++

    const damping = 0.85
    const repulse = 8000   // stronger push for better spacing

    const nodeMap = new Map(nodes.map(n => [n.id, n]))

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j]
        if (a.pinned && b.pinned) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const minDist = (a.width + b.width) / 2 + 120  // bigger separation gap
        if (dist < minDist) {
          const force = repulse / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          if (!a.pinned) { a.vx -= fx; a.vy -= fy }
          if (!b.pinned) { b.vx += fx; b.vy += fy }
        }
      }
    }

    edges.forEach(edge => {
      const a = nodeMap.get(edge.source)
      const b = nodeMap.get(edge.target)
      if (!a || !b) return
      const dx = b.x - a.x
      const dy = b.y - a.y
      const fx = dx * edge.strength
      const fy = dy * edge.strength
      if (!a.pinned) { a.vx += fx; a.vy += fy }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy }
    })
    
    nodes.forEach(n => {
      if (n.pinned) return
      n.vx *= damping
      n.vy *= damping
      n.x += n.vx
      n.y += n.vy
    })
  }, [])

  // ── Spawn a neuron pulse ───────────────────────────────────────────────
  const spawnPulse = useCallback(() => {
    const { nodes, edges } = stateRef.current
    if (nodes.length < 2) return

    const root = nodes[0]
    if (!root) return

    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const adjMap = new Map<string, string[]>()
    edges.forEach(e => {
      if (!adjMap.has(e.source)) adjMap.set(e.source, [])
      adjMap.get(e.source)!.push(e.target)
    })

    const path: string[] = [root.id]
    let cur = root.id
    for (let step = 0; step < 5; step++) {
      const neighbors = adjMap.get(cur) || []
      if (neighbors.length === 0) break
      cur = neighbors[Math.floor(Math.random() * neighbors.length)]
      path.push(cur)
    }

    if (path.length < 2) return

    stateRef.current.pulses.push({
      id: pulseIdCounter++,
      pathNodeIds: path,
      t: 0,
      segIdx: 0,
      speed: 0.02 + Math.random() * 0.015,
      color: COLORS.pink,
      radius: 6,
    })
  }, [])

  // ── Draw rounded card function ─────────────────────────────────────────
  const drawCard = (ctx: CanvasRenderingContext2D, node: GraphNode, isHovered: boolean) => {
    const { x, y, width: w, height: h, color, type } = node
    const r = type === 'session' || type === 'root' ? 12 : 6
    const borderWeight = 1.5

    ctx.fillStyle = COLORS.ink
    ctx.beginPath()
    ctx.roundRect(x - w / 2 + 3, y - h / 2 + 3, w, h, r)
    ctx.fill()

    ctx.fillStyle = color
    ctx.strokeStyle = COLORS.ink
    ctx.lineWidth = isHovered ? 2.5 : borderWeight
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y - h / 2, w, h, r)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = COLORS.ink
    ctx.font = type === 'root' || type === 'session'
      ? 'bold 12px "Bricolage Grotesque", sans-serif'
      : '500 11px "Bricolage Grotesque", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    let displayLabel = node.label
    if (displayLabel.length > 25) {
      displayLabel = displayLabel.slice(0, 22) + '…'
    }
    ctx.fillText(displayLabel, x, y)
  }

  // ── Draw frame ────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const { nodes, edges, pulses, hoveredNodeId, offset, scale } = stateRef.current
    const w = canvas.width, h = canvas.height

    ctx.fillStyle = COLORS.bg
    ctx.fillRect(0, 0, w, h)

    ctx.save()
    ctx.translate(offset.x + w / 2 * (1 - scale), offset.y + h / 2 * (1 - scale))
    ctx.scale(scale, scale)

    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    edges.forEach(edge => {
      const a = nodeMap.get(edge.source)
      const b = nodeMap.get(edge.target)
      if (!a || !b) return
      const isHovered = hoveredNodeId === a.id || hoveredNodeId === b.id

      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = isHovered ? COLORS.purple : COLORS.ink
      ctx.lineWidth = isHovered ? 2 : 1
      ctx.stroke()

      const angle = Math.atan2(b.y - a.y, b.x - a.x)
      const offsetDist = b.height / 2 + 4
      const arrowX = b.x - Math.cos(angle) * offsetDist
      const arrowY = b.y - Math.sin(angle) * offsetDist

      ctx.beginPath()
      ctx.moveTo(arrowX, arrowY)
      ctx.lineTo(arrowX - 8 * Math.cos(angle - Math.PI / 6), arrowY - 8 * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(arrowX - 8 * Math.cos(angle + Math.PI / 6), arrowY - 8 * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fillStyle = isHovered ? COLORS.purple : COLORS.ink
      ctx.fill()
    })

    stateRef.current.pulses = pulses.filter(p => p.segIdx < p.pathNodeIds.length - 1)
    pulses.forEach(p => {
      const srcNode = nodeMap.get(p.pathNodeIds[p.segIdx])
      const dstNode = nodeMap.get(p.pathNodeIds[p.segIdx + 1])
      if (!srcNode || !dstNode) { p.segIdx++; p.t = 0; return }

      const px = srcNode.x + (dstNode.x - srcNode.x) * p.t
      const py = srcNode.y + (dstNode.y - srcNode.y) * p.t

      ctx.beginPath()
      ctx.arc(px, py, p.radius, 0, Math.PI * 2)
      ctx.fillStyle = p.color
      ctx.strokeStyle = COLORS.ink
      ctx.lineWidth = 1.5
      ctx.fill()
      ctx.stroke()

      p.t += p.speed
      if (p.t >= 1) {
        p.t = 0
        p.segIdx++
      }
    })

    nodes.forEach(node => {
      const isHovered = hoveredNodeId === node.id
      drawCard(ctx, node, isHovered)
    })

    ctx.restore()
  }, [])

  const animate = useCallback(() => {
    simulateTick()
    stateRef.current.pulseTimer++
    if (stateRef.current.pulseTimer > 120) {
      stateRef.current.pulseTimer = 0
      spawnPulse()
    }
    draw()
    stateRef.current.animFrame = requestAnimationFrame(animate)
  }, [simulateTick, spawnPulse, draw])

  const canvasToWorld = (cx: number, cy: number, canvas: HTMLCanvasElement) => {
    const { offset, scale } = stateRef.current
    const w = canvas.width, h = canvas.height
    return {
      x: (cx - offset.x - w / 2 * (1 - scale)) / scale,
      y: (cy - offset.y - h / 2 * (1 - scale)) / scale,
    }
  }

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height)

    if (stateRef.current.dragging) {
      stateRef.current.offset.x = stateRef.current.offsetStart.x + (e.clientX - stateRef.current.dragStart.x)
      stateRef.current.offset.y = stateRef.current.offsetStart.y + (e.clientY - stateRef.current.dragStart.y)
      return
    }

    const { x: wx, y: wy } = canvasToWorld(cx, cy, canvas)
    let hit: GraphNode | null = null
    for (const node of stateRef.current.nodes) {
      if (Math.abs(wx - node.x) <= node.width / 2 && Math.abs(wy - node.y) <= node.height / 2) {
        hit = node
        break
      }
    }
    stateRef.current.hoveredNodeId = hit?.id ?? null

    if (hit) {
      canvas.style.cursor = 'pointer'
      let sub = ''
      if (hit.type === 'session') sub = 'Click to switch chat view'
      else if (hit.type === 'user-msg') sub = hit.msgContent || ''
      else if (hit.type === 'ai-msg') sub = hit.msgContent || ''
      else if (hit.type === 'Paper') sub = 'Research paper node'
      else if (hit.type === 'Author') sub = 'Author node'
      else if (hit.type === 'Topic') sub = 'Grounding Topic'

      stateRef.current.tooltip = {
        x: e.clientX,
        y: e.clientY - 12,
        label: hit.label,
        sub,
      }
    } else {
      canvas.style.cursor = stateRef.current.dragging ? 'grabbing' : 'grab'
      stateRef.current.tooltip = null
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    stateRef.current.dragging = true
    stateRef.current.dragStart = { x: e.clientX, y: e.clientY }
    stateRef.current.offsetStart = { ...stateRef.current.offset }
  }, [])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    stateRef.current.dragging = false
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width)
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height)
    const { x: wx, y: wy } = canvasToWorld(cx, cy, canvas)
    
    let hit: GraphNode | null = null
    for (const node of stateRef.current.nodes) {
      if (Math.abs(wx - node.x) <= node.width / 2 && Math.abs(wy - node.y) <= node.height / 2) {
        hit = node
        break
      }
    }

    if (hit?.type === 'session' && hit.sessionId) {
      onSelectSession(hit.sessionId)
    }
  }, [onSelectSession])

  const handleMouseLeave = useCallback(() => {
    stateRef.current.dragging = false
    stateRef.current.hoveredNodeId = null
    stateRef.current.tooltip = null
  }, [])

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.91
    stateRef.current.scale = Math.min(3, Math.max(0.3, stateRef.current.scale * factor))
  }, [])

  const resetView = () => {
    stateRef.current.offset = { x: 0, y: 0 }
    stateRef.current.scale = 1
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      buildGraph(canvas.width, canvas.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    stateRef.current.animFrame = requestAnimationFrame(animate)
    return () => { ro.disconnect(); cancelAnimationFrame(stateRef.current.animFrame) }
  }, [animate, buildGraph])

  const tooltip = stateRef.current.tooltip

  return (
    <div className="visualizer-container" id="visualizer-container" style={{ background: COLORS.bg }}>
      <div className="visualizer-toolbar" style={{ background: COLORS.bg, border: '1.5px solid ' + COLORS.ink }}>
        <span className="vis-toolbar-title" style={{ color: COLORS.ink }}>
          Visualize
        </span>
        <div style={{display: 'flex', gap: 4, marginRight: 8}}>
          <button 
            className={`vis-toolbar-btn ${viewMode === 'session' ? 'active' : ''}`}
            onClick={() => setViewMode('session')}
          >
            Session Flow
          </button>
          <button 
            className={`vis-toolbar-btn ${viewMode === 'global' ? 'active' : ''}`}
            onClick={() => setViewMode('global')}
          >
            Global Graph
          </button>
        </div>
        <div style={{display: 'flex', gap: 4, marginRight: 12}}>
          {['All', 'Papers', 'Authors', 'Topics'].map(f => (
            <button 
              key={f}
              className={`vis-toolbar-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f as any)}
            >
              {f}
            </button>
          ))}
        </div>
        <button className="vis-toolbar-btn" onClick={resetView} id="vis-reset-btn" title="Reset view">
          ⊙ Reset
        </button>
        <button className="vis-toolbar-btn" onClick={() => spawnPulse()} id="vis-pulse-btn" title="Fire a pulse">
          ⚡ Fire
        </button>
      </div>

      <canvas
        ref={canvasRef}
        className="visualizer-canvas"
        id="visualizer-canvas"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      />

      {tooltip && (
        <div
          className="visualizer-tooltip"
          style={{ 
            left: tooltip.x + 14, 
            top: tooltip.y,
            background: COLORS.bg,
            border: '1.5px solid ' + COLORS.ink,
            color: COLORS.ink,
            boxShadow: '3px 3px 0 ' + COLORS.ink
          }}
        >
          <div className="vis-tooltip-label" style={{ color: COLORS.ink }}>{tooltip.label}</div>
          {tooltip.sub && <div className="vis-tooltip-sub" style={{ color: COLORS.ink, opacity: 0.7 }}>{tooltip.sub}</div>}
        </div>
      )}

      {/* Legend */}
      <div className="visualizer-legend" id="visualizer-legend" style={{ background: COLORS.bg, border: '1.5px solid ' + COLORS.ink, boxShadow: '3px 3px 0 ' + COLORS.ink }}>
        <div className="vis-legend-title" style={{ color: COLORS.ink }}>Flowchart Nodes</div>
        <LegendItem color={COLORS.purple} shape="pill" label="Session Node" />
        <LegendItem color={COLORS.blue} shape="pill" label="User Msg" />
        <LegendItem color={COLORS.green} shape="pill" label="AI Msg" />
        <LegendItem color={COLORS.paper} shape="rect" label="Paper (Neo4j)" />
        <LegendItem color={COLORS.orange} shape="pill" label="Topic (Neo4j)" />
      </div>

      {/* Empty state */}
      {viewMode === 'session' && (!activeSessionId || sessions.filter(s => s.id === activeSessionId).length === 0) && (
        <div className="visualizer-empty">
          <div className="vis-empty-icon">🧠</div>
          <div className="vis-empty-title" style={{ color: COLORS.ink }}>No Session Selected</div>
          <div className="vis-empty-sub" style={{ color: COLORS.ink }}>Switch to a session or chat to populate.</div>
        </div>
      )}
    </div>
  )
}

function LegendItem({ color, shape, label }: { color: string; shape: 'pill' | 'rect'; label: string }) {
  return (
    <div className="vis-legend-item" style={{ color: COLORS.ink }}>
      <div
        className={`vis-legend-dot`}
        style={{ 
          background: color, 
          borderRadius: shape === 'pill' ? '12px' : '4px',
          border: '1.5px solid ' + COLORS.ink,
          boxShadow: '1px 1px 0 ' + COLORS.ink
        }}
      />
      <span>{label}</span>
    </div>
  )
}

function resolveVar(cssVar: string): string {
  const map: Record<string, string> = {
    'var(--color-purple)': '#d9bbfc',
    'var(--color-green)':  '#6dd68d',
    'var(--color-blue)':   '#a8d4ff',
    'var(--color-orange)': '#ffb683',
    'var(--color-pink)':   '#ffaee4',
  }
  return map[cssVar] ?? '#d9bbfc'
}
