import React, { useRef, useEffect, useMemo } from 'react';
import * as d3 from 'd3';
import type { AgentInfo } from '../server';
import { useSwarm } from '../app';

// ─── Constants ───────────────────────────────────────────────────────────────

const AGENT_COLORS: Record<AgentInfo['type'], string> = {
  orchestrator: '#a855f7', // Purple — command nodes
  worker: '#6366f1',       // Indigo — the backbone
  specialist: '#06b6d4',   // Cyan — precision units
  sentinel: '#f59e0b',     // Amber — watchful guardians
};

const AGENT_RADII: Record<AgentInfo['type'], number> = {
  orchestrator: 18,
  worker: 10,
  specialist: 13,
  sentinel: 11,
};

const STATUS_GLOW: Record<AgentInfo['status'], string> = {
  active: '0 0 12px rgba(34, 197, 94, 0.6)',
  idle: '0 0 6px rgba(107, 107, 138, 0.3)',
  error: '0 0 14px rgba(239, 68, 68, 0.7)',
  spawning: '0 0 10px rgba(245, 158, 11, 0.5)',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  agent: AgentInfo;
  radius: number;
  color: string;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  sourceId: string;
  targetId: string;
  strength: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const { agents } = useSwarm();

  // Build graph data from agent connections
  const { nodes, links } = useMemo(() => {
    const agentList = Array.from(agents.values());
    const nodeMap = new Map<string, GraphNode>();

    const graphNodes: GraphNode[] = agentList.map((agent) => {
      const node: GraphNode = {
        id: agent.id,
        agent,
        radius: AGENT_RADII[agent.type],
        color: AGENT_COLORS[agent.type],
      };
      nodeMap.set(agent.id, node);
      return node;
    });

    const graphLinks: GraphLink[] = [];
    const seen = new Set<string>();

    for (const agent of agentList) {
      for (const connId of agent.connections) {
        const key = [agent.id, connId].sort().join(':');
        if (!seen.has(key) && nodeMap.has(connId)) {
          seen.add(key);
          graphLinks.push({
            source: agent.id,
            target: connId,
            sourceId: agent.id,
            targetId: connId,
            strength: agent.type === 'orchestrator' || agents.get(connId)?.type === 'orchestrator' ? 0.8 : 0.4,
          });
        }
      }
    }

    return { nodes: graphNodes, links: graphLinks };
  }, [agents]);

  // D3 force simulation
  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const { width, height } = container.getBoundingClientRect();
    const svgSel = d3.select(svg).attr('width', width).attr('height', height);

    svgSel.selectAll('*').remove();

    // Definitions: gradients, filters
    const defs = svgSel.append('defs');

    // Glow filter for active agents
    const glowFilter = defs.append('filter').attr('id', 'agent-glow');
    glowFilter.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur');
    glowFilter
      .append('feMerge')
      .selectAll('feMergeNode')
      .data(['blur', 'SourceGraphic'])
      .join('feMergeNode')
      .attr('in', (d) => d);

    // Animated gradient for data flow along edges
    const flowGrad = defs
      .append('linearGradient')
      .attr('id', 'data-flow')
      .attr('gradientUnits', 'userSpaceOnUse');
    flowGrad.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1').attr('stop-opacity', 0);
    flowGrad.append('stop').attr('offset', '50%').attr('stop-color', '#06b6d4').attr('stop-opacity', 0.8);
    flowGrad.append('stop').attr('offset', '100%').attr('stop-color', '#6366f1').attr('stop-opacity', 0);

    const g = svgSel.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on('zoom', (event) => {
      g.attr('transform', event.transform);
    });
    svgSel.call(zoom);

    // Create simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance(80)
          .strength((d) => d.strength),
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius((d) => d.radius + 8))
      .alphaDecay(0.01);

    simulationRef.current = simulation;

    // Draw links
    const linkGroup = g.append('g').attr('class', 'links');
    const linkElements = linkGroup
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#1e1e2e')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6);

    // Animated data flow particles along edges
    const particleGroup = g.append('g').attr('class', 'particles');

    function spawnParticle(link: GraphLink) {
      const source = link.source as GraphNode;
      const target = link.target as GraphNode;
      if (!source.x || !source.y || !target.x || !target.y) return;

      const particle = particleGroup
        .append('circle')
        .attr('r', 2)
        .attr('fill', '#06b6d4')
        .attr('opacity', 0.9)
        .attr('cx', source.x)
        .attr('cy', source.y);

      particle
        .transition()
        .duration(1200 + Math.random() * 800)
        .ease(d3.easeLinear)
        .attr('cx', target.x)
        .attr('cy', target.y)
        .attr('opacity', 0)
        .remove();
    }

    // Spawn particles periodically for active links
    const particleInterval = setInterval(() => {
      for (const link of links) {
        const source = agents.get(link.sourceId);
        const target = agents.get(link.targetId);
        if (source?.status === 'active' || target?.status === 'active') {
          if (Math.random() < 0.3) {
            spawnParticle(link);
          }
        }
      }
    }, 400);

    // Draw nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeElements = nodeGroup
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes, (d) => d.id)
      .join('g')
      .style('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    // Outer glow ring for active agents
    nodeElements
      .append('circle')
      .attr('r', (d) => d.radius + 4)
      .attr('fill', 'none')
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', (d) => (d.agent.status === 'active' ? 0.4 : 0))
      .attr('filter', 'url(#agent-glow)');

    // Main node circle
    nodeElements
      .append('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => d.color)
      .attr('fill-opacity', 0.15)
      .attr('stroke', (d) => d.color)
      .attr('stroke-width', 2);

    // Inner bright core
    nodeElements
      .append('circle')
      .attr('r', (d) => d.radius * 0.4)
      .attr('fill', (d) => d.color)
      .attr('opacity', (d) => (d.agent.status === 'active' ? 0.9 : 0.4));

    // Agent name label
    nodeElements
      .append('text')
      .text((d) => d.agent.name)
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => d.radius + 14)
      .attr('fill', '#6b6b8a')
      .attr('font-size', 9)
      .attr('font-family', 'Inter, sans-serif');

    // Tick handler
    simulation.on('tick', () => {
      linkElements
        .attr('x1', (d) => (d.source as GraphNode).x!)
        .attr('y1', (d) => (d.source as GraphNode).y!)
        .attr('x2', (d) => (d.target as GraphNode).x!)
        .attr('y2', (d) => (d.target as GraphNode).y!);

      nodeElements.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
    });

    return () => {
      simulation.stop();
      clearInterval(particleInterval);
    };
  }, [nodes, links]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 400,
        position: 'relative',
        background: 'radial-gradient(ellipse at center, #12121a 0%, #0a0a0f 100%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          fontSize: 11,
          color: '#6b6b8a',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          zIndex: 1,
        }}
      >
        Agent Collaboration Graph
      </div>

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          display: 'flex',
          gap: 14,
          fontSize: 10,
          color: '#6b6b8a',
          zIndex: 1,
        }}
      >
        {Object.entries(AGENT_COLORS).map(([type, color]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
              }}
            />
            {type}
          </div>
        ))}
      </div>

      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
