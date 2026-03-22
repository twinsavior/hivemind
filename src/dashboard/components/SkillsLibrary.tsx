import React, { useState, useEffect, useCallback } from 'react';

const THEME = {
  bg: '#0a0a0f',
  bgPanel: '#12121a',
  border: '#1e1e2e',
  text: '#e2e2ef',
  textDim: '#6b6b8a',
  accent: '#6366f1',
  accentGlow: 'rgba(99, 102, 241, 0.15)',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  cyan: '#06b6d4',
} as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillInfo {
  name: string;
  version: string;
  agent: string;
  description: string;
  triggers: string[];
  tags: string[];
  enabled: boolean;
}

interface MarketplaceSkill {
  name: string;
  version: string;
  description: string;
  agent: string;
  author: string;
  downloads: number;
  stars: number;
  tags: string[];
  dependencies: string[];
  publishedAt: string;
  featured: boolean;
}

type ViewMode = 'installed' | 'marketplace';

const agentColors: Record<string, string> = {
  scout: THEME.cyan,
  builder: THEME.accent,
  communicator: THEME.success,
  monitor: THEME.warning,
  analyst: '#a78bfa',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SkillsLibrary() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [filter, setFilter] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('installed');
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(null);
  const [marketplaceTab, setMarketplaceTab] = useState<'popular' | 'recent' | 'featured' | 'search'>('popular');
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Fetch installed skills
  const fetchInstalled = useCallback(() => {
    setLoading(true);
    fetch('/api/skills')
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        setSkills(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => {
        setSkills([
          { name: 'web-research', version: '1.0.0', agent: 'scout', description: 'Deep web research with source verification', triggers: ['research', 'find information'], tags: ['research', 'web'], enabled: true },
          { name: 'code-generate', version: '1.0.0', agent: 'builder', description: 'Generate production-ready code from specs', triggers: ['generate code', 'implement'], tags: ['code', 'generation'], enabled: true },
          { name: 'slack-notify', version: '1.0.0', agent: 'communicator', description: 'Send notifications via Slack', triggers: ['notify', 'slack message'], tags: ['communication', 'slack'], enabled: true },
          { name: 'uptime-check', version: '1.0.0', agent: 'monitor', description: 'Monitor service uptime and latency', triggers: ['check uptime', 'monitor'], tags: ['monitoring', 'health'], enabled: false },
          { name: 'trend-analysis', version: '1.0.0', agent: 'analyst', description: 'Analyze trends and forecast outcomes', triggers: ['analyze trends', 'predict'], tags: ['analysis', 'prediction'], enabled: true },
          { name: 'chrome-cdp', version: '1.0.0', agent: 'scout', description: 'Browser automation via Chrome DevTools Protocol', triggers: ['browse', 'screenshot', 'click'], tags: ['browser', 'automation'], enabled: true },
        ]);
        setLoading(false);
      });
  }, []);

  // Fetch marketplace skills
  const fetchMarketplace = useCallback((tab: string, query?: string) => {
    setMarketplaceLoading(true);

    let endpoint = '/api/marketplace/popular';
    if (tab === 'recent') endpoint = '/api/marketplace/recent';
    else if (tab === 'featured') endpoint = '/api/marketplace/featured';
    else if (tab === 'search' && query) endpoint = `/api/marketplace/search?q=${encodeURIComponent(query)}`;

    if (agentFilter !== 'all') {
      const sep = endpoint.includes('?') ? '&' : '?';
      endpoint += `${sep}agent=${agentFilter}`;
    }

    fetch(endpoint)
      .then((r) => r.ok ? r.json() : { skills: [] })
      .then((data) => {
        setMarketplaceSkills(data.skills ?? []);
        setMarketplaceLoading(false);
      })
      .catch(() => {
        setMarketplaceSkills([]);
        setMarketplaceLoading(false);
      });
  }, [agentFilter]);

  useEffect(() => {
    fetchInstalled();
  }, [fetchInstalled]);

  useEffect(() => {
    if (viewMode === 'marketplace') {
      fetchMarketplace(marketplaceTab, filter);
    }
  }, [viewMode, marketplaceTab, fetchMarketplace, filter]);

  // Clear status after a few seconds
  useEffect(() => {
    if (!statusMessage) return;
    const timer = setTimeout(() => setStatusMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [statusMessage]);

  // Determine installed skill names for cross-referencing
  const installedNames = new Set(skills.map((s) => s.name));

  // Install a marketplace skill
  const handleInstall = async (name: string) => {
    setInstallingSkill(name);
    try {
      const res = await fetch(`/api/marketplace/${encodeURIComponent(name)}/download`);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      setStatusMessage({ text: `Skill "${name}" download initiated. Use CLI to complete install.`, type: 'success' });
      // Refresh installed list
      fetchInstalled();
    } catch {
      setStatusMessage({ text: `Failed to install "${name}". Is the marketplace running?`, type: 'error' });
    } finally {
      setInstallingSkill(null);
    }
  };

  // Compute filter sets
  const allAgents = viewMode === 'installed'
    ? ['all', ...new Set(skills.map((s) => s.agent))]
    : ['all', 'scout', 'builder', 'communicator', 'monitor', 'analyst'];

  const filteredSkills = skills.filter((s) => {
    const matchesText = !filter || s.name.includes(filter) || s.description.toLowerCase().includes(filter.toLowerCase());
    const matchesAgent = agentFilter === 'all' || s.agent === agentFilter;
    return matchesText && matchesAgent;
  });

  const filteredMarketplace = marketplaceSkills.filter((s) => {
    const matchesAgent = agentFilter === 'all' || s.agent === agentFilter;
    return matchesAgent;
  });

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
      {/* Status message toast */}
      {statusMessage && (
        <div style={{
          padding: '8px 16px',
          borderRadius: 8,
          background: statusMessage.type === 'success' ? THEME.success + '20' : THEME.error + '20',
          border: `1px solid ${statusMessage.type === 'success' ? THEME.success : THEME.error}`,
          color: statusMessage.type === 'success' ? THEME.success : THEME.error,
          fontSize: 12,
        }}>
          {statusMessage.text}
        </div>
      )}

      {/* View mode tabs */}
      <div style={{ display: 'flex', gap: 2, background: THEME.bg, borderRadius: 8, padding: 2 }}>
        {(['installed', 'marketplace'] as ViewMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              flex: 1,
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: viewMode === mode ? THEME.accent : 'transparent',
              color: viewMode === mode ? '#fff' : THEME.textDim,
              fontSize: 12,
              fontWeight: viewMode === mode ? 600 : 400,
              cursor: 'pointer',
              textTransform: 'capitalize',
              transition: 'all 0.15s ease',
            }}
          >
            {mode === 'installed' ? 'Installed Skills' : 'Marketplace'}
          </button>
        ))}
      </div>

      {/* Marketplace sub-tabs */}
      {viewMode === 'marketplace' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {(['popular', 'recent', 'featured', 'search'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setMarketplaceTab(tab)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border: `1px solid ${marketplaceTab === tab ? THEME.cyan : THEME.border}`,
                background: marketplaceTab === tab ? THEME.cyan + '15' : 'transparent',
                color: marketplaceTab === tab ? THEME.cyan : THEME.textDim,
                fontSize: 10,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          type="text"
          placeholder={viewMode === 'marketplace' && marketplaceTab === 'search' ? 'Search marketplace...' : 'Filter skills...'}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && viewMode === 'marketplace' && marketplaceTab === 'search') {
              fetchMarketplace('search', filter);
            }
          }}
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
        <div style={{ display: 'flex', gap: 6 }}>
          {allAgents.map((a) => (
            <button
              key={a}
              onClick={() => setAgentFilter(a)}
              style={{
                padding: '6px 12px',
                borderRadius: 6,
                border: `1px solid ${agentFilter === a ? THEME.accent : THEME.border}`,
                background: agentFilter === a ? THEME.accentGlow : 'transparent',
                color: agentFilter === a ? THEME.text : THEME.textDim,
                fontSize: 11,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 20, fontSize: 12, color: THEME.textDim }}>
        {viewMode === 'installed' ? (
          <>
            <span>{skills.length} skills registered</span>
            <span>{skills.filter((s) => s.enabled).length} enabled</span>
            <span>{new Set(skills.map((s) => s.agent)).size} agent types</span>
          </>
        ) : (
          <>
            <span>{marketplaceSkills.length} skills found</span>
            <span>{marketplaceSkills.filter((s) => installedNames.has(s.name)).length} already installed</span>
          </>
        )}
      </div>

      {/* Content area */}
      {(viewMode === 'installed' ? loading : marketplaceLoading) ? (
        <div style={{ color: THEME.textDim, textAlign: 'center', padding: 40 }}>
          {viewMode === 'installed' ? 'Loading skills...' : 'Searching marketplace...'}
        </div>
      ) : viewMode === 'installed' ? (
        /* ─── Installed Skills Grid ─── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, overflow: 'auto', flex: 1 }}>
          {filteredSkills.map((skill) => (
            <InstalledSkillCard key={skill.name} skill={skill} agentColors={agentColors} />
          ))}
          {filteredSkills.length === 0 && (
            <div style={{ color: THEME.textDim, gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>
              No installed skills match your filter.
            </div>
          )}
        </div>
      ) : (
        /* ─── Marketplace Skills Grid ─── */
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12, overflow: 'auto', flex: 1 }}>
          {filteredMarketplace.map((skill) => (
            <MarketplaceSkillCard
              key={skill.name}
              skill={skill}
              agentColors={agentColors}
              isInstalled={installedNames.has(skill.name)}
              installing={installingSkill === skill.name}
              onInstall={() => handleInstall(skill.name)}
            />
          ))}
          {filteredMarketplace.length === 0 && (
            <div style={{ color: THEME.textDim, gridColumn: '1/-1', textAlign: 'center', padding: 40, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>No marketplace skills found.</div>
              <div style={{ fontSize: 11 }}>
                {marketplaceTab === 'search'
                  ? 'Try a different search term.'
                  : 'Make sure the marketplace server is running.'}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function InstalledSkillCard({ skill, agentColors }: { skill: SkillInfo; agentColors: Record<string, string> }) {
  return (
    <div
      style={{
        background: THEME.bgPanel,
        border: `1px solid ${THEME.border}`,
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{skill.name}</span>
          <span style={{ fontSize: 10, color: THEME.textDim }}>v{skill.version}</span>
        </div>
        <div
          style={{
            width: 36,
            height: 20,
            borderRadius: 10,
            background: skill.enabled ? THEME.success + '30' : THEME.bg,
            border: `1px solid ${skill.enabled ? THEME.success : THEME.border}`,
            position: 'relative',
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: skill.enabled ? THEME.success : THEME.textDim,
              position: 'absolute',
              top: 2,
              left: skill.enabled ? 18 : 2,
              transition: 'left 0.15s ease',
            }}
          />
        </div>
      </div>

      <div style={{ fontSize: 12, color: THEME.textDim, lineHeight: 1.4 }}>
        {skill.description}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AgentBadge agent={skill.agent} agentColors={agentColors} />
        <TagList tags={skill.tags} />
      </div>

      <div style={{ fontSize: 10, color: THEME.textDim }}>
        Triggers: {skill.triggers.join(', ')}
      </div>
    </div>
  );
}

function MarketplaceSkillCard({
  skill,
  agentColors,
  isInstalled,
  installing,
  onInstall,
}: {
  skill: MarketplaceSkill;
  agentColors: Record<string, string>;
  isInstalled: boolean;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div
      style={{
        background: THEME.bgPanel,
        border: `1px solid ${skill.featured ? THEME.warning + '60' : THEME.border}`,
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        position: 'relative',
      }}
    >
      {/* Featured badge */}
      {skill.featured && (
        <div style={{
          position: 'absolute',
          top: 8,
          right: 8,
          fontSize: 9,
          padding: '2px 6px',
          borderRadius: 4,
          background: THEME.warning + '20',
          color: THEME.warning,
          fontWeight: 600,
          textTransform: 'uppercase',
        }}>
          Featured
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{skill.name}</span>
            <span style={{ fontSize: 10, color: THEME.textDim }}>v{skill.version}</span>
          </div>
          <div style={{ fontSize: 10, color: THEME.textDim }}>
            by {skill.author}
          </div>
        </div>
      </div>

      {/* Description */}
      <div style={{ fontSize: 12, color: THEME.textDim, lineHeight: 1.4 }}>
        {skill.description}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: THEME.textDim }}>
        <span title="Downloads">{skill.downloads} downloads</span>
        <span title="Stars">{skill.stars} stars</span>
      </div>

      {/* Agent + tags */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AgentBadge agent={skill.agent} agentColors={agentColors} />
        <TagList tags={skill.tags} />
      </div>

      {/* Install / Installed button */}
      <button
        onClick={onInstall}
        disabled={isInstalled || installing}
        style={{
          marginTop: 'auto',
          padding: '6px 12px',
          borderRadius: 6,
          border: `1px solid ${isInstalled ? THEME.success : THEME.accent}`,
          background: isInstalled ? THEME.success + '15' : installing ? THEME.accent + '30' : THEME.accentGlow,
          color: isInstalled ? THEME.success : THEME.text,
          fontSize: 11,
          fontWeight: 600,
          cursor: isInstalled || installing ? 'default' : 'pointer',
          opacity: installing ? 0.7 : 1,
          transition: 'all 0.15s ease',
        }}
      >
        {isInstalled ? 'Installed' : installing ? 'Installing...' : 'Install'}
      </button>
    </div>
  );
}

function AgentBadge({ agent, agentColors }: { agent: string; agentColors: Record<string, string> }) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: '2px 8px',
        borderRadius: 10,
        background: `${agentColors[agent] ?? THEME.accent}20`,
        color: agentColors[agent] ?? THEME.accent,
        fontWeight: 600,
        textTransform: 'uppercase',
      }}
    >
      {agent}
    </span>
  );
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            fontSize: 9,
            padding: '2px 6px',
            borderRadius: 4,
            background: THEME.bg,
            color: THEME.textDim,
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  );
}
