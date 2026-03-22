import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobeView } from './components/GlobeView';
import { AgentGraph } from './components/AgentGraph';
import { SwarmStatus } from './components/SwarmStatus';
import { TaskFeed } from './components/TaskFeed';
import { SkillsLibrary } from './components/SkillsLibrary';
import { SharedMemory } from './components/SharedMemory';
import { SettingsPage } from './components/SettingsPage';
import { SwarmVisualization } from './components/SwarmVisualization';
import type { AgentInfo, SwarmMetrics, TaskEvent, WSMessage } from './server';

// ─── Theme & Styles ──────────────────────────────────────────────────────────

const THEME = {
  bg: '#0a0a0f',
  bgPanel: '#12121a',
  bgSidebar: '#0e0e16',
  border: '#1e1e2e',
  text: '#e2e2ef',
  textDim: '#6b6b8a',
  accent: '#6366f1',
  accentGlow: 'rgba(99, 102, 241, 0.3)',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  cyan: '#06b6d4',
} as const;

const styles = {
  app: {
    display: 'flex',
    height: '100vh',
    width: '100vw',
    background: THEME.bg,
    color: THEME.text,
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    overflow: 'hidden',
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    background: THEME.bgSidebar,
    borderRight: `1px solid ${THEME.border}`,
    display: 'flex',
    flexDirection: 'column' as const,
    padding: '20px 0',
  },
  logo: {
    padding: '0 20px 24px',
    borderBottom: `1px solid ${THEME.border}`,
    marginBottom: 8,
  },
  logoText: {
    fontSize: 20,
    fontWeight: 800,
    letterSpacing: '0.12em',
    background: `linear-gradient(135deg, ${THEME.accent}, ${THEME.cyan})`,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  logoSub: {
    fontSize: 10,
    color: THEME.textDim,
    letterSpacing: '0.2em',
    textTransform: 'uppercase' as const,
    marginTop: 2,
  },
  navItem: (active: boolean) => ({
    display: 'flex',
    alignItems: 'center' as const,
    gap: 10,
    padding: '10px 20px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? THEME.text : THEME.textDim,
    background: active ? THEME.accentGlow : 'transparent',
    borderLeft: `3px solid ${active ? THEME.accent : 'transparent'}`,
    transition: 'all 0.15s ease',
  }),
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  topBar: {
    height: 52,
    minHeight: 52,
    display: 'flex',
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    padding: '0 24px',
    borderBottom: `1px solid ${THEME.border}`,
    background: THEME.bgPanel,
  },
  pageTitle: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.04em',
  },
  connectionDot: (connected: boolean) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: connected ? THEME.success : THEME.error,
    boxShadow: connected ? `0 0 8px ${THEME.success}` : `0 0 8px ${THEME.error}`,
    display: 'inline-block',
    marginRight: 8,
  }),
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 24,
  },
  overviewGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: 'auto auto',
    gap: 20,
    height: '100%',
    minHeight: 600,
  },
  panel: {
    background: THEME.bgPanel,
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    overflow: 'hidden',
  },
} as const;

// ─── WebSocket Context ───────────────────────────────────────────────────────

interface SwarmState {
  agents: Map<string, AgentInfo>;
  metrics: SwarmMetrics;
  taskEvents: TaskEvent[];
  connected: boolean;
}

const defaultMetrics: SwarmMetrics = {
  totalAgents: 0,
  activeAgents: 0,
  activeTasks: 0,
  completedTasks: 0,
  failedTasks: 0,
  totalMemoryMB: 0,
  uptimeSeconds: 0,
  messagesPerSecond: 0,
};

const SwarmContext = createContext<SwarmState>({
  agents: new Map(),
  metrics: defaultMetrics,
  taskEvents: [],
  connected: false,
});

export const useSwarm = () => useContext(SwarmContext);

// ─── Pages ───────────────────────────────────────────────────────────────────

type Page = 'overview' | 'swarm' | 'agents' | 'skills' | 'memory' | 'settings';

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '\u25C8' },
  { id: 'swarm', label: 'Swarm', icon: '\u2B2A' },
  { id: 'agents', label: 'Agents', icon: '\u2B21' },
  { id: 'skills', label: 'Skills', icon: '\u2726' },
  { id: 'memory', label: 'Memory', icon: '\u29BE' },
  { id: 'settings', label: 'Settings', icon: '\u2699' },
];

function OverviewPage() {
  return (
    <div style={styles.overviewGrid}>
      <div style={{ ...styles.panel, gridColumn: '1 / 2', gridRow: '1 / 2' }}>
        <GlobeView />
      </div>
      <div style={{ ...styles.panel, gridColumn: '2 / 3', gridRow: '1 / 3' }}>
        <TaskFeed />
      </div>
      <div style={{ ...styles.panel, gridColumn: '1 / 2', gridRow: '2 / 3' }}>
        <SwarmStatus />
      </div>
    </div>
  );
}

function SwarmPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ ...styles.panel, flex: 1, minHeight: 500 }}>
        <SwarmVisualization />
      </div>
    </div>
  );
}

function AgentsPage() {
  const { agents } = useSwarm();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <div style={{ ...styles.panel, flex: 1, minHeight: 400 }}>
        <AgentGraph />
      </div>
      <div style={{ ...styles.panel, padding: 20 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: 14, color: THEME.textDim }}>
          ACTIVE AGENTS ({agents.size})
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {Array.from(agents.values()).map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentInfo }) {
  const statusColor = {
    active: THEME.success,
    idle: THEME.textDim,
    error: THEME.error,
    spawning: THEME.warning,
  }[agent.status];

  return (
    <div
      style={{
        background: THEME.bg,
        border: `1px solid ${THEME.border}`,
        borderRadius: 8,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{agent.name}</span>
        <span
          style={{
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 10,
            background: `${statusColor}20`,
            color: statusColor,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}
        >
          {agent.status}
        </span>
      </div>
      <div style={{ fontSize: 11, color: THEME.textDim }}>
        {agent.type} &middot; {agent.tasksCompleted} tasks &middot; {agent.memoryUsageMB.toFixed(0)}MB
      </div>
      {agent.currentTask && (
        <div style={{ fontSize: 11, color: THEME.cyan, fontStyle: 'italic' }}>
          {agent.currentTask}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {agent.skills.slice(0, 4).map((skill) => (
          <span
            key={skill}
            style={{
              fontSize: 9,
              padding: '2px 6px',
              borderRadius: 4,
              background: `${THEME.accent}15`,
              color: THEME.accent,
            }}
          >
            {skill}
          </span>
        ))}
      </div>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div
      style={{
        ...styles.panel,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        fontSize: 14,
        color: THEME.textDim,
      }}
    >
      {title} — Coming Soon
    </div>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function getInitialPage(): Page {
  const hash = window.location.hash.replace('#', '');
  const valid: Page[] = ['overview', 'swarm', 'agents', 'skills', 'memory', 'settings'];
  return valid.includes(hash as Page) ? (hash as Page) : 'overview';
}

function App() {
  const [page, setPage] = useState<Page>(getInitialPage);
  const [swarmState, setSwarmState] = useState<SwarmState>({
    agents: new Map(),
    metrics: defaultMetrics,
    taskEvents: [],
    connected: false,
  });

  // Hash-based routing (for Electron iframe deep-linking)
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '') as Page;
      const valid: Page[] = ['overview', 'swarm', 'agents', 'skills', 'memory', 'settings'];
      if (valid.includes(hash)) setPage(hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Sync hash when page changes via sidebar click
  useEffect(() => {
    window.location.hash = page;
  }, [page]);

  // WebSocket connection
  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onopen = () => {
      setSwarmState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setSwarmState((s) => ({ ...s, connected: false }));
    };

    ws.onmessage = (event) => {
      const msg: WSMessage = JSON.parse(event.data);

      setSwarmState((prev) => {
        const next = { ...prev };

        switch (msg.type) {
          case 'agent:update':
          case 'agent:added': {
            const updated = new Map(prev.agents);
            updated.set(msg.payload.id, msg.payload);
            next.agents = updated;
            break;
          }
          case 'agent:removed': {
            const updated = new Map(prev.agents);
            updated.delete(msg.payload.id);
            next.agents = updated;
            break;
          }
          case 'swarm:metrics':
            next.metrics = msg.payload;
            break;
          case 'task:event':
            next.taskEvents = [...prev.taskEvents.slice(-199), msg.payload];
            break;
        }

        return next;
      });
    };

    return () => ws.close();
  }, []);

  const renderPage = useCallback(() => {
    switch (page) {
      case 'overview':
        return <OverviewPage />;
      case 'swarm':
        return <SwarmPage />;
      case 'agents':
        return <AgentsPage />;
      case 'skills':
        return <SkillsLibrary />;
      case 'memory':
        return <SharedMemory />;
      case 'settings':
        return <SettingsPage />;
    }
  }, [page]);

  return (
    <SwarmContext.Provider value={swarmState}>
      <div style={styles.app}>
        {/* Sidebar */}
        <div style={styles.sidebar}>
          <div style={styles.logo}>
            <div style={styles.logoText}>HIVEMIND</div>
            <div style={styles.logoSub}>Swarm Intelligence</div>
          </div>
          <nav style={{ marginTop: 8 }}>
            {NAV_ITEMS.map((item) => (
              <div
                key={item.id}
                style={styles.navItem(page === item.id)}
                onClick={() => setPage(item.id)}
              >
                <span style={{ fontSize: 16, width: 20, textAlign: 'center' }}>{item.icon}</span>
                {item.label}
              </div>
            ))}
          </nav>
          <div style={{ flex: 1 }} />
          <div style={{ padding: '12px 20px', fontSize: 10, color: THEME.textDim }}>
            v0.1.0-alpha &middot; MIT License
          </div>
        </div>

        {/* Main Content */}
        <div style={styles.main}>
          <div style={styles.topBar}>
            <span style={styles.pageTitle}>
              {NAV_ITEMS.find((n) => n.id === page)?.label}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12 }}>
              <span style={styles.connectionDot(swarmState.connected)} />
              <span style={{ color: swarmState.connected ? THEME.success : THEME.error }}>
                {swarmState.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          <div style={styles.content}>{renderPage()}</div>
        </div>
      </div>
    </SwarmContext.Provider>
  );
}

// ─── Mount ───────────────────────────────────────────────────────────────────

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}

export default App;
