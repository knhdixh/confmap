// User-scoped operations shared by the REST API (browser) and the MCP endpoint (Claude Code, Codex).
import { HttpError, resolveAuthor, ingestAuthor, venuePeople, searchVenues, upsertVenues, candidate, oa } from './openalex.js';
import { prestige } from '../public/lib/metrics.js';
import { computeVenues, insights } from '../public/lib/model.js';
export { computeVenues, insights };
import { parseQuickAdd, todayIn, parseDate } from '../public/lib/dates.js';

const J = (s, d = []) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const STALE_MS = 30 * 864e5;

// ---------------------------------------------------------------- researchers

export async function addResearcher(env, user, input, { note = '' } = {}) {
  const r = await resolveAuthor(env, input);
  if (r.candidates) return { status: 'choose', query: r.query, via: r.via, candidates: r.candidates };
  const existing = await env.DB.prepare('SELECT fetched_at FROM authors WHERE id = ?').bind(r.id).first();
  const author = existing?.fetched_at > Date.now() - STALE_MS
    ? await env.DB.prepare('SELECT * FROM authors WHERE id = ?').bind(r.id).first()
    : await ingestAuthor(env, r.id);
  const res = await env.DB.prepare(`INSERT INTO tracked (user_id, author_id, source, note, added_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT DO NOTHING`).bind(user.id, author.id, String(input).slice(0, 500), String(note).slice(0, 500), Date.now()).run();
  return { status: res.meta.changes ? 'added' : 'already_tracked', via: r.via, researcher: await researcherSummary(env, author.id) };
}

export async function refreshResearcher(env, user, id) {
  await mustTrack(env, user, id);
  await ingestAuthor(env, id);
  return researcherSummary(env, id);
}

export async function removeResearcher(env, user, id) {
  const r = await env.DB.prepare('DELETE FROM tracked WHERE user_id = ? AND author_id = ?').bind(user.id, id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Not tracked.');
  return { ok: true };
}

export async function noteResearcher(env, user, id, note) {
  await mustTrack(env, user, id);
  await env.DB.prepare('UPDATE tracked SET note = ? WHERE user_id = ? AND author_id = ?').bind(String(note || '').slice(0, 2000), user.id, id).run();
  return { ok: true };
}

async function mustTrack(env, user, id) {
  const t = await env.DB.prepare('SELECT 1 FROM tracked WHERE user_id = ? AND author_id = ?').bind(user.id, id).first();
  if (!t) throw new HttpError(404, 'You are not tracking that researcher.');
}

async function researcherSummary(env, id) {
  const a = await env.DB.prepare('SELECT * FROM authors WHERE id = ?').bind(id).first();
  const venues = (await env.DB.prepare(`SELECT v.id, COALESCE(c.title, v.abbr, v.name) AS name, av.n_all, av.n_recent FROM author_venues av
    JOIN venues v ON v.id = av.venue_id LEFT JOIN confs c ON c.key = v.conf_key WHERE av.author_id = ? ORDER BY av.n_recent DESC, av.n_all DESC LIMIT 8`).bind(id).all()).results;
  return { id: a.id, name: a.name, institution: a.institution, h_index: a.h_index, cited_by: a.cited_by, works: a.works_count,
    topics: J(a.topics).slice(0, 5).map((t) => t.name), top_venues: venues };
}

export async function getResearcher(env, user, id) {
  const a = await env.DB.prepare(`SELECT a.*, t.note, t.source, t.added_at FROM authors a
    LEFT JOIN tracked t ON t.author_id = a.id AND t.user_id = ? WHERE a.id = ?`).bind(user.id, id).first();
  if (!a) throw new HttpError(404, 'Unknown researcher. Add them first.');
  const [venues, works, marks] = await Promise.all([
    env.DB.prepare(`SELECT v.id, v.name, v.abbr, v.type, v.h_index, c.title AS conf_title, c.core, c.ccf, av.n_all, av.n_recent
      FROM author_venues av JOIN venues v ON v.id = av.venue_id LEFT JOIN confs c ON c.key = v.conf_key
      WHERE av.author_id = ? ORDER BY av.n_recent DESC, av.n_all DESC`).bind(id).all(),
    env.DB.prepare('SELECT * FROM works WHERE author_id = ? ORDER BY kind, cites DESC').bind(id).all(),
    env.DB.prepare('SELECT venue_id, priority FROM venue_marks WHERE user_id = ?').bind(user.id).all(),
  ]);
  const pr = new Map(marks.results.map((m) => [m.venue_id, m.priority]));
  return {
    ...a, tracked: a.added_at != null, topics: J(a.topics), keywords: J(a.keywords), by_year: J(a.by_year),
    venues: venues.results.map((v) => ({ ...v, priority: pr.get(v.id) || 4, prestige: prestige(v).score })),
    works: { top: works.results.filter((w) => w.kind === 'top'), recent: works.results.filter((w) => w.kind === 'recent').sort((x, y) => (y.year || 0) - (x.year || 0)) },
  };
}

// ---------------------------------------------------------------- state for the dashboard

export async function state(env, user) {
  const [researchers, venues, links, tasks] = await env.DB.batch([
    env.DB.prepare(`SELECT a.id, a.name, a.institution, a.country, a.h_index, a.cited_by, a.works_count, a.mean2yr, a.topics, a.keywords,
      a.fetched_at, t.note, t.added_at FROM tracked t JOIN authors a ON a.id = t.author_id WHERE t.user_id = ?1 ORDER BY a.h_index DESC`).bind(user.id),
    env.DB.prepare(`SELECT v.id, v.name, v.abbr, v.type, v.h_index, v.mean2yr, v.works_count, v.homepage, v.conf_key,
      c.title AS conf_title, c.description AS conf_name, c.core, c.ccf, c.sub, c.editions, c.accept,
      COALESCE(m.priority, 4) AS priority, COALESCE(m.note, '') AS note
      FROM venues v LEFT JOIN confs c ON c.key = v.conf_key LEFT JOIN venue_marks m ON m.venue_id = v.id AND m.user_id = ?1
      WHERE m.user_id IS NOT NULL OR v.id IN (SELECT av.venue_id FROM author_venues av JOIN tracked t ON t.author_id = av.author_id AND t.user_id = ?1)`).bind(user.id),
    env.DB.prepare(`SELECT av.author_id, av.venue_id, av.n_all, av.n_recent FROM author_venues av
      JOIN tracked t ON t.author_id = av.author_id AND t.user_id = ?1`).bind(user.id),
    env.DB.prepare(`SELECT id, content, due, priority, venue_id, done_at, created_at FROM tasks WHERE user_id = ?1
      AND (done_at IS NULL OR done_at > ?2) ORDER BY due IS NULL, due, priority, id`).bind(user.id, Date.now() - 7 * 864e5),
  ]);
  return { researchers: researchers.results, venues: venues.results, links: links.results, tasks: tasks.results, today: todayIn(user.tz) };
}

// ---------------------------------------------------------------- venues

export async function getVenue(env, user, id, { withPeople = true } = {}) {
  const st = await state(env, user);
  let v = computeVenues(st).find((x) => x.id === id);
  if (!v) {
    const row = await env.DB.prepare(`SELECT v.*, c.title AS conf_title, c.description AS conf_name, c.core, c.ccf, c.sub, c.editions, c.accept
      FROM venues v LEFT JOIN confs c ON c.key = v.conf_key WHERE v.id = ?`).bind(id).first();
    if (!row) throw new HttpError(404, 'Unknown venue.');
    v = computeVenues({ ...st, venues: [{ ...row, priority: 4, note: '' }] })[0];
  }
  let people = null, people_error = null;
  if (withPeople) {
    try {
      const tracked = new Set(st.researchers.map((r) => r.id));
      people = (await venuePeople(env, id)).map((p) => ({ ...p, tracked: tracked.has(p.id) }));
    } catch (e) { people_error = e.message; }
  }
  const { people: _p, people_at: _a, ...rest } = v;
  return { ...rest, people_count: v.people, top_authors: people, top_authors_error: people_error,
    tasks: st.tasks.filter((t) => t.venue_id === id) };
}

export async function findVenue(env, user, query, { strict = false } = {}) {
  const q = String(query || '').trim();
  if (!q) throw new HttpError(400, 'Give a venue name or id.');
  if (/^S\d{4,}$/i.test(q)) return q.toUpperCase();
  const lc = q.toLowerCase();
  const local = await env.DB.prepare(`SELECT v.id FROM venues v LEFT JOIN confs c ON c.key = v.conf_key
    WHERE lower(c.title) = ?1 OR lower(v.abbr) = ?1 OR lower(v.name) = ?1 OR lower(c.description) = ?1
    ORDER BY v.h_index DESC LIMIT 1`).bind(lc).first()
    || await env.DB.prepare(`SELECT v.id FROM venues v LEFT JOIN confs c ON c.key = v.conf_key
    WHERE v.name LIKE ?1 OR c.description LIKE ?1 ORDER BY v.h_index DESC LIMIT 1`).bind('%' + q + '%').first();
  if (local) return local.id;
  const conf = await env.DB.prepare('SELECT description FROM confs WHERE lower(title) = ? OR lower(key) = ?').bind(lc, lc).first();
  if (strict && !conf) throw new HttpError(404, `No venue matching "${q}".`);
  const found = await searchVenues(env, conf?.description || q);
  if (!found.length) throw new HttpError(404, `No venue matching "${q}".`);
  const best = found.find((v) => v.conf_key) || found[0];
  await upsertVenues(env, [best]).run();
  return best.id;
}

export async function markVenue(env, user, id, { priority, note } = {}) {
  const v = await env.DB.prepare('SELECT id FROM venues WHERE id = ?').bind(id).first();
  if (!v) throw new HttpError(404, 'Unknown venue.');
  const p = priority == null ? null : Number(priority);
  if (p != null && ![1, 2, 3, 4].includes(p)) throw new HttpError(400, 'Priority is 1 (top) to 4 (none).');
  await env.DB.prepare(`INSERT INTO venue_marks (user_id, venue_id, priority, note) VALUES (?1, ?2, COALESCE(?3, 4), COALESCE(?4, ''))
    ON CONFLICT (user_id, venue_id) DO UPDATE SET priority = COALESCE(?3, priority), note = COALESCE(?4, note)`)
    .bind(user.id, id, p, note == null ? null : String(note).slice(0, 2000)).run();
  return { ok: true };
}

export async function venueSearch(env, q) {
  const local = (await env.DB.prepare(`SELECT key, title, description, core, ccf FROM confs WHERE title LIKE ?1 OR description LIKE ?1 LIMIT 8`)
    .bind('%' + String(q).slice(0, 80) + '%').all()).results;
  return { confs: local };
}

// ---------------------------------------------------------------- tasks

async function venueFromTag(env, user, tag) {
  if (!tag) return null;
  try { return await findVenue(env, user, tag, { strict: true }); } catch { return null; }
}

export async function addTask(env, user, input) {
  const today = todayIn(user.tz);
  let { content, due, priority = 4, venue_id = null, venue = null } = input;
  if (input.text) ({ content, due, priority, venue } = parseQuickAdd(input.text, today));
  else if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) due = parseDate(due, today);
  content = String(content || '').trim().slice(0, 500);
  if (!content) throw new HttpError(400, 'A task needs some text.');
  if (!venue_id && venue) venue_id = await venueFromTag(env, user, venue);
  if (venue && !venue_id) content += ` #${venue}`;
  const t = await env.DB.prepare(`INSERT INTO tasks (user_id, content, due, priority, venue_id, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *`)
    .bind(user.id, content, due || null, [1, 2, 3, 4].includes(+priority) ? +priority : 4, venue_id, Date.now()).first();
  return t;
}

export async function updateTask(env, user, id, patch) {
  const t = await env.DB.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).first();
  if (!t) throw new HttpError(404, 'Task not found.');
  const today = todayIn(user.tz);
  let due = t.due;
  if ('due' in patch) due = !patch.due ? null : /^\d{4}-\d{2}-\d{2}$/.test(patch.due) ? patch.due : parseDate(patch.due, today);
  if ('due' in patch && patch.due && !due) throw new HttpError(400, `Could not read the date "${patch.due}".`);
  const next = {
    content: patch.content != null ? String(patch.content).trim().slice(0, 500) || t.content : t.content,
    due, priority: [1, 2, 3, 4].includes(+patch.priority) ? +patch.priority : t.priority,
    venue_id: 'venue_id' in patch ? patch.venue_id || null : t.venue_id,
    done_at: 'done' in patch ? (patch.done ? Date.now() : null) : t.done_at,
  };
  return env.DB.prepare('UPDATE tasks SET content = ?, due = ?, priority = ?, venue_id = ?, done_at = ? WHERE id = ? RETURNING *')
    .bind(next.content, next.due, next.priority, next.venue_id, next.done_at, id).first();
}

export async function deleteTask(env, user, id) {
  const r = await env.DB.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').bind(id, user.id).run();
  if (!r.meta.changes) throw new HttpError(404, 'Task not found.');
  return { ok: true };
}

// ---------------------------------------------------------------- tokens

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));

export async function createToken(env, user, name) {
  const raw = 'cm_' + hex(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare('INSERT INTO api_tokens (user_id, name, token_hash, hint, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(user.id, String(name || 'Agent').slice(0, 60), await sha256(raw), raw.slice(-4), Date.now()).run();
  return { token: raw };
}

export async function userFromToken(env, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(cm_[a-f0-9]{48})$/);
  if (!m) return null;
  const row = await env.DB.prepare(`SELECT u.*, t.id AS token_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`)
    .bind(await sha256(m[1])).first();
  if (row) await env.DB.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').bind(Date.now(), row.token_id).run();
  return row;
}

export { candidate, oa };
