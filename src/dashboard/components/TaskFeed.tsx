import React, { useState, useRef, useEffect } from 'react';
import { useSwarm } from '../app';
import type { AgentInfo, TaskEvent } from '../server';

// ─── Constants ───────────────────────────────────────────────────────────────

const THEME = {
  bg: '#0a0a0f',
  bgPanel: '#12121a',
  border: '#1e1e2e',
  text: '#e2e2ef',
  textDim: '#6b6b8a',
  accent: '#6366f1',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  cyan: '#06b6d4',
};

const TYPE_COLORS: Record<AgentInfo['type'], string> = {
  orchestrator: '#a855f7',
  worker: '#6366f1',
  specialist: '#06b6d4',
  sentinel: '#f59e0b',
};

const STATUS_ICONS: Record<TaskEvent['status'], { symbol: string; color: string }> = {
  started: { symbol: '\u25B6', color: THEME.accent },
  completed: { symbol: '\u2713', color: THEME.success },
  failed: { symbol: '\u2717', color: THEME.error },
  delegated: { symbol: '\u21BB', color: THEME.warning },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

// ─── Feed Item ───────────────────────────────────────────────────────────────

function FeedItem({ event, expanded, onToggle }: { event: TaskEvent; expanded: boolean; onToggle: () => void }) {
  const statusInfo = STATUS_ICONS[event.status];
  const typeColor = TYPE_COLORS[event.agentType];

  return (
    <div
      onClick={onToggle}
      style={{
        padding: '10px 14px',
        borderBottom: `1px solid ${THEME.border}`,
        cursor: 'pointer',
        transition: 'background 0.15s ease',
        background: expanded ? `${THEME.accent}08` : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!expanded) e.currentTarget.style.background = `${THEME.accent}05`;
      }}
      onMouseLeave={(e) => {
        if (!expanded) e.currentTarget.style.background = 'transparent';
      }}
    >
      {/* Header Row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Status icon */}
        <span
          style={{
            fontSize: 10,
            color: statusInfo.color,
            width: 16,
            textAlign: 'center',
            flexShrink: 0,
          }}
        >
          {statusInfo.symbol}
        </span>

        {/* Agent badge */}
        <span
          style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 4,
            background: `${typeColor}18`,
            color: typeColor,
            fontWeight: 600,
            letterSpacing: '0.04em',
            flexShrink: 0,
          }}
        >
          {event.agentName}
        </span>

        {/* Action text */}
        <span
          style={{
            fontSize: 12,
            color: THEME.text,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {event.action}
        </span>

        {/* Duration */}
        {event.duration && (
          <span style={{ fontSize: 10, color: THEME.textDim, flexShrink: 0 }}>
            {formatDuration(event.duration)}
          </span>
        )}

        {/* Time */}
        <span style={{ fontSize: 10, color: THEME.textDim, flexShrink: 0, width: 48, textAlign: 'right' }}>
          {timeAgo(event.timestamp)}
        </span>
      </div>

      {/* Expanded Details */}
      {expanded && (
        <div
          style={{
            marginTop: 10,
            padding: '10px 12px',
            background: THEME.bg,
            borderRadius: 6,
            border: `1px solid ${THEME.border}`,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '6px 12px', fontSize: 11 }}>
            <span style={{ color: THEME.textDim }}>Task ID</span>
            <span style={{ color: THEME.text, fontFamily: 'monospace', fontSize: 10 }}>{event.id}</span>
            <span style={{ color: THEME.textDim }}>Agent</span>
            <span style={{ color: THEME.text }}>
              {event.agentName}{' '}
              <span style={{ color: THEME.textDim }}>({event.agentType})</span>
            </span>
            <span style={{ color: THEME.textDim }}>Status</span>
            <span style={{ color: statusInfo.color, fontWeight: 600 }}>{event.status.toUpperCase()}</span>
            <span style={{ color: THEME.textDim }}>Detail</span>
            <span style={{ color: THEME.text, lineHeight: 1.4 }}>{event.detail}</span>
            {event.duration && (
              <>
                <span style={{ color: THEME.textDim }}>Duration</span>
                <span style={{ color: THEME.text }}>{formatDuration(event.duration)}</span>
              </>
            )}
            <span style={{ color: THEME.textDim }}>Timestamp</span>
            <span style={{ color: THEME.text, fontFamily: 'monospace', fontSize: 10 }}>
              {new Date(event.timestamp).toISOString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskFeed() {
  const { taskEvents } = useSwarm();
  const [filter, setFilter] = useState<AgentInfo['type'] | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = 0; // newest on top
    }
  }, [taskEvents.length, autoScroll]);

  const filteredEvents = filter === 'all'
    ? taskEvents
    : taskEvents.filter((e) => e.agentType === filter);

  // Show newest first
  const sortedEvents = [...filteredEvents].reverse();

  const filters: { id: AgentInfo['type'] | 'all'; label: string; color: string }[] = [
    { id: 'all', label: 'All', color: THEME.text },
    { id: 'orchestrator', label: 'Orchestrators', color: '#a855f7' },
    { id: 'worker', label: 'Workers', color: '#6366f1' },
    { id: 'specialist', label: 'Specialists', color: '#06b6d4' },
    { id: 'sentinel', label: 'Sentinels', color: '#f59e0b' },
  ];

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px 10px',
          borderBottom: `1px solid ${THEME.border}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 11, color: THEME.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Live Task Feed
          </span>

          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: THEME.success }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: THEME.success,
                display: 'inline-block',
                animation: 'pulse 2s infinite',
              }}
            />
            LIVE
          </div>
        </div>

        {/* Filter Tabs */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                border: 'none',
                outline: 'none',
                cursor: 'pointer',
                fontSize: 10,
                padding: '4px 10px',
                borderRadius: 12,
                fontWeight: filter === f.id ? 600 : 400,
                background: filter === f.id ? `${f.color}20` : 'transparent',
                color: filter === f.id ? f.color : THEME.textDim,
                transition: 'all 0.15s ease',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Feed List */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
        }}
      >
        {sortedEvents.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: 'center',
              color: THEME.textDim,
              fontSize: 12,
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>{'\u29BE'}</div>
            Waiting for agent activity...
          </div>
        ) : (
          sortedEvents.map((event) => (
            <FeedItem
              key={event.id}
              event={event}
              expanded={expandedId === event.id}
              onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
            />
          ))
        )}
      </div>

      {/* Footer Stats */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: `1px solid ${THEME.border}`,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10,
          color: THEME.textDim,
        }}
      >
        <span>{sortedEvents.length} events</span>
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          style={{
            border: 'none',
            outline: 'none',
            cursor: 'pointer',
            background: 'none',
            fontSize: 10,
            color: autoScroll ? THEME.success : THEME.textDim,
          }}
        >
          {autoScroll ? 'Auto-scroll ON' : 'Auto-scroll OFF'}
        </button>
      </div>

      {/* CSS animation for the live pulse dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
