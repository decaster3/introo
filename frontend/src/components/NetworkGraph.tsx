import { useRef, useEffect, useMemo, useCallback, useState, memo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { MergedCompany } from '../types';

interface Props {
  companies: MergedCompany[];
  onCompanyClick?: (company: MergedCompany) => void;
}

interface GraphNode {
  id: string;
  label: string;
  color: string;
  glow: string;
  radius: number;
  strength: string;
  company: MergedCompany;
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string;
  target: string;
  weight: number;
}

const COLORS: Record<string, [string, string]> = {
  strong: ['#34d399', 'rgba(52,211,153,0.6)'],
  medium: ['#fbbf24', 'rgba(251,191,36,0.5)'],
  weak:   ['#64748b', 'rgba(100,116,139,0.35)'],
  none:   ['#5b8def', 'rgba(91,141,239,0.5)'],
};

const MAX_NODES = 300;

function buildGraphData(companies: MergedCompany[]) {
  const sorted = [...companies].sort((a, b) => b.totalCount - a.totalCount);
  const subset = sorted.slice(0, MAX_NODES);
  if (subset.length === 0) return { nodes: [], links: [] };

  const maxCount = Math.max(...subset.map(c => c.totalCount), 1);
  const domainSet = new Set(subset.map(c => c.domain));

  const nodes: GraphNode[] = subset.map(c => {
    const t = Math.log(c.totalCount + 1) / Math.log(maxCount + 1);
    const radius = 4 + t * 14;
    const [color, glow] = COLORS[c.bestStrength] || COLORS.none;
    return {
      id: c.domain,
      label: c.name,
      color, glow, radius,
      strength: c.bestStrength,
      company: c,
    };
  });

  const links: GraphLink[] = [];
  const linkSet = new Set<string>();
  const addLink = (a: string, b: string, w: number) => {
    if (a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (linkSet.has(key)) return;
    linkSet.add(key);
    links.push({ source: a, target: b, weight: w });
  };

  const connMap = new Map<string, string[]>();
  subset.forEach(c => {
    c.connectionIds.forEach(cid => {
      if (!connMap.has(cid)) connMap.set(cid, []);
      connMap.get(cid)!.push(c.domain);
    });
  });
  connMap.forEach(domains => {
    if (domains.length > 25) return;
    for (let a = 0; a < domains.length; a++)
      for (let b = a + 1; b < domains.length; b++)
        if (domainSet.has(domains[a]) && domainSet.has(domains[b]))
          addLink(domains[a], domains[b], 1);
  });

  const spaceMap = new Map<string, string[]>();
  subset.forEach(c => {
    c.spaceIds.forEach(sid => {
      if (!spaceMap.has(sid)) spaceMap.set(sid, []);
      spaceMap.get(sid)!.push(c.domain);
    });
  });
  spaceMap.forEach(domains => {
    if (domains.length > 20) {
      domains.forEach(a => {
        const others = domains.filter(b => b !== a);
        const pick = others.sort(() => Math.random() - 0.5).slice(0, 2);
        pick.forEach(b => { if (domainSet.has(a) && domainSet.has(b)) addLink(a, b, 0.4); });
      });
    } else {
      for (let a = 0; a < domains.length; a++)
        for (let b = a + 1; b < domains.length; b++)
          if (domainSet.has(domains[a]) && domainSet.has(domains[b]))
            addLink(domains[a], domains[b], 0.6);
    }
  });

  const indMap = new Map<string, string[]>();
  subset.forEach(c => {
    if (!c.industry) return;
    const key = c.industry.toLowerCase();
    if (!indMap.has(key)) indMap.set(key, []);
    indMap.get(key)!.push(c.domain);
  });
  indMap.forEach(domains => {
    if (domains.length < 2 || domains.length > 20) return;
    for (let a = 0; a < domains.length; a++)
      for (let b = a + 1; b < domains.length; b++)
        addLink(domains[a], domains[b], 0.15);
  });

  return { nodes, links };
}

function NetworkGraphInner({ companies, onCompanyClick }: Props) {
  const fgRef = useRef<any>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const hoverNode = useRef<string | null>(null);

  const graphData = useMemo(() => buildGraphData(companies), [companies]);

  // Build adjacency for hover highlighting
  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    graphData.links.forEach(l => {
      const sid = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tid = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (!adj.has(sid)) adj.set(sid, new Set());
      if (!adj.has(tid)) adj.set(tid, new Set());
      adj.get(sid)!.add(tid);
      adj.get(tid)!.add(sid);
    });
    return adj;
  }, [graphData]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => {
      const rect = wrap.getBoundingClientRect();
      setSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || graphData.nodes.length === 0) return;
    const timer = setTimeout(() => fg.zoomToFit(400, 60), 2000);
    return () => clearTimeout(timer);
  }, [graphData]);

  const nodeCanvasObject = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as GraphNode;
    const hId = hoverNode.current;
    const isHovered = hId === n.id;
    const isNeighbor = hId ? adjacency.get(hId)?.has(n.id) : false;
    const dimming = hId !== null;
    const dim = dimming && !isHovered && !isNeighbor;

    const r = isHovered ? n.radius * 1.2 : n.radius;

    // Glow
    ctx.shadowColor = n.glow;
    ctx.shadowBlur = (isHovered ? 18 : isNeighbor ? 10 : 6) / globalScale;
    ctx.globalAlpha = dim ? 0.15 : isHovered ? 1 : isNeighbor ? 0.95 : 0.85;
    ctx.fillStyle = n.color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();

    // Core
    ctx.shadowBlur = 0;
    ctx.globalAlpha = dim ? 0.05 : isHovered ? 0.7 : 0.3;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(node.x, node.y, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Always show labels for nodes big enough, or when hovered/neighbor
    const showLabel = isHovered || isNeighbor || n.radius >= 6 || globalScale > 2.5;
    if (showLabel && !dim) {
      const fontSize = Math.min(14, Math.max(3, n.radius * 0.9)) / globalScale;
      ctx.font = `${isHovered ? 600 : 500} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = isHovered ? '#fff' : `rgba(255,255,255,${isNeighbor ? 0.8 : 0.55})`;
      ctx.fillText(n.label, node.x, node.y + r + 2 / globalScale);
    }
  }, [adjacency]);

  const nodePointerAreaPaint = useCallback((node: any, color: string, ctx: CanvasRenderingContext2D) => {
    const r = Math.max((node as GraphNode).radius + 4, 8);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
    ctx.fill();
  }, []);

  const linkCanvasObject = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const src = link.source;
    const tgt = link.target;
    if (!src || !tgt || src.x == null || tgt.x == null) return;

    const hId = hoverNode.current;
    const srcId = src.id || src;
    const tgtId = tgt.id || tgt;
    const isLit = hId !== null && (srcId === hId || tgtId === hId);
    const dimming = hId !== null;
    const w = (link as GraphLink).weight || 0.1;

    if (dimming && !isLit) {
      ctx.strokeStyle = 'rgba(255,255,255,0.01)';
      ctx.lineWidth = 0.2 / globalScale;
    } else if (isLit) {
      ctx.strokeStyle = `rgba(180,200,240,0.4)`;
      ctx.lineWidth = (1 + w * 1.5) / globalScale;
    } else {
      ctx.strokeStyle = `rgba(140,160,200,${0.06 + w * 0.08})`;
      ctx.lineWidth = (0.4 + w * 0.8) / globalScale;
    }

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.stroke();
  }, []);

  const onNodeHover = useCallback((node: any) => {
    hoverNode.current = node ? (node as GraphNode).id : null;
  }, []);

  const onNodeClick = useCallback((node: any) => {
    if (onCompanyClick) onCompanyClick((node as GraphNode).company);
  }, [onCompanyClick]);

  const nodeLabel = useCallback((node: any) => {
    const n = node as GraphNode;
    const c = n.company;
    const parts = [`<div style="font-weight:600;font-size:13px;margin-bottom:4px">${n.label}</div>`];
    const sub = [c.industry, c.city].filter(Boolean).join(' · ');
    if (sub) parts.push(`<div style="opacity:0.55;font-size:11px;margin-bottom:2px">${sub}</div>`);
    parts.push(`<div style="color:${n.color};font-size:11px">${c.totalCount} contact${c.totalCount !== 1 ? 's' : ''}</div>`);
    if (c.employeeCount) parts.push(`<div style="opacity:0.4;font-size:10px">${c.employeeCount.toLocaleString()} employees</div>`);
    return `<div style="padding:2px 0">${parts.join('')}</div>`;
  }, []);

  return (
    <div ref={wrapRef} className="u-network-graph">
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={nodeCanvasObject}
        nodePointerAreaPaint={nodePointerAreaPaint}
        nodeLabel={nodeLabel}
        linkCanvasObject={linkCanvasObject}
        linkDirectionalParticles={0}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        cooldownTicks={200}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
        warmupTicks={50}
      />
    </div>
  );
}

export default memo(NetworkGraphInner);
