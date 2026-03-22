import { EventEmitter } from 'events';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SwarmNode {
  id: string;
  type: 'agent' | 'task';
  label: string;
  role?: string;
  state: string;
  x?: number;
  y?: number;
  metrics?: { successRate: number; avgResponseMs: number; tasksCompleted: number };
}

export interface SwarmEdge {
  id: string;
  source: string;
  target: string;
  type: 'delegation' | 'message' | 'assignment' | 'result';
  label?: string;
  timestamp: number;
  active: boolean;
}

export interface SwarmGraphState {
  nodes: SwarmNode[];
  edges: SwarmEdge[];
  timestamp: number;
}

// ─── Role mapping for HIVEMIND agent types ───────────────────────────────────

const AGENT_TYPE_TO_ROLE: Record<string, string> = {
  orchestrator: 'coordinator',
  coordinator: 'coordinator',
  worker: 'builder',
  specialist: 'scout',
  sentinel: 'sentinel',
};

/** Map agent IDs to visualization roles for accurate coloring. */
const AGENT_ID_TO_ROLE: Record<string, string> = {
  'nova-1': 'coordinator',
  'scout-1': 'scout',
  'builder-1': 'builder',
  'sentinel-1': 'sentinel',
  'oracle-1': 'oracle',
  'courier-1': 'courier',
};

// ─── SwarmGraphTracker ───────────────────────────────────────────────────────

/**
 * Maintains a live graph of agents, tasks, and their relationships.
 * Listens to the dashboard event bus and agent/task events, then
 * pushes incremental updates to subscribed callbacks (WebSocket clients).
 */
export class SwarmGraphTracker extends EventEmitter {
  private nodes = new Map<string, SwarmNode>();
  private edges = new Map<string, SwarmEdge>();
  private edgeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private updateCallbacks: Array<(state: SwarmGraphState) => void> = [];

  /** How long edges stay active before fading (ms) */
  private readonly EDGE_TTL = 10_000;

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Attach to the dashboard event bus to listen for agent/task events.
   * This is the primary integration point — call once at server startup.
   */
  attachBus(bus: EventEmitter): void {
    bus.on('agent:update', (agent: any) => this.handleAgentUpdate(agent));
    bus.on('agent:added', (agent: any) => this.handleAgentUpdate(agent));
    bus.on('agent:removed', (payload: { id: string }) => this.handleAgentRemoved(payload.id));
    bus.on('task:event', (event: any) => this.handleTaskEvent(event));
  }

  /**
   * Return the current full graph state — used for initial sync
   * when a new WebSocket client connects.
   */
  getState(): SwarmGraphState {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      timestamp: Date.now(),
    };
  }

  /**
   * Register a callback that fires on every graph mutation.
   * Returns an unsubscribe function.
   */
  onUpdate(callback: (state: SwarmGraphState) => void): () => void {
    this.updateCallbacks.push(callback);
    return () => {
      this.updateCallbacks = this.updateCallbacks.filter((cb) => cb !== callback);
    };
  }

  // ─── Event Handlers ──────────────────────────────────────────────────────

  private handleAgentUpdate(agent: any): void {
    const id = agent.id as string;
    const role = AGENT_ID_TO_ROLE[id] || AGENT_TYPE_TO_ROLE[agent.type] || agent.type || 'worker';

    const existing = this.nodes.get(id);
    const node: SwarmNode = {
      id,
      type: 'agent',
      label: agent.name || id,
      role,
      state: agent.status || 'idle',
      x: existing?.x,
      y: existing?.y,
      metrics: {
        successRate: agent.tasksCompleted > 0 ? 1 : 0,
        avgResponseMs: 0,
        tasksCompleted: agent.tasksCompleted || 0,
      },
    };

    this.nodes.set(id, node);
    this.emitNodeUpdate(node);

    // If the agent has connections, create edges to connected agents
    if (Array.isArray(agent.connections)) {
      for (const connId of agent.connections) {
        const edgeId = this.makeEdgeId(id, connId, 'message');
        if (!this.edges.has(edgeId)) {
          this.addEdge({
            id: edgeId,
            source: id,
            target: connId,
            type: 'message',
            timestamp: Date.now(),
            active: false,
          });
        }
      }
    }
  }

  private handleAgentRemoved(agentId: string): void {
    this.nodes.delete(agentId);

    // Remove all edges connected to this agent
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === agentId || edge.target === agentId) {
        this.removeEdge(edgeId);
      }
    }

    this.emitFullUpdate();
  }

  private handleTaskEvent(event: any): void {
    const agentId = event.agentId as string;
    const taskNodeId = `task-${event.id}`;

    switch (event.status) {
      case 'started': {
        // Add a task node
        const taskNode: SwarmNode = {
          id: taskNodeId,
          type: 'task',
          label: (event.detail || event.action || 'Task').slice(0, 40),
          state: 'running',
        };
        this.nodes.set(taskNodeId, taskNode);

        // Create an assignment edge from agent to task
        const edgeId = this.makeEdgeId(agentId, taskNodeId, 'assignment');
        this.addEdge({
          id: edgeId,
          source: agentId,
          target: taskNodeId,
          type: 'assignment',
          label: 'executing',
          timestamp: Date.now(),
          active: true,
        });

        // Update the agent node state to active
        const agentNode = this.nodes.get(agentId);
        if (agentNode) {
          agentNode.state = 'active';
          this.emitNodeUpdate(agentNode);
        }
        break;
      }

      case 'completed': {
        // Find the original task node (may have -done suffix in id)
        const origTaskId = taskNodeId.replace(/-done$/, '');
        const taskNode = this.nodes.get(origTaskId);
        if (taskNode) {
          taskNode.state = 'completed';
          this.emitNodeUpdate(taskNode);
        }

        // Create a result edge
        const resultEdgeId = this.makeEdgeId(agentId, origTaskId, 'result');
        this.addEdge({
          id: resultEdgeId,
          source: agentId,
          target: origTaskId,
          type: 'result',
          label: 'completed',
          timestamp: Date.now(),
          active: true,
        });

        // Deactivate assignment edges
        for (const [, edge] of this.edges) {
          if (edge.target === origTaskId && edge.type === 'assignment') {
            edge.active = false;
          }
        }

        // Schedule task node removal after TTL
        this.scheduleEdgeRemoval(resultEdgeId);
        setTimeout(() => {
          this.nodes.delete(origTaskId);
          this.emitFullUpdate();
        }, this.EDGE_TTL);

        // Update agent metrics
        const agentNode = this.nodes.get(agentId);
        if (agentNode?.metrics) {
          agentNode.metrics.tasksCompleted++;
          agentNode.state = 'idle';
          this.emitNodeUpdate(agentNode);
        }
        break;
      }

      case 'failed': {
        const origTaskId2 = taskNodeId.replace(/-err$/, '');
        const failedTaskNode = this.nodes.get(origTaskId2);
        if (failedTaskNode) {
          failedTaskNode.state = 'failed';
          this.emitNodeUpdate(failedTaskNode);
        }

        // Schedule cleanup
        setTimeout(() => {
          this.nodes.delete(origTaskId2);
          // Remove all edges to this task
          for (const [edgeId, edge] of this.edges) {
            if (edge.source === origTaskId2 || edge.target === origTaskId2) {
              this.removeEdge(edgeId);
            }
          }
          this.emitFullUpdate();
        }, this.EDGE_TTL);

        const agentNode2 = this.nodes.get(agentId);
        if (agentNode2) {
          agentNode2.state = 'idle';
          if (agentNode2.metrics) {
            agentNode2.metrics.successRate = Math.max(0, agentNode2.metrics.successRate - 0.1);
          }
          this.emitNodeUpdate(agentNode2);
        }
        break;
      }

      case 'delegated': {
        // Delegation creates an edge between the delegating agent and the target agent
        const targetId = event.targetAgentId || taskNodeId;
        const delegationEdgeId = this.makeEdgeId(agentId, targetId, 'delegation');
        this.addEdge({
          id: delegationEdgeId,
          source: agentId,
          target: targetId,
          type: 'delegation',
          label: 'delegated',
          timestamp: Date.now(),
          active: true,
        });
        this.scheduleEdgeRemoval(delegationEdgeId);
        break;
      }
    }
  }

  // ─── Edge Management ─────────────────────────────────────────────────────

  private addEdge(edge: SwarmEdge): void {
    this.edges.set(edge.id, edge);
    this.scheduleEdgeRemoval(edge.id);
    this.emit('edge:add', edge);
    this.notifyListeners();
  }

  private removeEdge(edgeId: string): void {
    const timer = this.edgeTimers.get(edgeId);
    if (timer) clearTimeout(timer);
    this.edgeTimers.delete(edgeId);
    this.edges.delete(edgeId);
    this.emit('edge:remove', { id: edgeId });
  }

  private scheduleEdgeRemoval(edgeId: string): void {
    // Clear existing timer if any
    const existing = this.edgeTimers.get(edgeId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      const edge = this.edges.get(edgeId);
      if (edge) {
        edge.active = false;
        // Let it linger for 2 more seconds in inactive state, then remove
        setTimeout(() => {
          this.edges.delete(edgeId);
          this.edgeTimers.delete(edgeId);
          this.emitFullUpdate();
        }, 2000);
        this.notifyListeners();
      }
    }, this.EDGE_TTL);

    this.edgeTimers.set(edgeId, timer);
  }

  // ─── Emission Helpers ────────────────────────────────────────────────────

  private makeEdgeId(source: string, target: string, type: string): string {
    return `${source}--${type}--${target}--${Date.now().toString(36)}`;
  }

  private emitNodeUpdate(node: SwarmNode): void {
    this.emit('node:update', node);
    this.notifyListeners();
  }

  private emitFullUpdate(): void {
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const cb of this.updateCallbacks) {
      try {
        cb(state);
      } catch {
        // Don't let one bad callback break the rest
      }
    }
  }
}
