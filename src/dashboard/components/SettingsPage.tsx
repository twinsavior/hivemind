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
  error: '#ef4444',
  cyan: '#06b6d4',
} as const;

interface ConfigSection {
  key: string;
  label: string;
  fields: ConfigField[];
}

interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'toggle' | 'select';
  value: string | number | boolean;
  options?: string[];
  description?: string;
}

const DEFAULT_SECTIONS: ConfigSection[] = [
  {
    key: 'llm',
    label: 'LLM Providers',
    fields: [
      { key: 'primary_provider', label: 'Primary Provider', type: 'select', value: 'claude-code', options: ['claude-code', 'anthropic', 'openai', 'ollama', 'codex'], description: 'Main LLM provider for research agents' },
      { key: 'code_provider', label: 'Code Provider', type: 'select', value: 'codex', options: ['codex', 'claude-code', 'anthropic', 'openai', 'ollama'], description: 'Provider for code-focused agents (Builder, Sentinel)' },
      { key: 'max_tokens', label: 'Max Tokens', type: 'number', value: 4096, description: 'Maximum token output per request' },
      { key: 'temperature', label: 'Temperature', type: 'number', value: 0.7, description: 'Sampling temperature (0-2)' },
    ],
  },
  {
    key: 'agents',
    label: 'Agent Configuration',
    fields: [
      { key: 'max_concurrent', label: 'Max Concurrent Agents', type: 'number', value: 5, description: 'Maximum agents running simultaneously' },
      { key: 'task_timeout', label: 'Task Timeout (ms)', type: 'number', value: 300000, description: 'Timeout for individual agent tasks' },
      { key: 'auto_spawn', label: 'Auto-Spawn Agents', type: 'toggle', value: true, description: 'Automatically spawn agents when demand increases' },
      { key: 'health_check_interval', label: 'Health Check Interval (ms)', type: 'number', value: 30000, description: 'How often agents report health status' },
    ],
  },
  {
    key: 'memory',
    label: 'Memory Store',
    fields: [
      { key: 'db_path', label: 'Database Path', type: 'text', value: './data/hivemind.db', description: 'SQLite database file location' },
      { key: 'embedding_model', label: 'Embedding Model', type: 'select', value: 'Xenova/all-MiniLM-L6-v2', options: ['Xenova/all-MiniLM-L6-v2', 'Xenova/all-mpnet-base-v2', 'none'], description: 'Local embedding model for vector search' },
      { key: 'l0_max_tokens', label: 'L0 Summary Max Tokens', type: 'number', value: 128, description: 'Max tokens for L0 summary entries' },
      { key: 'auto_prune', label: 'Auto-Prune Expired', type: 'toggle', value: true, description: 'Automatically remove expired memory entries' },
    ],
  },
  {
    key: 'connectors',
    label: 'Connectors',
    fields: [
      { key: 'slack_enabled', label: 'Slack', type: 'toggle', value: false, description: 'Enable Slack integration' },
      { key: 'discord_enabled', label: 'Discord', type: 'toggle', value: false, description: 'Enable Discord integration' },
      { key: 'webhook_url', label: 'Webhook URL', type: 'text', value: '', description: 'POST task events to this URL' },
    ],
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    fields: [
      { key: 'port', label: 'Port', type: 'number', value: 4000, description: 'Dashboard server port' },
      { key: 'auth_enabled', label: 'Require Password', type: 'toggle', value: false, description: 'Protect dashboard with a password' },
      { key: 'metrics_interval', label: 'Metrics Interval (ms)', type: 'number', value: 2000, description: 'How often to broadcast metrics via WebSocket' },
    ],
  },
];

export function SettingsPage() {
  const [sections, setSections] = useState<ConfigSection[]>(DEFAULT_SECTIONS);
  const [activeSection, setActiveSection] = useState('llm');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.sections) setSections(data.sections);
      })
      .catch(() => {
        // Use defaults
      });
  }, []);

  const updateField = (sectionKey: string, fieldKey: string, value: string | number | boolean) => {
    setSections((prev) =>
      prev.map((s) =>
        s.key === sectionKey
          ? { ...s, fields: s.fields.map((f) => (f.key === fieldKey ? { ...f, value } : f)) }
          : s,
      ),
    );
    setDirty(true);
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections }),
      });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Save failed silently in demo mode
    }
    setSaving(false);
  };

  const current = sections.find((s) => s.key === activeSection);

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Section nav */}
      <div style={{ width: 200, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            style={{
              padding: '10px 14px',
              textAlign: 'left',
              borderRadius: 8,
              border: `1px solid ${activeSection === s.key ? THEME.accent : 'transparent'}`,
              background: activeSection === s.key ? `${THEME.accent}15` : 'transparent',
              color: activeSection === s.key ? THEME.text : THEME.textDim,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: activeSection === s.key ? 600 : 400,
            }}
          >
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${dirty ? THEME.accent : THEME.border}`,
            background: dirty ? THEME.accent : 'transparent',
            color: dirty ? '#fff' : THEME.textDim,
            fontSize: 13,
            cursor: dirty ? 'pointer' : 'default',
            fontWeight: 600,
            opacity: dirty ? 1 : 0.5,
          }}
        >
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
        </button>
      </div>

      {/* Fields */}
      <div
        style={{
          flex: 1,
          background: THEME.bgPanel,
          border: `1px solid ${THEME.border}`,
          borderRadius: 10,
          padding: 24,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {current && (
          <>
            <h3 style={{ margin: 0, fontSize: 15 }}>{current.label}</h3>
            {current.fields.map((field) => (
              <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 12, fontWeight: 600 }}>{field.label}</label>
                  {field.type === 'toggle' ? (
                    <div
                      onClick={() => updateField(current.key, field.key, !field.value)}
                      style={{
                        width: 40,
                        height: 22,
                        borderRadius: 11,
                        background: field.value ? `${THEME.success}30` : THEME.bg,
                        border: `1px solid ${field.value ? THEME.success : THEME.border}`,
                        position: 'relative',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: '50%',
                          background: field.value ? THEME.success : THEME.textDim,
                          position: 'absolute',
                          top: 2,
                          left: field.value ? 20 : 2,
                          transition: 'left 0.15s ease',
                        }}
                      />
                    </div>
                  ) : field.type === 'select' ? (
                    <select
                      value={String(field.value)}
                      onChange={(e) => updateField(current.key, field.key, e.target.value)}
                      style={{
                        padding: '6px 10px',
                        background: THEME.bg,
                        border: `1px solid ${THEME.border}`,
                        borderRadius: 6,
                        color: THEME.text,
                        fontSize: 12,
                        outline: 'none',
                        minWidth: 200,
                      }}
                    >
                      {field.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type}
                      value={String(field.value)}
                      onChange={(e) =>
                        updateField(
                          current.key,
                          field.key,
                          field.type === 'number' ? Number(e.target.value) : e.target.value,
                        )
                      }
                      style={{
                        padding: '6px 10px',
                        background: THEME.bg,
                        border: `1px solid ${THEME.border}`,
                        borderRadius: 6,
                        color: THEME.text,
                        fontSize: 12,
                        outline: 'none',
                        minWidth: 200,
                        textAlign: field.type === 'number' ? 'right' : 'left',
                      }}
                    />
                  )}
                </div>
                {field.description && (
                  <span style={{ fontSize: 10, color: THEME.textDim }}>{field.description}</span>
                )}
                <div style={{ borderBottom: `1px solid ${THEME.border}`, marginTop: 4 }} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
