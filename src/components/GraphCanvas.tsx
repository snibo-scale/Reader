import { type PointerEvent as RPE, useEffect, useMemo, useRef, useState } from "react";
import type { Paper } from "../types";
import { computeEdges } from "../lib/connections";

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const W = 1000;
const H = 680;

export default function GraphCanvas({
  papers,
  onOpen,
}: {
  papers: Paper[];
  onOpen: (id: string) => void;
}) {
  const indexed = useMemo(
    () => papers.filter((p) => p.index && (p.index.keywords.length > 0 || p.index.topics.length > 0)),
    [papers]
  );
  const edges = useMemo(() => computeEdges(indexed), [indexed]);

  const nodesRef = useRef<Map<string, Node>>(new Map());
  const draggingRef = useRef<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [, force] = useState(0);

  useEffect(() => {
    const m = new Map<string, Node>();
    const n = indexed.length;
    indexed.forEach((p, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      m.set(p.id, {
        id: p.id,
        x: W / 2 + Math.cos(angle) * 220 + (Math.random() - 0.5) * 40,
        y: H / 2 + Math.sin(angle) * 220 + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
      });
    });
    nodesRef.current = m;

    let frame = 0;
    let raf = 0;
    const tick = () => {
      const nodes = [...m.values()];
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy || 0.01;
          const d = Math.sqrt(d2);
          const rep = 2600 / d2;
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      for (const e of edges) {
        const a = m.get(e.a);
        const b = m.get(e.b);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const target = 90 + (1 - e.score) * 130;
        const k = (d - target) * 0.02;
        const fx = (dx / d) * k;
        const fy = (dy / d) * k;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      for (const nd of nodes) {
        nd.vx += (W / 2 - nd.x) * 0.0008;
        nd.vy += (H / 2 - nd.y) * 0.0008;
        if (draggingRef.current === nd.id) {
          nd.vx = 0;
          nd.vy = 0;
          continue;
        }
        nd.vx *= 0.85;
        nd.vy *= 0.85;
        nd.x = Math.max(40, Math.min(W - 40, nd.x + nd.vx));
        nd.y = Math.max(40, Math.min(H - 40, nd.y + nd.vy));
      }
      force((f) => f + 1);
      if (++frame < 240) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [indexed, edges]);

  const onPointerDown = (id: string) => (e: RPE<SVGGElement>) => {
    draggingRef.current = id;
    (e.currentTarget as SVGGElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: RPE<SVGSVGElement>) => {
    const id = draggingRef.current;
    const svg = svgRef.current;
    if (!id || !svg) return;
    const rect = svg.getBoundingClientRect();
    const nd = nodesRef.current.get(id);
    if (nd) {
      nd.x = (e.clientX - rect.left) * (W / rect.width);
      nd.y = (e.clientY - rect.top) * (H / rect.height);
      force((f) => f + 1);
    }
  };
  const onPointerUp = () => {
    draggingRef.current = null;
  };

  if (indexed.length === 0) {
    return (
      <div className="canvas-view">
        <div className="empty">
          <p>No indexed papers yet. Open papers to index them and watch the graph fill in.</p>
        </div>
      </div>
    );
  }

  const nodes = nodesRef.current;
  return (
    <div className="canvas-view">
      <header className="lib-header">
        <div className="crumbs">
          <strong>Canvas</strong> <span className="sep">/</span> {indexed.length} papers · {edges.length} links
        </div>
      </header>
      <div className="canvas-wrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="graph"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {edges.map((e, i) => {
            const a = nodes.get(e.a);
            const b = nodes.get(e.b);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#8f897e"
                strokeOpacity={0.2 + e.score * 0.6}
                strokeWidth={1 + e.score * 4}
              >
                <title>{e.shared.join(", ")}</title>
              </line>
            );
          })}
          {indexed.map((p) => {
            const nd = nodes.get(p.id);
            if (!nd) return null;
            return (
              <g
                key={p.id}
                transform={`translate(${nd.x},${nd.y})`}
                className="gnode"
                onPointerDown={onPointerDown(p.id)}
                onDoubleClick={() => onOpen(p.id)}
              >
                <circle r={13} fill={p.color} stroke="#bdb7ab" strokeWidth={1.5} />
                <text x={18} y={4} className="glabel">
                  {p.title.length > 28 ? p.title.slice(0, 28) + "…" : p.title}
                </text>
                <title>{p.title}</title>
              </g>
            );
          })}
        </svg>
        <div className="canvas-hint">Drag to rearrange · double-click a node to open</div>
      </div>
    </div>
  );
}
