import { handleAuth, currentUser } from './auth.js';
import { HttpError, ingestAuthor } from './openalex.js';
import { handleMcp } from './mcp.js';
import * as svc from './service.js';
// confmap: Worker entry. /api/* (browser, cookie or bearer token), /mcp (agents), /auth/*; everything else is static (public/).

const json = (data, init) => Response.json(data, init);

async function body(request) {
  const text = await request.text();
  if (text.length > 64 * 1024) throw new HttpError(413, 'Request too large.');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

async function handleApi(request, env, url) {
  const p = url.pathname, m = request.method;
  if (p === '/api/health' && m === 'GET') return json({ ok: true });

  const user = (await currentUser(request, env)) || (await svc.userFromToken(env, request));
  if (!user) throw new HttpError(401, 'Not signed in.');
  let r;

  if (p === '/api/state' && m === 'GET') return json({ me: { name: user.name, tz: user.tz }, ...(await svc.state(env, user)) });
  if (p === '/api/me' && m === 'POST') {
    const { tz } = await body(request);
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); } catch { throw new HttpError(400, 'Unknown time zone.'); }
    await env.DB.prepare('UPDATE users SET tz = ? WHERE id = ?').bind(tz, user.id).run();
    return json({ ok: true });
  }
  if (p === '/api/account' && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
    return json({ ok: true });
  }
  if (p === '/api/insights' && m === 'GET') return json(svc.insights(await svc.state(env, user)));

  if (p === '/api/researchers' && m === 'POST') { const b = await body(request); return json(await svc.addResearcher(env, user, b.input, { note: b.note })); }
  if ((r = p.match(/^\/api\/researchers\/(A\d+)(\/refresh)?$/))) {
    if (r[2] && m === 'POST') return json(await svc.refreshResearcher(env, user, r[1]));
    if (m === 'GET') return json(await svc.getResearcher(env, user, r[1]));
    if (m === 'PATCH') return json(await svc.noteResearcher(env, user, r[1], (await body(request)).note));
    if (m === 'DELETE') return json(await svc.removeResearcher(env, user, r[1]));
  }

  if (p === '/api/venues' && m === 'POST') {
    const b = await body(request);
    const id = await svc.findVenue(env, user, b.query);
    await svc.markVenue(env, user, id, { priority: b.priority ?? 3 });
    return json({ id });
  }
  if (p === '/api/venues/search' && m === 'GET') return json(await svc.venueSearch(env, url.searchParams.get('q') || ''));
  if ((r = p.match(/^\/api\/venues\/(S\d+)$/))) {
    if (m === 'GET') return json(await svc.getVenue(env, user, r[1]));
    if (m === 'PATCH') return json(await svc.markVenue(env, user, r[1], await body(request)));
  }

  if (p === '/api/tasks' && m === 'POST') return json(await svc.addTask(env, user, await body(request)));
  if ((r = p.match(/^\/api\/tasks\/(\d+)$/))) {
    if (m === 'PATCH') return json(await svc.updateTask(env, user, +r[1], await body(request)));
    if (m === 'DELETE') return json(await svc.deleteTask(env, user, +r[1]));
  }

  if (p === '/api/tokens') {
    if (m === 'GET') return json((await env.DB.prepare('SELECT id, name, hint, created_at, last_used_at FROM api_tokens WHERE user_id = ? ORDER BY id').bind(user.id).all()).results);
    if (m === 'POST') return json(await svc.createToken(env, user, (await body(request)).name));
  }
  if ((r = p.match(/^\/api\/tokens\/(\d+)$/)) && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM api_tokens WHERE id = ? AND user_id = ?').bind(+r[1], user.id).run();
    return json({ ok: true });
  }
  throw new HttpError(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // One canonical host: passkeys are bound to the host name.
    if (env.CANONICAL_HOST && url.hostname.endsWith('.workers.dev')) {
      url.hostname = env.CANONICAL_HOST;
      return Response.redirect(url.toString(), ['GET', 'HEAD'].includes(request.method) ? 301 : 308);
    }
    try {
      if (url.pathname === '/mcp') return await handleMcp(request, env);
      // Reject cross-site state-changing requests.
      if (!['GET', 'HEAD'].includes(request.method)) {
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-origin request rejected.');
      }
      if (url.pathname.startsWith('/auth/')) return await handleAuth(request, env, url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url);
      return env.ASSETS.fetch(request);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, { status: e.status });
      console.error(e);
      return json({ error: 'Internal error.' }, { status: 500 });
    }
  },

  // Daily: re-import the three tracked researchers with the oldest data (older than 30 days).
  async scheduled(event, env, ctx) {
    const { results } = await env.DB.prepare(`SELECT DISTINCT a.id FROM authors a JOIN tracked t ON t.author_id = a.id
      WHERE a.fetched_at < ? ORDER BY a.fetched_at LIMIT 3`).bind(Date.now() - 30 * 864e5).all();
    for (const r of results) { try { await ingestAuthor(env, r.id); } catch (e) { console.error('refresh', r.id, e.message); } }
  },
};
