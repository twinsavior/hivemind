import React, { useState, useEffect } from 'react';

const THEME = {
  bg: '#0a0a0f',
  bgPanel: '#12121a',
  border: '#1e1e2e',
  text: '#e2e2ef',
  textDim: '#6b6b8a',
  accent: '#6366f1',
  success: '#22c55e',
  warning: '#f59e0b',
  cyan: '#06b6d4',
} as const;

interface MemoryItem {
  id: string;
  namespace: string;
  title: string;
  content: string;
  level: number;
  parentId: string | null;
  tokenCount: number;
  source: string;
  updatedAt: string;
}

const LEVEL_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'L0 Summary', color: '#22c55e' },
  1: { label: 'L1 Overview', color: '#f59e0b' },
  2: { label: 'L2 Full', color: '#6366f1' },
};

export function SharedMemory() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/memory')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        setMemories(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        // Demo data
        setMemories([
          { id: '1', namespace: 'project', title: 'HIVEMIND Architecture', content: 'TypeScript + Rust WASM core with 5 agent types...', level: 0, parentId: null, tokenCount: 128, source: 'system', updatedAt: new Date().toISOString() },
          { id: '2', namespace: 'project', title: 'HIVEMIND Architecture (overview)', content: 'The system consists of: Orchestrator (task routing), Agents (cognitive loops), Skills (Markdown-based), Memory (SQLite + vector), Dashboard (React + Three.js)...', level: 1, parentId: '1', tokenCount: 512, source: 'system', updatedAt: new Date().toISOString() },
          { id: '3', namespace: 'research', title: 'GitHub Virality Patterns', content: 'Key factors: one-command setup, visual wow factor, README engineering...', level: 0, parentId: null, tokenCount: 96, source: 'scout-1', updatedAt: new Date().toISOString() },
          { id: '4', namespace: 'tasks', title: 'Delegation System Implementation', content: 'Added delegate(), sendMessage(), receiveMessage() to BaseAgent. Orchestrator routes by role.', level: 0, parentId: null, tokenCount: 64, source: 'builder-1', updatedAt: new Date().toISOString() },
          { id: '5', namespace: 'sessions', title: 'Scout Alpha Session Context', content: 'Last research: competitor analysis of multi-agent frameworks. 3 sources found...', level: 2, parentId: null, tokenCount: 2048, source: 'scout-1', updatedAt: new Date().toISOString() },
        ]);
        setLoading(false);
      });
  }, []);

  const filtered = memories.filter((m) => {
    const matchesSearch = !search ||
      m.title.toLowerCase().includes(search.toLowerCase()) ||
      m.content.toLowerCase().includes(search.toLowerCase()) ||
      m.namespace.toLowerCase().includes(search.toLowerCase());
    const matchesLevel = levelFilter === null || m.level === levelFilter;
    return matchesSearch && matchesLevel;
  });

  const namespaces = [...new Set(memories.map((m) => m.namespace))];
  const totalTokens = memories.reduce((sum, m) => sum + m.tokenCount, 0);

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left: Memory list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Search & filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 14px',
              background: THEME.bg,
              border: `1px solid ${THEME.border}`,
              borderRadius: 8,
              color: THEME.text,
              fontSize: 13,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {[null, 0, 1, 2].map((level) => {
              const info = level !== null ? LEVEL_LABELS[level] : { label: 'All', color: THEME.text };
              return (
                <button
                  key={level ?? 'all'}
                  onClick={() => setLevelFilter(level)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 6,
                    border: `1px solid ${levelFilter === level ? info.color : THEME.border}`,
                    background: levelFilter === level ? `${info.color}15` : 'transparent',
                    color: levelFilter === level ? info.color : THEME.textDim,
                    fontSize: 10,
                    cursor: 'pointer',
                    fontWeight: levelFilter === level ? 600 : 400,
                  }}
                >
                  {info.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 20, fontSize: 11, color: THEME.textDim }}>
          <span>{memories.length} entries</span>
          <span>{namespaces.length} namespaces</span>
          <span>{totalTokens.toLocaleString()} tokens</span>
        </div>

        {/* Memory list */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {loading ? (
            <div style={{ color: THEME.textDim, textAlign: 'center', padding: 40 }}>Loading memory store...</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: THEME.textDim, textAlign: 'center', padding: 40 }}>No memories found</div>
          ) : (
            filtered.map((m) => {
              const levelInfo = LEVEL_LABELS[m.level] ?? { label: `L${m.level}`, color: THEME.textDim };
              return (
                <div
                  key={m.id}
                  onClick={() => setSelected(m)}
                  style={{
                    padding: 12,
                    background: selected?.id === m.id ? `${THEME.accent}10` : THEME.bgPanel,
                    border: `1px solid ${selected?.id === m.id ? THEME.accent : THEME.border}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 0.1s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 12 }}>{m.title}</span>
                    <span style={{ fontSize: 9, color: levelInfo.color, padding: '1px 6px', borderRadius: 4, background: `${levelInfo.color}15` }}>
                      {levelInfo.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: THEME.textDim, display: 'flex', gap: 12 }}>
                    <span>{m.namespace}</span>
                    <span>{m.tokenCount} tokens</span>
                    <span>{m.source}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Detail panel */}
      <div
        style={{
          width: 380,
          minWidth: 380,
          background: THEME.bgPanel,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'auto',
        }}
      >
        {selected ? (
          <>
            <h3 style={{ margin: 0, fontSize: 14 }}>{selected.title}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: THEME.bg, color: THEME.textDim }}>{selected.namespace}</span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: `${(LEVEL_LABELS[selected.level]?.color ?? THEME.textDim)}15`, color: LEVEL_LABELS[selected.level]?.color ?? THEME.textDim }}>
                {LEVEL_LABELS[selected.level]?.label ?? `L${selected.level}`}
              </span>
              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: THEME.bg, color: THEME.textDim }}>{selected.tokenCount} tokens</span>
            </div>
            <div style={{ fontSize: 10, color: THEME.textDim }}>
              Source: {selected.source} &middot; Updated: {new Date(selected.updatedAt).toLocaleString()}
            </div>
            <div
              style={{
                flex: 1,
                padding: 14,
                background: THEME.bg,
                borderRadius: 8,
                fontSize: 12,
                lineHeight: 1.6,
                color: THEME.text,
                whiteSpace: 'pre-wrap',
                overflow: 'auto',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              }}
            >
              {selected.content}
            </div>
            {selected.parentId && (
              <div style={{ fontSize: 10, color: THEME.textDim }}>
                Parent: {selected.parentId}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: THEME.textDim, fontSize: 12 }}>
            Select a memory entry to view details
          </div>
        )}
      </div>
    </div>
  );
}
