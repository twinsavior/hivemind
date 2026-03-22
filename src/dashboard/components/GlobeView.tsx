import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useSwarm } from '../app';
import type { AgentInfo } from '../server';

// ─── Constants ───────────────────────────────────────────────────────────────

const GLOBE_RADIUS = 2;
const ATMOSPHERE_RADIUS = 2.12;
const POINT_SIZE = 0.04;
const ARC_SEGMENTS = 64;
const ROTATION_SPEED = 0.0008;

const COLORS = {
  globe: 0x12121a,
  wireframe: 0x1e1e2e,
  atmosphere: 0x6366f1,
  land: 0x1a1a2e,
  orchestrator: 0xa855f7,
  worker: 0x6366f1,
  specialist: 0x06b6d4,
  sentinel: 0xf59e0b,
  arc: 0x06b6d4,
  activePoint: 0x22c55e,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function createArcBetween(
  start: THREE.Vector3,
  end: THREE.Vector3,
  altitude: number,
): THREE.CatmullRomCurve3 {
  const mid = start.clone().add(end).multiplyScalar(0.5).normalize().multiplyScalar(GLOBE_RADIUS + altitude);
  return new THREE.CatmullRomCurve3([start, mid, end], false, 'catmullrom', 0.5);
}

function agentColor(type: AgentInfo['type']): number {
  return COLORS[type] ?? COLORS.worker;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GlobeView() {
  const mountRef = useRef<HTMLDivElement>(null);
  const { agents } = useSwarm();
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // ── Scene Setup ──────────────────────────────────────────────────────────

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // ── Globe ────────────────────────────────────────────────────────────────

    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Solid dark sphere
    const globeGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const globeMat = new THREE.MeshBasicMaterial({
      color: COLORS.globe,
      transparent: true,
      opacity: 0.95,
    });
    globeGroup.add(new THREE.Mesh(globeGeo, globeMat));

    // Wireframe overlay — gives the technical "data visualization" feel
    const wireGeo = new THREE.SphereGeometry(GLOBE_RADIUS + 0.005, 32, 32);
    const wireMat = new THREE.MeshBasicMaterial({
      color: COLORS.wireframe,
      wireframe: true,
      transparent: true,
      opacity: 0.25,
    });
    globeGroup.add(new THREE.Mesh(wireGeo, wireMat));

    // ── Atmosphere Glow ──────────────────────────────────────────────────────

    const atmosGeo = new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 64, 64);
    const atmosMat = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.65 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
          gl_FragColor = vec4(0.388, 0.400, 0.945, 1.0) * intensity;
        }
      `,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true,
    });
    globeGroup.add(new THREE.Mesh(atmosGeo, atmosMat));

    // ── Data Points & Arcs ───────────────────────────────────────────────────

    const pointsGroup = new THREE.Group();
    globeGroup.add(pointsGroup);

    const arcsGroup = new THREE.Group();
    globeGroup.add(arcsGroup);

    // Track animated arcs
    const activeArcs: {
      mesh: THREE.Line;
      dashOffset: number;
      speed: number;
    }[] = [];

    function updateAgentVisualization() {
      // Clear existing
      while (pointsGroup.children.length) pointsGroup.remove(pointsGroup.children[0]);
      while (arcsGroup.children.length) arcsGroup.remove(arcsGroup.children[0]);
      activeArcs.length = 0;

      const agentList = Array.from(agentsRef.current.values()).filter((a) => a.location);

      // Draw data points
      for (const agent of agentList) {
        if (!agent.location) continue;
        const pos = latLngToVector3(agent.location.lat, agent.location.lng, GLOBE_RADIUS + 0.01);

        // Outer ring
        const ringGeo = new THREE.RingGeometry(POINT_SIZE, POINT_SIZE * 2.5, 16);
        const ringMat = new THREE.MeshBasicMaterial({
          color: agentColor(agent.type),
          transparent: true,
          opacity: agent.status === 'active' ? 0.6 : 0.2,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(pos);
        ring.lookAt(pos.clone().multiplyScalar(2));
        pointsGroup.add(ring);

        // Core dot
        const dotGeo = new THREE.SphereGeometry(POINT_SIZE, 8, 8);
        const dotMat = new THREE.MeshBasicMaterial({
          color: agent.status === 'active' ? COLORS.activePoint : agentColor(agent.type),
        });
        const dot = new THREE.Mesh(dotGeo, dotMat);
        dot.position.copy(pos);
        pointsGroup.add(dot);

        // Pulsing halo for active agents
        if (agent.status === 'active') {
          const haloGeo = new THREE.RingGeometry(POINT_SIZE * 2, POINT_SIZE * 4, 16);
          const haloMat = new THREE.MeshBasicMaterial({
            color: COLORS.activePoint,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
          });
          const halo = new THREE.Mesh(haloGeo, haloMat);
          halo.position.copy(pos);
          halo.lookAt(pos.clone().multiplyScalar(2));
          halo.userData = { pulse: true, baseScale: 1 };
          pointsGroup.add(halo);
        }
      }

      // Draw connection arcs between agents
      for (const agent of agentList) {
        if (!agent.location) continue;
        for (const connId of agent.connections) {
          const target = agentsRef.current.get(connId);
          if (!target?.location) continue;
          // Avoid duplicate arcs
          if (agent.id > connId) continue;

          const start = latLngToVector3(agent.location.lat, agent.location.lng, GLOBE_RADIUS + 0.01);
          const end = latLngToVector3(target.location.lat, target.location.lng, GLOBE_RADIUS + 0.01);

          const dist = start.distanceTo(end);
          const altitude = 0.3 + dist * 0.15;
          const curve = createArcBetween(start, end, altitude);
          const points = curve.getPoints(ARC_SEGMENTS);

          const arcGeo = new THREE.BufferGeometry().setFromPoints(points);
          const arcMat = new THREE.LineDashedMaterial({
            color: COLORS.arc,
            transparent: true,
            opacity: 0.5,
            dashSize: 0.08,
            gapSize: 0.04,
          });

          const arcLine = new THREE.Line(arcGeo, arcMat);
          arcLine.computeLineDistances();
          arcsGroup.add(arcLine);

          activeArcs.push({
            mesh: arcLine,
            dashOffset: 0,
            speed: 0.002 + Math.random() * 0.003,
          });
        }
      }
    }

    updateAgentVisualization();
    const vizInterval = setInterval(updateAgentVisualization, 5000);

    // ── Mouse Interaction ────────────────────────────────────────────────────

    let isDragging = false;
    let prevMouse = { x: 0, y: 0 };
    let rotVelocity = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;
      rotVelocity = { x: dy * 0.002, y: dx * 0.002 };
      prevMouse = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => {
      isDragging = false;
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup', onMouseUp);
    container.addEventListener('mouseleave', onMouseUp);

    // ── Animation Loop ───────────────────────────────────────────────────────

    let animationId: number;
    let time = 0;

    function animate() {
      animationId = requestAnimationFrame(animate);
      time += 0.016;

      // Auto-rotate or apply drag velocity
      if (!isDragging) {
        rotVelocity.x *= 0.95;
        rotVelocity.y *= 0.95;
        globeGroup.rotation.y += ROTATION_SPEED + rotVelocity.y;
        globeGroup.rotation.x += rotVelocity.x;
      } else {
        globeGroup.rotation.y += rotVelocity.y;
        globeGroup.rotation.x += rotVelocity.x;
      }

      // Clamp vertical rotation
      globeGroup.rotation.x = Math.max(-0.8, Math.min(0.8, globeGroup.rotation.x));

      // Animate arc dash offsets (flowing data effect)
      for (const arc of activeArcs) {
        arc.dashOffset -= arc.speed;
        const mat = arc.mesh.material as THREE.LineDashedMaterial;
        mat.dashSize = 0.08 + Math.sin(time * 2 + arc.dashOffset * 100) * 0.02;
      }

      // Pulse halos
      pointsGroup.children.forEach((child) => {
        if (child.userData?.pulse) {
          const scale = 1 + Math.sin(time * 3) * 0.3;
          child.scale.set(scale, scale, scale);
          (child as THREE.Mesh).material &&
            ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity &&
            (((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity =
              0.15 + Math.sin(time * 3) * 0.15);
        }
      });

      renderer.render(scene, camera);
    }

    animate();

    // ── Resize Handler ───────────────────────────────────────────────────────

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // ── Cleanup ──────────────────────────────────────────────────────────────

    return () => {
      cancelAnimationFrame(animationId);
      clearInterval(vizInterval);
      resizeObserver.disconnect();
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('mouseleave', onMouseUp);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 300,
        position: 'relative',
        background: 'radial-gradient(ellipse at 60% 40%, #0e0e1a 0%, #060609 100%)',
        cursor: 'grab',
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
          pointerEvents: 'none',
        }}
      >
        Global Agent Activity
      </div>
    </div>
  );
}
