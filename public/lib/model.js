// Shared by the browser and the Worker: turns raw state rows into venue rows with heat, prestige and deadlines.
import { prestige, heatOf, presence, spearman, describeRho, nextEdition, SENIOR_H } from './metrics.js';

const J = (s, d = []) => { if (s && typeof s === 'object') return s; try { return s ? JSON.parse(s) : d; } catch { return d; } };

// Venue rows with computed heat / prestige / next deadline (used by MCP and insights).
export function computeVenues(st) {
  const hBy = new Map(st.researchers.map((r) => [r.id, r]));
  const byVenue = new Map();
  for (const l of st.links) {
    const r = hBy.get(l.author_id);
    if (!r) continue;
    (byVenue.get(l.venue_id) || byVenue.set(l.venue_id, []).get(l.venue_id)).push({ ...l, h_index: r.h_index, name: r.name });
  }
  return st.venues.map((v) => {
    const ls = byVenue.get(v.id) || [];
    const going = ls.filter((l) => presence(l.n_recent, l.n_all) > 0);
    const p = prestige(v);
    return {
      ...v, editions: J(v.editions), accept: J(v.accept, null), heat: heatOf(ls), prestige: p.score, prestige_parts: p.parts,
      people: going.length, seniors: going.filter((l) => l.h_index >= SENIOR_H).length,
      recent_people: ls.filter((l) => l.n_recent > 0).sort((a, b) => b.h_index - a.h_index).map((l) => ({ id: l.author_id, name: l.name, h_index: l.h_index, n_recent: l.n_recent, n_all: l.n_all })),
      next: nextEdition(J(v.editions)),
    };
  });
}

export function insights(st, venues = computeVenues(st)) {
  const vs = venues.filter((v) => v.people > 0);
  const byId = new Map(venues.map((v) => [v.id, v]));
  // Researcher-level: does a higher h-index go with publishing at more prestigious venues?
  const rv = st.researchers.map((r) => {
    const ls = st.links.filter((l) => l.author_id === r.id && l.n_recent > 0);
    const w = ls.reduce((s, l) => s + l.n_recent, 0);
    const avg = w ? ls.reduce((s, l) => s + (byId.get(l.venue_id)?.prestige || 0) * l.n_recent, 0) / w : null;
    return { id: r.id, name: r.name, h_index: r.h_index, venue_prestige: avg == null ? null : Math.round(avg) };
  });
  const corr = (label, pairs) => { const s = spearman(pairs); return { label, ...s, reading: describeRho(s.rho) }; };
  const coreScore = (v) => ({ 'A*': 4, A: 3, B: 2, C: 1 })[v.core];
  return {
    correlations: [
      corr('Venue citation h-index vs heat (where your tracked people go)', vs.map((v) => [v.h_index, v.heat])),
      corr('CORE rank vs heat', vs.filter((v) => v.core).map((v) => [coreScore(v), v.heat])),
      corr('Venue citation h-index vs CORE rank (do citations agree with the ranking?)', vs.filter((v) => v.core).map((v) => [v.h_index, coreScore(v)])),
      corr('Researcher h-index vs prestige of the venues they publish at', rv.filter((r) => r.venue_prestige != null).map((r) => [r.h_index, r.venue_prestige])),
      corr('Your priority vs heat', vs.filter((v) => v.priority < 4).map((v) => [5 - v.priority, v.heat])),
    ],
    hot: [...vs].sort((a, b) => b.heat - a.heat).slice(0, 15).map((v) => ({ id: v.id, name: v.conf_title || v.abbr || v.name, heat: v.heat, people: v.people,
      seniors: v.seniors, prestige: v.prestige, core: v.core, next: v.next })),
    researchers: rv,
  };
}

