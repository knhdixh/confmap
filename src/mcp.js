// Remote MCP server (Streamable HTTP, stateless JSON responses) at POST /mcp.
// Auth: "Authorization: Bearer cm_..." personal token created in Settings → Agents.
import { HttpError } from './openalex.js';
import * as svc from './service.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `confmap tracks researchers (profs, senior people) and the conferences/journals they publish at, to find which venues are prestigious and where the "hot" people go.
Typical flow: the user pastes a researcher link (OpenAlex, ORCID, Semantic Scholar, Google Scholar, dblp or a personal homepage) or a name -> call add_researcher.
If it returns status "choose", show the candidates (name, institution, h-index) and call add_researcher again with the chosen OpenAlex id (e.g. "A5049349154").
Then use list_venues / get_venue / insights to answer "where should I go". Plan trips and submissions with add_task (natural dates like "fri", "dec 5", "in 2 weeks").
Priorities are Todoist-style: 1 = top, 4 = none.`;

const str = (description) => ({ type: 'string', description });
const TOOLS = [
  { name: 'add_researcher', description: 'Track a researcher from a profile link (OpenAlex, ORCID, Semantic Scholar, Google Scholar, dblp, personal homepage) or a full name. Imports their papers, fields, keywords and venues. Returns status added | already_tracked | choose (with candidates).',
    inputSchema: { type: 'object', properties: { link_or_name: str('Profile URL, ORCID, OpenAlex id (A…) or full name'), note: str('Optional note, e.g. "met at ICML, works on RL"') }, required: ['link_or_name'] } },
  { name: 'list_researchers', description: 'List tracked researchers with h-index, citations, institution and top topics.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_researcher', description: 'Full researcher profile: stats, citations per year, fields/topics, keywords, venues they publish at, most cited and recent papers.',
    inputSchema: { type: 'object', properties: { id: str('OpenAlex author id (A…) or a tracked name') }, required: ['id'] } },
  { name: 'refresh_researcher', description: 'Re-import a tracked researcher from OpenAlex.', inputSchema: { type: 'object', properties: { id: str('OpenAlex author id') }, required: ['id'] } },
  { name: 'remove_researcher', description: 'Stop tracking a researcher.', inputSchema: { type: 'object', properties: { id: str('OpenAlex author id') }, required: ['id'] } },
  { name: 'list_venues', description: 'Venues where tracked researchers publish, with heat (sum of h-index of tracked people weighted by recent presence), prestige (CORE/CCF rank + citation h-index), people, seniors and the next deadline.',
    inputSchema: { type: 'object', properties: { sort: { type: 'string', enum: ['heat', 'prestige', 'deadline', 'priority'], description: 'Default heat' }, limit: { type: 'number', description: 'Default 25' }, conferences_only: { type: 'boolean' } } } },
  { name: 'get_venue', description: 'One venue: ranks, citation metrics, acceptance rates, editions/deadlines/places, which tracked people go, top authors there in the last 3 years (with h-index), and your tasks.',
    inputSchema: { type: 'object', properties: { venue: str('Venue id (S…) or name/acronym, e.g. "NeurIPS"') }, required: ['venue'] } },
  { name: 'set_venue_priority', description: 'Set your own priority for a venue (1 top … 4 none) and an optional note. Works for venues nobody you track publishes at yet.',
    inputSchema: { type: 'object', properties: { venue: str('Venue id or name'), priority: { type: 'number', enum: [1, 2, 3, 4] }, note: str('Optional note') }, required: ['venue'] } },
  { name: 'insights', description: 'Correlations between citation metrics, rankings and where tracked people go, plus the hottest venues.', inputSchema: { type: 'object', properties: {} } },
  { name: 'add_task', description: 'Add a to-do, Todoist quick-add style: "Submit abstract fri p1 #NeurIPS". Or give fields separately.',
    inputSchema: { type: 'object', properties: { text: str('Quick-add text with optional date words, p1-p4 and #venue'), content: str('Task text (if not using text)'), due: str('Date: YYYY-MM-DD or words like "tomorrow", "dec 5"'), priority: { type: 'number', enum: [1, 2, 3, 4] }, venue: str('Venue name or id') } } },
  { name: 'list_tasks', description: 'Open tasks (and those completed in the last week), with due dates and venues.', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_task', description: 'Change, complete or reopen a task.',
    inputSchema: { type: 'object', properties: { id: { type: 'number' }, content: str('New text'), due: str('New date, or "" to clear'), priority: { type: 'number', enum: [1, 2, 3, 4] }, done: { type: 'boolean' } }, required: ['id'] } },
];

async function researcherId(env, user, q) {
  const s = String(q || '').trim();
  if (/^A\d{5,}$/i.test(s)) return s.toUpperCase();
  const r = await env.DB.prepare(`SELECT a.id FROM tracked t JOIN authors a ON a.id = t.author_id WHERE t.user_id = ? AND a.name LIKE ? ORDER BY a.h_index DESC LIMIT 1`)
    .bind(user.id, '%' + s + '%').first();
  if (!r) throw new HttpError(404, `No tracked researcher matching "${s}".`);
  return r.id;
}

const brief = (v) => ({ id: v.id, name: v.conf_title || v.abbr || v.name, full_name: v.conf_name || v.name, type: v.type, heat: v.heat, prestige: v.prestige,
  core: v.core, ccf: v.ccf, citation_h_index: v.h_index, people: v.people, seniors: v.seniors, priority: v.priority,
  next: v.next ? { kind: v.next.kind, date: v.next.at ? new Date(v.next.at).toISOString() : null, days_left: v.next.daysLeft, year: v.next.year, place: v.next.place, when: v.next.date, link: v.next.link } : null });

async function call(env, user, name, a = {}) {
  switch (name) {
    case 'add_researcher': return svc.addResearcher(env, user, a.link_or_name, { note: a.note });
    case 'list_researchers': {
      const st = await svc.state(env, user);
      return st.researchers.map((r) => ({ id: r.id, name: r.name, institution: r.institution, h_index: r.h_index, cited_by: r.cited_by,
        works: r.works_count, topics: JSON.parse(r.topics || '[]').slice(0, 3).map((t) => t.name), note: r.note || undefined }));
    }
    case 'get_researcher': {
      const r = await svc.getResearcher(env, user, await researcherId(env, user, a.id));
      return { ...r, by_year: r.by_year.slice(-10), venues: r.venues.slice(0, 25),
        works: { top: r.works.top.map(({ author_id, kind, ...w }) => w), recent: r.works.recent.map(({ author_id, kind, ...w }) => w) } };
    }
    case 'refresh_researcher': return svc.refreshResearcher(env, user, await researcherId(env, user, a.id));
    case 'remove_researcher': return svc.removeResearcher(env, user, await researcherId(env, user, a.id));
    case 'list_venues': {
      let vs = svc.computeVenues(await svc.state(env, user));
      if (a.conferences_only) vs = vs.filter((v) => v.type === 'conference' || v.conf_key);
      const key = { heat: (v) => -v.heat, prestige: (v) => -v.prestige, priority: (v) => v.priority * 1e6 - v.heat,
        deadline: (v) => v.next?.upcoming ? v.next.at : Infinity }[a.sort || 'heat'] || ((v) => -v.heat);
      return vs.sort((x, y) => key(x) - key(y)).slice(0, Math.min(100, a.limit || 25)).map(brief);
    }
    case 'get_venue': {
      const v = await svc.getVenue(env, user, await svc.findVenue(env, user, a.venue));
      return { ...brief({ ...v, people: v.people_count }), homepage: v.homepage, works_count: v.works_count, mean_citedness_2yr: v.mean2yr, prestige_parts: v.prestige_parts,
        acceptance: v.accept, editions: v.editions, note: v.note, tracked_people: v.recent_people,
        top_authors_last_3y: v.top_authors, top_authors_error: v.top_authors_error || undefined, tasks: v.tasks };
    }
    case 'set_venue_priority': {
      const id = await svc.findVenue(env, user, a.venue);
      await svc.markVenue(env, user, id, { priority: a.priority, note: a.note });
      return { ok: true, venue_id: id };
    }
    case 'insights': return svc.insights(await svc.state(env, user));
    case 'add_task': {
      const input = a.text ? { text: a.text } : { content: a.content, due: a.due, priority: a.priority, venue: a.venue };
      return svc.addTask(env, user, input);
    }
    case 'list_tasks': return (await svc.state(env, user)).tasks;
    case 'update_task': {
      const { id, ...patch } = a;
      return svc.updateTask(env, user, Number(id), patch);
    }
  }
  throw new HttpError(400, `Unknown tool ${name}.`);
}

async function handleOne(env, user, msg) {
  const { id, method, params = {} } = msg || {};
  const reply = (result) => ({ jsonrpc: '2.0', id, result });
  if (id === undefined || id === null) return null;   // notification
  try {
    switch (method) {
      case 'initialize': return reply({
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'confmap', title: 'confmap', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
      case 'ping': return reply({});
      case 'tools/list': return reply({ tools: TOOLS });
      case 'tools/call': {
        try {
          const out = await call(env, user, params.name, params.arguments || {});
          return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }] });
        } catch (e) {
          if (e instanceof HttpError) return reply({ content: [{ type: 'text', text: e.message }], isError: true });
          throw e;
        }
      }
      default: return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
    }
  } catch (e) {
    console.error(e);
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error.' } };
  }
}

export async function handleMcp(request, env) {
  if (request.method !== 'POST') return new Response('Use POST (Streamable HTTP, JSON responses).', { status: 405, headers: { Allow: 'POST' } });
  const user = await svc.userFromToken(env, request);
  if (!user) return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Missing or invalid token. Create one in confmap → Settings → Agents.' } },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer realm="confmap"' } });
  let body;
  try { body = JSON.parse(await request.text()); } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const out = (await Promise.all((batch ? body : [body]).map((m) => handleOne(env, user, m)))).filter(Boolean);
  if (!out.length) return new Response(null, { status: 202 });
  return Response.json(batch ? out : out[0]);
}

export { TOOLS };
