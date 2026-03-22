import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useSwarm } from '../app';
import type { SwarmGraphState, SwarmNode, SwarmEdge } from '../server';

// ─── Constants ───────────────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  scout: '#3b82f6',       // Blue
  builder: '#22c55e',     // Green
  sentinel: '#ef4444',    // Red
  oracle: '#a855f7',      // Purple
  courier: '#f97316',     // Orange
  orchestrator: '#6366f1', // Indigo
  worker: '#06b6d4',      // Cyan
};

const EDGE_COLORS: Record<string, string> = {
  delegation: '#f59e0b',
  message: '#6366f1',
  assignment: '#06b6d4',
  result: '#22c55e',
};

const THEME = {
  bg: '#0a0a0f',
  bgPanel: '#12121a',
  border: '#1e1e2e',
  text: '#e2e2ef',
  textDim: '#6b6b8a',
  textMuted: '#44445a',
} as const;

// ─── Force Simulation (no D3) ────────────────────────────────────────────────

interface SimNode extends SwarmNode {
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

function initSimNode(node: SwarmNode, width: number, height: number, existing?: SimNode): SimNode {
  return {
    ...node,
    x: existing?.x ?? (width / 2 + (Math.random() - 0.5) * width * 0.4),
    y: existing?.y ?? (height / 2 + (Math.random() - 0.5) * height * 0.4),
    vx: existing?.vx ?? 0,
    vy: existing?.vy ?? 0,
    fx: existing?.fx,
    fy: existing?.fy,
  };
}

function tickSimulation(
  nodes: SimNode[],
  edges: SwarmEdge[],
  width: number,
  height: number,
): void {
  const alpha = 0.3;
  const friction = 0.85;
  const centerX = width / 2;
  const centerY = height / 2;

  // Build adjacency for spring force
  const edgeSet = new Set<string>();
  for (const e of edges) {
    edgeSet.add(`${e.source}:${e.target}`);
    edgeSet.add(`${e.target}:${e.source}`);
  }

  // --- Charge repulsion (all nodes repel) ---
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      let dx = (b.x ?? 0) - (a.x ?? 0);
      let dy = (b.y ?? 0) - (a.y ?? 0);
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minDist = a.type === 'task' || b.type === 'task' ? 60 : 100;
      const repulsion = a.type === 'task' || b.type === 'task' ? -300 : -600;
      const force = (repulsion * alpha) / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;

      // Collision avoidance
      if (dist < minDist) {
        const overlap = (minDist - dist) / 2;
        const cx = (dx / dist) * overlap;
        const cy = (dy / dist) * overlap;
        a.vx -= cx * 0.5;
        a.vy -= cy * 0.5;
        b.vx += cx * 0.5;
        b.vy += cy * 0.5;
      }
    }
  }

  // --- Spring attraction (connected nodes) ---
  const nodeMap = new Map<string, SimNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  for (const edge of edges) {
    const a = nodeMap.get(edge.source);
    const b = nodeMap.get(edge.target);
    if (!a || !b) continue;

    let dx = (b.x ?? 0) - (a.x ?? 0);
    let dy = (b.y ?? 0) - (a.y ?? 0);
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const idealDist = b.type === 'task' || a.type === 'task' ? 80 : 120;
    const strength = 0.05 * alpha;
    const force = (dist - idealDist) * strength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // --- Center gravity ---
  for (const node of nodes) {
    const dx = centerX - (node.x ?? 0);
    const dy = centerY - (node.y ?? 0);
    node.vx += dx * 0.005 * alpha;
    node.vy += dy * 0.005 * alpha;
  }

  // --- Apply velocity with friction ---
  for (const node of nodes) {
    if (node.fx != null) {
      node.x = node.fx;
      node.vx = 0;
    } else {
      node.vx *= friction;
      node.x = (node.x ?? centerX) + node.vx;
    }
    if (node.fy != null) {
      node.y = node.fy;
      node.vy = 0;
    } else {
      node.vy *= friction;
      node.y = (node.y ?? centerY) + node.vy;
    }

    // Keep within bounds (with padding)
    const pad = 40;
    node.x = Math.max(pad, Math.min(width - pad, node.x ?? centerX));
    node.y = Math.max(pad, Math.min(height - pad, node.y ?? centerY));
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SwarmVisualization() {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const edgesRef = useRef<SwarmEdge[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ width: 800, height: 500 });
  const [, forceRender] = useState(0);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const { connected } = useSwarm();

  // ─── WebSocket listener for swarm graph data ─────────────────────────────

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onmessage = (event) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'swarm:graph') {
        const state = msg.payload as SwarmGraphState;
        updateNodes(state.nodes);
        edgesRef.current = state.edges;
      } else if (msg.type === 'swarm:node:update') {
        const node = msg.payload as SwarmNode;
        const existing = nodesRef.current.find((n) => n.id === node.id);
        if (existing) {
          Object.assign(existing, node, { x: existing.x, y: existing.y, vx: existing.vx, vy: existing.vy });
        } else {
          const { width, height } = sizeRef.current;
          nodesRef.current.push(initSimNode(node, width, height));
        }
      } else if (msg.type === 'swarm:edge:add') {
        const edge = msg.payload as SwarmEdge;
        // Replace if same ID exists, otherwise add
        const idx = edgesRef.current.findIndex((e) => e.id === edge.id);
        if (idx >= 0) {
          edgesRef.current[idx] = edge;
        } else {
          edgesRef.current.push(edge);
        }
      } else if (msg.type === 'swarm:edge:remove') {
        edgesRef.current = edgesRef.current.filter((e) => e.id !== msg.payload.id);
      }
    };

    return () => ws.close();
  }, []);

  const updateNodes = useCallback((incoming: SwarmNode[]) => {
    const { width, height } = sizeRef.current;
    const existingMap = new Map<string, SimNode>();
    for (const n of nodesRef.current) existingMap.set(n.id, n);

    const newNodes: SimNode[] = incoming.map((n) =>
      initSimNode(n, width, height, existingMap.get(n.id)),
    );
    nodesRef.current = newNodes;
  }, []);

  // ─── Animation loop ──────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        sizeRef.current = { width, height };
      }
    });
    resizeObserver.observe(container);

    let frameCount = 0;
    const animate = () => {
      const { width, height } = sizeRef.current;
      tickSimulation(nodesRef.current, edgesRef.current, width, height);
      frameCount++;
      // Re-render React every 2 frames for performance
      if (frameCount % 2 === 0) {
        forceRender((c) => c + 1);
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
    };
  }, []);

  // ─── Drag handlers ───────────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    const node = nodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    dragRef.current = {
      nodeId,
      offsetX: (e.nativeEvent.offsetX || e.clientX) - (node.x ?? 0),
      offsetY: (e.nativeEvent.offsetY || e.clientY) - (node.y ?? 0),
    };
    node.fx = node.x;
    node.fy = node.y;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });

    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) {
        node.fx = mx - dragRef.current.offsetX;
        node.fy = my - dragRef.current.offsetY;
        node.x = node.fx;
        node.y = node.fy;
      }
    }
  }, []);

  const onMouseUp = useCallback(() => {
    if (dragRef.current) {
      const node = nodesRef.current.find((n) => n.id === dragRef.current!.nodeId);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      dragRef.current = null;
    }
  }, []);

  // ─── Render ──────────────────────────────────────────────────────────────

  const { width, height } = sizeRef.current;
  const nodes = nodesRef.current;
  const edges = edgesRef.current;

  // Build a quick lookup for node positions
  const posMap = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    posMap.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        position: 'relative',
        background: 'radial-gradient(ellipse at center, #12121a 0%, #0a0a0f 100%)',
        overflow: 'hidden',
        borderRadius: 12,
      }}
    >
      {/* Title */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          fontSize: 11,
          color: THEME.textDim,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        Swarm Orchestration
      </div>

      {/* Agent count badge */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 16,
          fontSize: 10,
          color: THEME.textMuted,
          background: `${THEME.border}80`,
          padding: '3px 10px',
          borderRadius: 8,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        {nodes.filter((n) => n.type === 'agent').length} agents &middot;{' '}
        {nodes.filter((n) => n.type === 'task').length} tasks &middot;{' '}
        {edges.filter((e) => e.active).length} active flows
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        style={{ width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'default' }}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          {/* Glow filter for active nodes */}
          <filter id="swarm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Stronger glow for active edges */}
          <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Pulse animation for active agents */}
          <radialGradient id="pulse-gradient">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>

          {/* Per-role gradients */}
          {Object.entries(ROLE_COLORS).map(([role, color]) => (
            <radialGradient key={role} id={`grad-${role}`} cx="35%" cy="35%">
              <stop offset="0%" stopColor={color} stopOpacity="0.9" />
              <stop offset="70%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0.05" />
            </radialGradient>
          ))}

          {/* Task node gradient */}
          <radialGradient id="grad-task" cx="35%" cy="35%">
            <stop offset="0%" stopColor="#6b6b8a" stopOpacity="0.6" />
            <stop offset="100%" stopColor="#6b6b8a" stopOpacity="0.05" />
          </radialGradient>

          {/* Animated dash for active edges */}
          <style>{`
            @keyframes dash-flow {
              to { stroke-dashoffset: -20; }
            }
            @keyframes pulse-ring {
              0% { r: 16; opacity: 0.5; }
              100% { r: 28; opacity: 0; }
            }
            .edge-active {
              animation: dash-flow 0.8s linear infinite;
            }
            .pulse-ring {
              animation: pulse-ring 2s ease-out infinite;
            }
          `}</style>
        </defs>

        {/* Grid pattern background */}
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={THEME.border} strokeWidth="0.3" strokeOpacity="0.3" />
        </pattern>
        <rect width={width} height={height} fill="url(#grid)" />

        {/* Edges */}
        {edges.map((edge) => {
          const src = posMap.get(edge.source);
          const tgt = posMap.get(edge.target);
          if (!src || !tgt) return null;

          const color = EDGE_COLORS[edge.type] || '#6b6b8a';
          const isActive = edge.active;

          return (
            <g key={edge.id}>
              {/* Edge glow (background) */}
              {isActive && (
                <line
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke={color}
                  strokeWidth={4}
                  strokeOpacity={0.15}
                  filter="url(#edge-glow)"
                />
              )}
              {/* Main edge line */}
              <line
                x1={src.x}
                y1={src.y}
                x2={tgt.x}
                y2={tgt.y}
                stroke={color}
                strokeWidth={isActive ? 2 : 1}
                strokeOpacity={isActive ? 0.7 : 0.2}
                strokeDasharray={isActive ? '6 4' : 'none'}
                className={isActive ? 'edge-active' : undefined}
              />
              {/* Edge label */}
              {edge.label && isActive && (
                <text
                  x={(src.x + tgt.x) / 2}
                  y={(src.y + tgt.y) / 2 - 6}
                  textAnchor="middle"
                  fill={color}
                  fontSize={8}
                  fontFamily="Inter, sans-serif"
                  opacity={0.7}
                >
                  {edge.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          const isAgent = node.type === 'agent';
          const isActive = node.state === 'active' || node.state === 'running';
          const isFailed = node.state === 'failed' || node.state === 'error';
          const radius = isAgent ? 16 : 8;
          const color = isAgent
            ? ROLE_COLORS[node.role || 'worker'] || '#6b6b8a'
            : node.state === 'completed'
              ? '#22c55e'
              : node.state === 'failed'
                ? '#ef4444'
                : '#6b6b8a';

          const gradientId = isAgent ? `grad-${node.role || 'worker'}` : 'grad-task';

          return (
            <g
              key={node.id}
              transform={`translate(${x}, ${y})`}
              style={{ cursor: 'grab' }}
              onMouseDown={(e) => onMouseDown(e, node.id)}
              onMouseEnter={() => setHoveredNode(node as SimNode)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              {/* Pulse ring for active agents */}
              {isActive && isAgent && (
                <circle
                  r={16}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={0.5}
                  className="pulse-ring"
                />
              )}

              {/* Outer glow ring */}
              {isActive && (
                <circle
                  r={radius + 6}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeOpacity={0.3}
                  filter="url(#swarm-glow)"
                />
              )}

              {/* Main filled circle */}
              <circle
                r={radius}
                fill={`url(#${gradientId})`}
                stroke={isFailed ? '#ef4444' : color}
                strokeWidth={isAgent ? 2 : 1.5}
                strokeOpacity={isActive ? 0.9 : 0.5}
              />

              {/* Inner bright core */}
              <circle
                r={isAgent ? radius * 0.35 : radius * 0.4}
                fill={color}
                opacity={isActive ? 0.95 : 0.4}
              />

              {/* Role icon (first letter) */}
              {isAgent && (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#fff"
                  fontSize={9}
                  fontWeight={700}
                  fontFamily="Inter, sans-serif"
                  opacity={0.85}
                  style={{ pointerEvents: 'none' }}
                >
                  {(node.role || 'A')[0]!.toUpperCase()}
                </text>
              )}

              {/* Label */}
              <text
                y={radius + 14}
                textAnchor="middle"
                fill={THEME.textDim}
                fontSize={isAgent ? 9 : 7}
                fontFamily="Inter, sans-serif"
                style={{ pointerEvents: 'none' }}
              >
                {node.label.length > 20 ? node.label.slice(0, 18) + '...' : node.label}
              </text>

              {/* State badge */}
              {isAgent && (
                <text
                  y={radius + 23}
                  textAnchor="middle"
                  fill={isActive ? '#22c55e' : isFailed ? '#ef4444' : THEME.textMuted}
                  fontSize={7}
                  fontFamily="Inter, sans-serif"
                  style={{ pointerEvents: 'none' }}
                >
                  {node.state}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hoveredNode && hoveredNode.type === 'agent' && (
        <div
          style={{
            position: 'absolute',
            left: mousePos.x + 16,
            top: mousePos.y - 10,
            background: '#1a1a2e',
            border: `1px solid ${THEME.border}`,
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 11,
            color: THEME.text,
            pointerEvents: 'none',
            zIndex: 10,
            minWidth: 160,
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6, color: ROLE_COLORS[hoveredNode.role || 'worker'] }}>
            {hoveredNode.label}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>
              <span style={{ color: THEME.textDim }}>Role:</span>{' '}
              {hoveredNode.role || 'unknown'}
            </span>
            <span>
              <span style={{ color: THEME.textDim }}>State:</span>{' '}
              <span style={{ color: hoveredNode.state === 'active' ? '#22c55e' : THEME.textDim }}>
                {hoveredNode.state}
              </span>
            </span>
            {hoveredNode.metrics && (
              <>
                <span>
                  <span style={{ color: THEME.textDim }}>Tasks:</span>{' '}
                  {hoveredNode.metrics.tasksCompleted}
                </span>
                <span>
                  <span style={{ color: THEME.textDim }}>Success:</span>{' '}
                  {(hoveredNode.metrics.successRate * 100).toFixed(0)}%
                </span>
                {hoveredNode.metrics.avgResponseMs > 0 && (
                  <span>
                    <span style={{ color: THEME.textDim }}>Avg Response:</span>{' '}
                    {hoveredNode.metrics.avgResponseMs.toFixed(0)}ms
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: 16,
          display: 'flex',
          gap: 12,
          fontSize: 9,
          color: THEME.textDim,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        {Object.entries(ROLE_COLORS).map(([role, color]) => (
          <div key={role} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
                boxShadow: `0 0 4px ${color}60`,
              }}
            />
            {role}
          </div>
        ))}
      </div>

      {/* Edge type legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          right: 16,
          display: 'flex',
          gap: 12,
          fontSize: 9,
          color: THEME.textMuted,
          zIndex: 2,
          pointerEvents: 'none',
        }}
      >
        {Object.entries(EDGE_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 12,
                height: 2,
                background: color,
                display: 'inline-block',
                borderRadius: 1,
              }}
            />
            {type}
          </div>
        ))}
      </div>
    </div>
  );
}
