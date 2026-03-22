import React, { useState, useEffect } from 'react';
import { useSwarm } from '../app';

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatMemory(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

// ─── Mini Sparkline ──────────────────────────────────────────────────────────

function Sparkline({ data, color, height = 32 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 120;
  const step = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(' ');

  // Fill area under line
  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`spark-fill-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={fillPoints} fill={`url(#spark-fill-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

// ─── Metric Card ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  subValue,
  color,
  sparkData,
}: {
  label: string;
  value: string | number;
  subValue?: string;
  color: string;
  sparkData?: number[];
}) {
  return (
    <div
      style={{
        background: THEME.bg,
        border: `1px solid ${THEME.border}`,
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </div>
        {subValue && (
          <div style={{ fontSize: 10, color: THEME.textDim, marginTop: 4 }}>{subValue}</div>
        )}
      </div>
      {sparkData && <Sparkline data={sparkData} color={color} />}
    </div>
  );
}

// ─── Progress Ring ───────────────────────────────────────────────────────────

function ProgressRing({ value, max, color, label }: { value: number; max: number; color: string; label: string }) {
  const size = 64;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(value / max, 1) : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={THEME.border} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ fontSize: 10, color: THEME.textDim, textAlign: 'center' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
        {(progress * 100).toFixed(0)}%
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SwarmStatus() {
  const { metrics, agents } = useSwarm();
  const [agentHistory, setAgentHistory] = useState<number[]>([]);
  const [taskHistory, setTaskHistory] = useState<number[]>([]);
  const [memoryHistory, setMemoryHistory] = useState<number[]>([]);

  // Track historical sparkline data
  useEffect(() => {
    const interval = setInterval(() => {
      setAgentHistory((prev) => [...prev.slice(-29), metrics.activeAgents]);
      setTaskHistory((prev) => [...prev.slice(-29), metrics.activeTasks]);
      setMemoryHistory((prev) => [...prev.slice(-29), metrics.totalMemoryMB]);
    }, 2000);
    return () => clearInterval(interval);
  }, [metrics]);

  const totalTasks = metrics.completedTasks + metrics.failedTasks;
  const successRate = totalTasks > 0 ? metrics.completedTasks / totalTasks : 1;

  const agentsByType = {
    orchestrator: 0,
    worker: 0,
    specialist: 0,
    sentinel: 0,
  };
  for (const agent of agents.values()) {
    agentsByType[agent.type]++;
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: 20,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ fontSize: 11, color: THEME.textDim, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Swarm Health
      </div>

      {/* Metric Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <MetricCard
          label="Active Agents"
          value={metrics.activeAgents}
          subValue={`${metrics.totalAgents} total`}
          color={THEME.accent}
          sparkData={agentHistory}
        />
        <MetricCard
          label="Active Tasks"
          value={metrics.activeTasks}
          subValue={`${metrics.completedTasks.toLocaleString()} completed`}
          color={THEME.cyan}
          sparkData={taskHistory}
        />
        <MetricCard
          label="Memory Usage"
          value={formatMemory(metrics.totalMemoryMB)}
          color={metrics.totalMemoryMB > 4096 ? THEME.warning : THEME.success}
          sparkData={memoryHistory}
        />
        <MetricCard
          label="Uptime"
          value={formatUptime(metrics.uptimeSeconds)}
          subValue={`${metrics.messagesPerSecond.toFixed(1)} msg/s`}
          color={THEME.text}
        />
      </div>

      {/* Progress Rings */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          padding: '12px 0',
          background: THEME.bg,
          border: `1px solid ${THEME.border}`,
          borderRadius: 8,
        }}
      >
        <ProgressRing
          value={metrics.activeAgents}
          max={metrics.totalAgents || 1}
          color={THEME.accent}
          label="Agent Utilization"
        />
        <ProgressRing
          value={successRate * 100}
          max={100}
          color={successRate > 0.95 ? THEME.success : successRate > 0.8 ? THEME.warning : THEME.error}
          label="Success Rate"
        />
        <ProgressRing
          value={metrics.totalMemoryMB}
          max={8192}
          color={metrics.totalMemoryMB > 6144 ? THEME.error : THEME.cyan}
          label="Memory Cap"
        />
      </div>

      {/* Agent Type Breakdown */}
      <div
        style={{
          background: THEME.bg,
          border: `1px solid ${THEME.border}`,
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div style={{ fontSize: 10, color: THEME.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
          Agent Distribution
        </div>
        {Object.entries(agentsByType).map(([type, count]) => {
          const typeColors: Record<string, string> = {
            orchestrator: '#a855f7',
            worker: '#6366f1',
            specialist: '#06b6d4',
            sentinel: '#f59e0b',
          };
          const pct = metrics.totalAgents > 0 ? (count / metrics.totalAgents) * 100 : 0;
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: typeColors[type], flexShrink: 0 }} />
              <span style={{ fontSize: 11, width: 80, color: THEME.textDim }}>{type}</span>
              <div style={{ flex: 1, height: 4, background: THEME.border, borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: typeColors[type],
                    borderRadius: 2,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <span style={{ fontSize: 11, color: THEME.text, fontVariantNumeric: 'tabular-nums', width: 24, textAlign: 'right' }}>
                {count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
