// Obsidian-style force graph of researchers, venues and (optionally) fields. Uses the vendored force-graph (MIT).
import { SENIOR_H, presence } from '/lib/metrics.js';

let lib;
function loadLib() {
  if (window.ForceGraph) return Promise.resolve(window.ForceGraph);
  return lib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/vendor/force-graph.min.js';
    s.onload = () => resolve(window.ForceGraph);
    s.onerror = () => reject(new Error('Could not load the graph library.'));
    document.head.append(s);
  });
}

let instance;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#999';

export async function renderGraph(el, S, { fields = false, recent = true, minor = false, onOpen }) {
  const ForceGraph = await loadLib();
  const nodes = [], links = [];
  const seen = new Set();
  for (const r of S.researchers) {
    nodes.push({ id: r.id, kind: 'r', label: r.name, val: 1 + Math.min(5, r.h_index / 40), senior: r.h_index >= SENIOR_H, href: '#/r/' + r.id });
    seen.add(r.id);
  }
  for (const l of S.links) {
    if (recent ? l.n_recent === 0 : presence(l.n_recent, l.n_all) === 0) continue;
    const v = S.vById.get(l.venue_id);
    if (!v || !seen.has(l.author_id)) continue;
    if (!minor && v.priority === 4 && !v.conf_key && v.people < 2) continue;
    if (!seen.has(v.id)) {
      seen.add(v.id);
      nodes.push({ id: v.id, kind: 'v', label: v.conf_title || v.abbr || v.name, val: 1 + Math.min(8, Math.sqrt(v.heat || 1) / 4), priority: v.priority, href: '#/v/' + v.id });
    }
    links.push({ source: l.author_id, target: v.id, w: recent ? l.n_recent : l.n_all });
  }
  if (fields) {
    for (const r of S.researchers) for (const t of r.topics.slice(0, 3)) {
      const id = 'T:' + t.name;
      if (!seen.has(id)) { seen.add(id); nodes.push({ id, kind: 't', label: t.name, val: 1.5 }); }
      links.push({ source: r.id, target: id, w: 1, field: true });
    }
  }
  const colors = { r: css('--p3'), senior: css('--p1'), v: '#8a63d2', t: '#24a47f', p1: css('--p1'), p2: css('--p2'), p3: css('--p3'), text: css('--text'), line: css('--border'), bg: css('--bg') };
  if (!instance || !el.contains(instance._el)) {
    el.innerHTML = '';
    const holder = document.createElement('div');
    el.append(holder);
    instance = ForceGraph()(holder);
    instance._el = holder;
  }
  const g = instance;
  let hover = null;
  const neighbors = new Map();
  for (const l of links) {
    const a = l.source.id || l.source, b = l.target.id || l.target;
    (neighbors.get(a) || neighbors.set(a, new Set()).get(a)).add(b);
    (neighbors.get(b) || neighbors.set(b, new Set()).get(b)).add(a);
  }
  const lit = (id) => !hover || hover === id || neighbors.get(hover)?.has(id);
  g.width(el.clientWidth).height(el.clientHeight).backgroundColor(colors.bg)
    .graphData({ nodes, links })
    .nodeId('id').nodeVal('val').nodeLabel((n) => n.label)
    .linkColor((l) => { const a = l.source.id || l.source, b = l.target.id || l.target; return hover && (a === hover || b === hover) ? colors.text : colors.line; })
    .linkWidth((l) => (l.field ? 0.5 : Math.min(3, 0.4 + l.w * 0.3)))
    .nodeCanvasObject((n, ctx, scale) => {
      const r = Math.sqrt(n.val) * 3;
      ctx.globalAlpha = lit(n.id) ? 1 : 0.15;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = n.kind === 'r' ? (n.senior ? colors.senior : colors.r) : n.kind === 't' ? colors.t : colors.v;
      ctx.fill();
      if (n.kind === 'v' && n.priority < 4) { ctx.lineWidth = 2 / scale * 1.5; ctx.strokeStyle = colors['p' + n.priority]; ctx.stroke(); }
      const show = hover === n.id || scale > 2.2 || n.kind === 'r' || (n.kind === 'v' && (n.val > 3 || scale > 1.2)) || (n.kind === 't' && scale > 1.2);
      if (show) {
        const fs = Math.max(10 / scale, 2.5);
        ctx.font = `${n.kind === 'v' ? 600 : 400} ${fs}px -apple-system, sans-serif`;
        ctx.fillStyle = colors.text;
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + r + fs);
      }
      ctx.globalAlpha = 1;
    })
    .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, Math.sqrt(n.val) * 3 + 2, 0, 2 * Math.PI); ctx.fill(); })
    .onNodeHover((n) => { hover = n?.id || null; el.style.cursor = n?.href ? 'pointer' : ''; })
    .onNodeClick((n) => n.href && onOpen(n.href))
    .cooldownTicks(200);
  g.d3Force('charge').strength(-110);
  g.d3Force('link').distance((l) => (l.field ? 40 : 55));
  setTimeout(() => g.zoomToFit(400, 60), 900);
  const ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight));
  ro.observe(el);
}
