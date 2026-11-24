// Small UI helpers: icons, escaping, formatting, toasts, menus, dialogs, charts.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const I = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  people: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.6c1.8.7 3 2.4 3.5 4.9"/>'),
  venue: svg('<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>'),
  upcoming: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h2M14 13.5h2M8 16.5h2"/>'),
  graph: svg('<circle cx="6" cy="7" r="2.3"/><circle cx="18" cy="6" r="2.3"/><circle cx="12" cy="17" r="2.6"/><circle cx="19.5" cy="15.5" r="1.6"/><path d="m8 8.3 2.8 6.4M16.3 7.6l-3 7.3M8.2 6.8l7.5-.6M14.5 16.6l3.6-.8"/>'),
  insights: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9.5 4v16"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.4"'),
  flag: svg('<path d="M5 21V4.5M5 4.5h11l-2 4 2 4H5"/>'),
  flagFill: svg('<path d="M5 21V4.5" /><path d="M5 4.5h11l-2 4 2 4H5z" fill="currentColor"/>'),
  flame: svg('<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.3 2.4-5.4 3.6-8.3.4 1.6 1.2 2.8 2.4 3.6.3-2.7 1.4-5.1 3.6-7.1-.2 3.7 3.4 6 3.4 10.9 0 4.2-2.8 7.1-6.5 7.1z" fill="currentColor" fill-opacity=".25"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5L18.5 7M9 7V4.5h6V7"/>'),
  edit: svg('<path d="M14.5 5.5l4 4L8 20H4v-4z"/><path d="m12.5 7.5 4 4"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  cal: svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8.5 3v4M15.5 3v4"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  pin: svg('<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
  back: svg('<path d="M15 5 8 12l7 7"/>'),
  hash: svg('<path d="M5 9h15M4 15h15M10 3 8 21M16 3l-2 18"/>'),
  sort: svg('<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>'),
  person: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4.2 4.2-6.5 8-6.5s7 2.3 8 6.5"/>'),
  key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>'),
  bolt: svg('<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>'),
  doc: svg('<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
};

export const fmtN = (n) => n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n));
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).filter((c) => /[\p{L}]/u.test(c)).slice(0, 2).join('').toUpperCase() || '?';
export const seniorColor = (h) => h >= 30 ? 'var(--p1)' : h >= 15 ? 'var(--p2)' : 'var(--p3)';
export const coreBadge = (core) => core ? `<span class="badge ${core === 'A*' ? 'astar' : core === 'A' ? 'a' : 'b'}" title="CORE rank">CORE ${esc(core)}</span>` : '';
export const ccfBadge = (ccf) => ccf ? `<span class="badge" title="CCF rank">CCF ${esc(ccf)}</span>` : '';

let toastTimer;
export function toast(msg, { error = false, undo } = {}) {
  const t = document.getElementById('toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">Undo</button>' : ''}`;
  t.className = 'toast' + (error ? ' error' : '');
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), error ? 7000 : undo ? 6000 : 3000);
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Could not reach the server. Check your connection, or whether a blocker is blocking this site.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
  return data;
}

// ---------------------------------------------------------------- overlays
let closeTop = null;
export const hasOverlay = () => Boolean(closeTop);
export function closeOverlay() { if (closeTop) { const f = closeTop; closeTop = null; f(); return true; } return false; }

export function dialog(html, { cls = '', onClose } = {}) {
  closeOverlay();
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = `<div class="dialog ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(o);
  const prev = document.activeElement;
  const close = () => { o.remove(); onClose?.(); prev?.focus?.(); };
  closeTop = close;
  o.addEventListener('mousedown', (e) => { if (e.target === o) closeOverlay(); });
  return { el: o.firstElementChild, close: () => { if (closeTop === close) closeTop = null; close(); } };
}

// A floating menu next to an element: items [{label, icon, key, onClick, cls} | 'hr' | {lbl}]
export function menu(anchor, items) {
  closeOverlay();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = items.map((it, i) => it === 'hr' ? '<hr>' : it.lbl ? `<div class="lbl">${esc(it.lbl)}</div>`
    : `<button type="button" data-i="${i}" class="${it.cls || ''}">${it.icon || ''}<span>${esc(it.label)}</span>${it.key ? `<span class="k">${esc(it.key)}</span>` : ''}</button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8);
  m.style.top = top + 'px';
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  const close = () => { m.remove(); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!m.contains(e.target)) { if (closeTop === close) closeTop = null; close(); } };
  setTimeout(() => document.addEventListener('mousedown', outside, true));
  closeTop = close;
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    if (closeTop === close) closeTop = null;
    close();
    items[+b.dataset.i].onClick?.();
  });
}

// ---------------------------------------------------------------- tiny SVG charts
export function bars(data, { w = 640, h = 120, fmt = fmtN, color = 'var(--accent)' } = {}) {
  if (!data.length) return '';
  const max = Math.max(...data.map((d) => d.v), 1), bw = w / data.length;
  return `<svg viewBox="0 0 ${w} ${h + 18}" role="img">${data.map((d, i) => {
    const bh = Math.max(1, (d.v / max) * (h - 14));
    return `<g><title>${esc(d.label)}: ${fmt(d.v)}</title><rect x="${i * bw + 2}" y="${h - bh}" width="${Math.max(2, bw - 4)}" height="${bh}" rx="2" fill="${color}" opacity=".75"/>
      ${data.length <= 16 || i % 2 === 0 ? `<text x="${i * bw + bw / 2}" y="${h + 13}" text-anchor="middle">${esc(d.label)}</text>` : ''}
      ${d.v === max || data.length <= 8 ? `<text x="${i * bw + bw / 2}" y="${h - bh - 3}" text-anchor="middle">${fmt(d.v)}</text>` : ''}</g>`;
  }).join('')}</svg>`;
}

// points: [{x, y, label, cls, href}]
export function scatter(points, { w = 640, h = 300, xLabel = '', yLabel = '', logX = false, fit = false } = {}) {
  const P = 36, tx = (x) => logX ? Math.log10(1 + x) : x;
  const xs = points.map((p) => tx(p.x)), ys = points.map((p) => p.y);
  let x0 = Math.min(...xs, 0), x1 = Math.max(...xs, 1), y0 = 0, y1 = Math.max(...ys, 1);
  if (fit) { const px = (Math.max(...xs) - Math.min(...xs)) * 0.1 || 1, py = (Math.max(...ys) - Math.min(...ys)) * 0.15 || 1; x0 = Math.min(...xs) - px; x1 = Math.max(...xs) + px; y0 = Math.min(...ys) - py; y1 = Math.max(...ys) + py; }
  const sx = (x) => P + ((tx(x) - x0) / (x1 - x0 || 1)) * (w - P - 12), sy = (y) => h - P + 8 - ((y - y0) / (y1 - y0 || 1)) * (h - P - 8);
  const top = [...points].sort((a, b) => b.y - a.y).slice(0, 8);
  return `<svg class="scatter" viewBox="0 0 ${w} ${h}" role="img">
    <line class="axis" x1="${P}" y1="${h - P + 8}" x2="${w - 8}" y2="${h - P + 8}"/><line class="axis" x1="${P}" y1="8" x2="${P}" y2="${h - P + 8}"/>
    <text x="${w - 8}" y="${h - 4}" text-anchor="end">${esc(xLabel)}${logX ? ' (log)' : ''}</text>
    <text x="${P + 6}" y="12">${esc(yLabel)}</text>${fit ? `<text x="${P - 4}" y="${h - P + 8}" text-anchor="end">${Math.round(y0)}</text><text x="${P - 4}" y="16" text-anchor="end">${Math.round(y1)}</text>` : ''}
    ${points.map((p) => `<a href="${esc(p.href || '#')}"><circle class="${p.cls || ''}" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="${p.r || 5}"><title>${esc(p.label)}: ${p.x}, ${p.y}</title></circle></a>`).join('')}
    ${top.map((p) => `<text class="lab" x="${(sx(p.x) + 7).toFixed(1)}" y="${(sy(p.y) + 3).toFixed(1)}">${esc(p.label)}</text>`).join('')}
  </svg>`;
}
