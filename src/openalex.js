// OpenAlex + link resolution + ingestion. Everything here is public bibliometric data.
// Free-plan friendly: every call uses select= or group_by so responses stay small (Worker CPU ~10 ms),
// and one researcher costs ~7 subrequests (limit 50).

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const OA = 'https://api.openalex.org';
const UA = 'confmap/1.0 (research venue explorer)';
export const short = (id) => String(id || '').replace(/^https?:\/\/openalex\.org\//, '');

export async function oa(env, path, params = {}) {
  const u = new URL(OA + path);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
  if (env.OPENALEX_KEY) u.searchParams.set('api_key', env.OPENALEX_KEY);
  const res = await (env.fetch || fetch)(u, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (res.status === 429 || res.status === 402) throw new HttpError(503, 'OpenAlex daily budget is used up. Add an OPENALEX_KEY secret (free) or try again tomorrow.');
  if (!res.ok) throw new HttpError(502, `OpenAlex returned ${res.status}.`);
  return res.json();
}

// ---------------------------------------------------------------- conference matching

const STOP = new Set(['proceedings', 'proc', 'of', 'the', 'on', 'in', 'and', 'for', 'annual', 'international', 'intl', 'conference',
  'conf', 'ieee', 'acm', 'usenix', 'cvf', 'computer', 'society', 'joint', 'meeting', 'symposium', 'workshop', 'a', 'an', 'at', 'to']);
export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ')
  .replace(/'\d{2}\b/g, ' ').replace(/\b\d+(st|nd|rd|th)?\b/g, ' ').replace(/[^a-z]+/g, ' ')
  .split(' ').filter((w) => w && !STOP.has(w)).sort().join(' ');

const abbrevs = (names) => {
  const out = new Set();
  for (const n of names) {
    for (const m of String(n).matchAll(/\(([A-Z][A-Za-z0-9&-]{1,14})\)/g)) out.add(m[1].toLowerCase());
    const m = String(n).match(/[-–] ([A-Z][A-Za-z0-9-]{1,12})\s*'?\d{0,4}\s*$/);
    if (m) out.add(m[1].toLowerCase());
    if (/^[A-Z][A-Za-z0-9-]{1,10}$/.test(n)) out.add(n.toLowerCase());
  }
  return out;
};

// confs: [{key, title, description}]  ->  matcher(sourceNames[]) -> conf key | null
export function confMatcher(confs) {
  const byNorm = new Map(), byAbbr = new Map();
  for (const c of confs) {
    const n = norm(c.description);
    if (n && n.includes(' ')) byNorm.set(n, c.key);
    byAbbr.set(String(c.title).toLowerCase(), byAbbr.has(String(c.title).toLowerCase()) ? null : c.key);
  }
  return (names) => {
    for (const name of names) for (const part of String(name).split('/')) {
      const k = byNorm.get(norm(part));
      if (k) return k;
    }
    for (const a of abbrevs(names)) if (byAbbr.get(a)) return byAbbr.get(a);
    return null;
  };
}

// ---------------------------------------------------------------- resolving a link or name

const AUTHOR_SELECT = 'id,display_name,orcid,summary_stats,works_count,cited_by_count,last_known_institutions,topics,counts_by_year';

export const candidate = (a) => ({
  id: short(a.id), name: a.display_name, institution: a.last_known_institutions?.[0]?.display_name || null,
  h_index: a.summary_stats?.h_index || 0, works: a.works_count || 0, cited_by: a.cited_by_count || 0,
  topics: (a.topics || []).slice(0, 3).map((t) => t.display_name),
});

async function searchByName(env, name, via) {
  const clean = String(name).replace(/\s+/g, ' ').trim().slice(0, 120);
  if (clean.length < 3) throw new HttpError(400, 'Give a profile link or a full name.');
  const r = await oa(env, '/authors', { search: clean, per_page: 8, select: 'id,display_name,summary_stats,works_count,cited_by_count,last_known_institutions,topics' });
  const list = (r?.results || []).map(candidate).sort((a, b) => b.h_index - a.h_index);
  if (!list.length) throw new HttpError(404, `No researcher named "${clean}" found in OpenAlex.`);
  const [a, b] = list;
  // Pick automatically only when one profile clearly dominates (OpenAlex often splits a person into small stubs).
  if (list.length === 1 || (a.h_index >= 10 && a.h_index >= 3 * (b.h_index || 0))) return { id: a.id, via };
  return { candidates: list, query: clean, via };
}

const pick = (re, s) => (String(s).match(re) || [])[1];

async function fetchText(env, url, max = 200_000) {
  const res = await (env.fetch || fetch)(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; confmap/1.0)', Accept: 'text/html,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new HttpError(422, `Could not open that page (${res.status}).`);
  // Read at most `max` bytes: big publication pages would otherwise cost CPU and time.
  const reader = res.body.getReader(), chunks = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(size); let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return new TextDecoder().decode(buf).slice(0, max);
}

// Turns whatever the user pasted into { id } or { candidates }.
export async function resolveAuthor(env, input, depth = 0) {
  const s = String(input || '').trim();
  if (!s) throw new HttpError(400, 'Paste a profile link or a name.');
  let id = pick(/openalex\.org\/(?:authors\/)?(A\d{5,})/i, s) || pick(/^(A\d{5,})$/i, s);
  if (id) return { id: id.toUpperCase(), via: 'openalex' };

  const orcid = pick(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i, s);
  if (orcid) {
    const a = await oa(env, `/authors/orcid:${orcid}`, { select: 'id' });
    if (a?.id) return { id: short(a.id), via: 'orcid' };
    if (!/^https?:/.test(s) || /orcid\.org/.test(s)) throw new HttpError(404, 'That ORCID is not linked to an OpenAlex profile yet. Try the name instead.');
  }

  const s2 = pick(/semanticscholar\.org\/author\/(?:[^/?#]+\/)?(\d+)/i, s);
  if (s2) {
    const r = await (env.fetch || fetch)(`https://api.semanticscholar.org/graph/v1/author/${s2}?fields=name,externalIds,affiliations`);
    if (!r.ok) throw new HttpError(422, 'Semantic Scholar did not answer. Try the name instead.');
    const a = await r.json();
    const o = a.externalIds?.ORCID;
    if (o) { const hit = await oa(env, `/authors/orcid:${o}`, { select: 'id' }); if (hit?.id) return { id: short(hit.id), via: 'semanticscholar' }; }
    return searchByName(env, a.name, 'semanticscholar');
  }

  if (/scholar\.google\./i.test(s)) {
    let html = '';
    try { html = await fetchText(env, s); } catch { /* Scholar often blocks servers */ }
    const name = pick(/id="gsc_prf_in"[^>]*>([^<]+)</, html);
    if (!name) throw new HttpError(422, 'Google Scholar blocks automated reads. Paste the name, ORCID or OpenAlex link instead.');
    return searchByName(env, decodeEntities(name), 'scholar');
  }

  if (/^https?:\/\//i.test(s)) {
    if (/dblp\.(org|uni-trier\.de)/i.test(s)) {
      const html = await fetchText(env, s).catch(() => '');
      const name = pick(/<span class="name primary" itemprop="name">([^<]+)</, html) || pick(/<title>dblp: ([^<]+)<\/title>/, html);
      if (!name) throw new HttpError(422, 'dblp blocked the read. Paste the name instead.');
      return searchByName(env, decodeEntities(name), 'dblp');
    }
    // A personal homepage: look for profile links on it, else use the page title as the name.
    const html = await fetchText(env, s);
    if (depth === 0) {
      const link = pick(/(https?:\/\/(?:www\.)?openalex\.org\/(?:authors\/)?A\d+)/i, html) || pick(/(https?:\/\/orcid\.org\/\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i, html)
        || pick(/(https?:\/\/(?:www\.)?semanticscholar\.org\/author\/[^"'\s<>]+)/i, html);
      if (link) { try { return await resolveAuthor(env, link, 1); } catch { /* fall through to the title */ } }
    }
    const title = decodeEntities(pick(/<title[^>]*>([^<]{2,200})<\/title>/i, html) || '')
      .split(/[|\-–—:·]/)[0].replace(/(?:'s)?\s*(home ?page|website|personal site|homepage)\s*$/i, '').replace(/^(prof\.?|dr\.?|professor)\s+/i, '').trim();
    if (!title || title.split(' ').length > 5) throw new HttpError(422, 'Could not find a name on that page. Paste the name instead.');
    return searchByName(env, title, 'homepage');
  }
  return searchByName(env, s, 'name');
}

const decodeEntities = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();

// ---------------------------------------------------------------- ingestion

const WORK_SELECT = 'id,title,publication_year,cited_by_count,primary_location,doi';
const keepVenue = (src) => src && (src.type === 'conference' || src.type === 'journal');

const workRow = (w) => ({
  id: short(w.id), title: w.title || '(untitled)', year: w.publication_year, cites: w.cited_by_count || 0,
  venue_id: keepVenue(w.primary_location?.source) ? short(w.primary_location.source.id) : null,
  venue: w.primary_location?.source?.display_name || null,
  url: w.doi || w.primary_location?.landing_page_url || `https://openalex.org/${short(w.id)}`,
});

export async function loadVenues(env, ids) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await oa(env, '/sources', { filter: 'ids.openalex:' + ids.slice(i, i + 50).join('|'), per_page: 50,
      select: 'id,display_name,alternate_titles,abbreviated_title,type,summary_stats,works_count,cited_by_count,homepage_url' });
    out.push(...(r?.results || []));
  }
  const confs = (await env.DB.prepare('SELECT key, title, description FROM confs').all()).results;
  const match = confMatcher(confs);
  return out.filter(keepVenue).map((s) => {
    const names = [s.display_name, ...(s.alternate_titles || []), s.abbreviated_title].filter(Boolean);
    const conf_key = match(names);
    const ab = s.abbreviated_title || [...abbrevs(names)][0];
    return {
      id: short(s.id), name: s.display_name, abbr: conf_key ? confs.find((c) => c.key === conf_key).title : ab ? ab.toUpperCase() : null,
      type: s.type, h_index: s.summary_stats?.h_index || 0, mean2yr: s.summary_stats?.['2yr_mean_citedness'] || 0,
      works_count: s.works_count || 0, cited_by: s.cited_by_count || 0, homepage: s.homepage_url || null, conf_key,
    };
  });
}

const upsertVenuesSql = `INSERT INTO venues (id, name, abbr, type, h_index, mean2yr, works_count, cited_by, homepage, conf_key, fetched_at)
  SELECT j.value->>'id', j.value->>'name', j.value->>'abbr', j.value->>'type', j.value->>'h_index', j.value->>'mean2yr',
    j.value->>'works_count', j.value->>'cited_by', j.value->>'homepage', j.value->>'conf_key', ?2 FROM json_each(?1) j WHERE true
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, abbr = excluded.abbr, type = excluded.type, h_index = excluded.h_index,
    mean2yr = excluded.mean2yr, works_count = excluded.works_count, cited_by = excluded.cited_by, homepage = excluded.homepage,
    conf_key = excluded.conf_key, fetched_at = excluded.fetched_at`;

export const upsertVenues = (env, venues) => env.DB.prepare(upsertVenuesSql).bind(JSON.stringify(venues), Date.now());

export async function ingestAuthor(env, id, now = new Date()) {
  const recentFrom = now.getUTCFullYear() - 3;
  const f = `author.id:${id}`;
  const [a, all, recent, top, latest, kw] = await Promise.all([
    oa(env, `/authors/${id}`, { select: AUTHOR_SELECT }),
    oa(env, '/works', { filter: f, group_by: 'primary_location.source.id', per_page: 100 }),
    oa(env, '/works', { filter: `${f},publication_year:>${recentFrom - 1}`, group_by: 'primary_location.source.id', per_page: 100 }),
    oa(env, '/works', { filter: f, sort: 'cited_by_count:desc', per_page: 15, select: WORK_SELECT }),
    oa(env, '/works', { filter: f, sort: 'publication_date:desc', per_page: 15, select: WORK_SELECT }),
    oa(env, '/works', { filter: `${f},publication_year:>${recentFrom - 3}`, group_by: 'keywords.id', per_page: 30 }),
  ]);
  if (!a) throw new HttpError(404, `OpenAlex has no author ${id}.`);

  const counts = new Map();
  for (const g of all?.group_by || []) if (g.key && g.key !== 'unknown') counts.set(short(g.key), { a: g.count, r: 0 });
  for (const g of recent?.group_by || []) if (g.key && g.key !== 'unknown') counts.set(short(g.key), { a: counts.get(short(g.key))?.a ?? g.count, r: g.count });
  const ranked = [...counts.entries()].sort((x, y) => (y[1].r * 3 + y[1].a) - (x[1].r * 3 + x[1].a)).slice(0, 60);

  // Refresh venue metadata only when missing or older than 30 days.
  const ids = ranked.map(([v]) => v);
  const known = new Map((await env.DB.prepare(`SELECT id, fetched_at FROM venues WHERE id IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(ids)).all()).results.map((r) => [r.id, r.fetched_at]));
  const stale = ids.filter((v) => !known.has(v) || known.get(v) < Date.now() - 30 * 864e5);
  const fresh = await loadVenues(env, stale);
  const valid = new Set([...ids.filter((v) => known.has(v)), ...fresh.map((v) => v.id)]);

  const author = {
    id: short(a.id), name: a.display_name, orcid: a.orcid ? a.orcid.replace('https://orcid.org/', '') : null,
    institution: a.last_known_institutions?.[0]?.display_name || null, country: a.last_known_institutions?.[0]?.country_code || null,
    h_index: a.summary_stats?.h_index || 0, i10_index: a.summary_stats?.i10_index || 0, cited_by: a.cited_by_count || 0,
    works_count: a.works_count || 0, mean2yr: a.summary_stats?.['2yr_mean_citedness'] || 0,
    topics: (a.topics || []).slice(0, 10).map((t) => ({ name: t.display_name, subfield: t.subfield?.display_name, field: t.field?.display_name, count: t.count })),
    keywords: (kw?.group_by || []).filter((g) => g.key_display_name).slice(0, 25).map((g) => ({ name: g.key_display_name, count: g.count })),
    by_year: (a.counts_by_year || []).map((y) => ({ year: y.year, works: y.works_count, cites: y.cited_by_count })).sort((x, y) => x.year - y.year),
  };
  if (author.id !== id) id = author.id;   // merged profiles redirect
  const links = ranked.filter(([v]) => valid.has(v)).map(([v, c]) => ({ v, a: c.a, r: c.r }));
  const works = [...(top?.results || []).map((w) => ({ ...workRow(w), kind: 'top' })), ...(latest?.results || []).map((w) => ({ ...workRow(w), kind: 'recent' }))]
    .map((w) => ({ ...w, venue_id: w.venue_id && valid.has(w.venue_id) ? w.venue_id : null }));

  await env.DB.batch([
    upsertVenues(env, fresh),
    env.DB.prepare(`INSERT INTO authors (id, name, orcid, institution, country, h_index, i10_index, cited_by, works_count, mean2yr, topics, keywords, by_year, fetched_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      ON CONFLICT (id) DO UPDATE SET name = excluded.name, orcid = excluded.orcid, institution = excluded.institution, country = excluded.country,
        h_index = excluded.h_index, i10_index = excluded.i10_index, cited_by = excluded.cited_by, works_count = excluded.works_count,
        mean2yr = excluded.mean2yr, topics = excluded.topics, keywords = excluded.keywords, by_year = excluded.by_year, fetched_at = excluded.fetched_at`)
      .bind(author.id, author.name, author.orcid, author.institution, author.country, author.h_index, author.i10_index, author.cited_by,
        author.works_count, author.mean2yr, JSON.stringify(author.topics), JSON.stringify(author.keywords), JSON.stringify(author.by_year), Date.now()),
    env.DB.prepare('DELETE FROM author_venues WHERE author_id = ?').bind(author.id),
    env.DB.prepare(`INSERT INTO author_venues (author_id, venue_id, n_all, n_recent)
      SELECT ?1, j.value->>'v', j.value->>'a', j.value->>'r' FROM json_each(?2) j`).bind(author.id, JSON.stringify(links)),
    env.DB.prepare('DELETE FROM works WHERE author_id = ?').bind(author.id),
    env.DB.prepare(`INSERT OR IGNORE INTO works (id, author_id, kind, title, year, cites, venue_id, venue, url)
      SELECT j.value->>'id', ?1, j.value->>'kind', j.value->>'title', j.value->>'year', j.value->>'cites', j.value->>'venue_id', j.value->>'venue', j.value->>'url'
      FROM json_each(?2) j`).bind(author.id, JSON.stringify(works)),
  ]);
  return author;
}

// Who publishes at a venue lately, ranked by h-index. Cached for 14 days.
export async function venuePeople(env, venueId, force = false) {
  const v = await env.DB.prepare('SELECT people, people_at FROM venues WHERE id = ?').bind(venueId).first();
  if (!v) throw new HttpError(404, 'Unknown venue.');
  if (!force && v.people && v.people_at > Date.now() - 14 * 864e5) return JSON.parse(v.people);
  const from = new Date().getUTCFullYear() - 2;
  const g = await oa(env, '/works', { filter: `primary_location.source.id:${venueId},publication_year:>${from - 1}`, group_by: 'authorships.author.id', per_page: 50 });
  const counts = new Map((g?.group_by || []).filter((x) => x.key && x.key !== 'unknown').map((x) => [short(x.key), x.count]));
  let people = [];
  if (counts.size) {
    const r = await oa(env, '/authors', { filter: 'ids.openalex:' + [...counts.keys()].join('|'), per_page: 50,
      select: 'id,display_name,summary_stats,works_count,cited_by_count,last_known_institutions' });
    people = (r?.results || []).map((a) => ({ ...candidate(a), papers: counts.get(short(a.id)) || 0 }))
      .map(({ topics, ...p }) => p).sort((a, b) => b.h_index - a.h_index).slice(0, 40);
  }
  await env.DB.prepare('UPDATE venues SET people = ?, people_at = ? WHERE id = ?').bind(JSON.stringify(people), Date.now(), venueId).run();
  return people;
}

// Search venues by name: OpenAlex sources of type conference/journal.
export async function searchVenues(env, q) {
  const r = await oa(env, '/sources', { search: String(q).slice(0, 100), per_page: 10, filter: 'type:conference|journal', select: 'id' });
  return loadVenues(env, (r?.results || []).map((s) => short(s.id)));
}
