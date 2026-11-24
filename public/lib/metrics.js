// Shared by the browser and the Worker: prestige, heat, correlation and deadline maths.

export const CORE_SCORE = { 'A*': 100, A: 80, B: 55, C: 30 };
export const CCF_SCORE = { A: 100, B: 70, C: 40 };

// Citation signal: a venue's OpenAlex h-index on a log scale (h 400+ ≈ 100).
export const citeScore = (h) => Math.min(100, Math.round(100 * Math.log1p(h || 0) / Math.log1p(400)));

// Prestige 0-100: the mean of the signals that exist (CORE rank, CCF rank, citation h-index).
export function prestige(v) {
  const parts = {};
  if (v.core && CORE_SCORE[v.core] != null) parts.core = CORE_SCORE[v.core];
  if (v.ccf && CCF_SCORE[v.ccf] != null) parts.ccf = CCF_SCORE[v.ccf];
  if (v.h_index) parts.cite = citeScore(v.h_index);
  const vals = Object.values(parts);
  return { score: vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0, parts };
}

// How strongly one researcher "goes" to a venue: recent papers count fully, older ones a quarter, saturating at 3.
export const presence = (nRecent, nAll) => Math.min(1, ((nRecent || 0) + 0.25 * Math.max(0, (nAll || 0) - (nRecent || 0))) / 3);

// Heat of a venue = sum over tracked researchers of h-index × presence.
export const heatOf = (links) => Math.round(links.reduce((s, l) => s + (l.h_index || 0) * presence(l.n_recent, l.n_all), 0));

export const SENIOR_H = 30;   // h-index at or above which someone counts as senior

function ranks(xs) {
  const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}

function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

// Spearman rank correlation, with n. null when fewer than 4 pairs or no variance.
export function spearman(pairs) {
  const p = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (p.length < 4) return { rho: null, n: p.length };
  const rho = pearson(ranks(p.map((q) => q[0])), ranks(p.map((q) => q[1])));
  return { rho: rho == null ? null : Math.round(rho * 100) / 100, n: p.length };
}

export function describeRho(rho) {
  if (rho == null) return 'not enough data';
  const a = Math.abs(rho);
  const s = a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'no clear';
  return s === 'no clear' ? 'no clear relationship' : `${s} ${rho > 0 ? 'positive' : 'negative'}`;
}

// '2026-05-07 11:59:59' in 'AoE' / 'UTC+8' / 'UTC-12' -> epoch ms
export function deadlineMs(s, tz) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  let off = 0;
  if (/aoe/i.test(tz || '')) off = -12;
  else { const z = String(tz || '').match(/UTC([+-]\d{1,2})/i); if (z) off = Number(z[1]); }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59), +(m[6] || 59)) - off * 3600e3;
}

const LABELS = { abstract_deadline: 'Abstract', deadline: 'Paper', rebuttal_deadline: 'Rebuttal', decision_deadline: 'Decision' };

// All dated milestones of a conference's editions, sorted.
export function milestones(editions) {
  const out = [];
  for (const e of editions || []) for (const t of e.timeline || []) for (const [k, v] of Object.entries(t)) {
    if (!/deadline/.test(k)) continue;
    const at = deadlineMs(v, e.timezone);
    if (at) out.push({ at, kind: LABELS[k] || k.replace(/_/g, ' '), year: e.year, place: e.place, date: e.date, link: e.link });
  }
  return out.sort((a, b) => a.at - b.at);
}

// The next upcoming submission deadline (abstract or paper), or the latest edition if none is upcoming.
export function nextEdition(editions, now = Date.now()) {
  const subs = milestones(editions).filter((m) => m.kind === 'Abstract' || m.kind === 'Paper');
  const next = subs.find((m) => m.at > now);
  if (next) return { ...next, daysLeft: Math.ceil((next.at - now) / 864e5), upcoming: true };
  // No dates for the next edition yet: estimate from the latest one (same date next year).
  const prev = subs.filter((m) => m.kind === 'Paper').pop() || subs.pop();
  if (prev) {
    let at = prev.at, year = prev.year;
    while (at <= now) { at += 365 * 864e5; year += 1; }
    if (at - now < 400 * 864e5) return { kind: prev.kind, at, year, daysLeft: Math.ceil((at - now) / 864e5), upcoming: true, estimated: true, link: prev.link };
  }
  const last = (editions || [])[editions?.length - 1];
  return last ? { year: last.year, place: last.place, date: last.date, link: last.link, upcoming: false } : null;
}
