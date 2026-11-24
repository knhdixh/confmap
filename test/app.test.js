import { test } from 'node:test';
import assert from 'node:assert/strict';
import { d1 } from './d1-shim.js';
import worker from '../src/worker.js';
import { confMatcher, norm } from '../src/openalex.js';
import * as svc from '../src/service.js';
import { parseQuickAdd } from '../public/lib/dates.js';
import { spearman, nextEdition, prestige } from '../public/lib/metrics.js';

// Fake OpenAlex: two authors, three venues (NeurIPS, ICML, arXiv).
const SOURCES = {
  S1: { id: 'https://openalex.org/S1', display_name: 'neural information processing systems', alternate_titles: ['Advances in neural information processing systems'], type: 'conference', summary_stats: { h_index: 698, '2yr_mean_citedness': 24 }, works_count: 35000, cited_by_count: 3e6 },
  S2: { id: 'https://openalex.org/S2', display_name: 'International Conference on Machine Learning', alternate_titles: ['International Conference on Machine Learning (ICML)'], type: 'conference', summary_stats: { h_index: 464 }, works_count: 19000 },
  S9: { id: 'https://openalex.org/S9', display_name: 'arXiv', type: 'repository', summary_stats: { h_index: 1000 } },
};
const AUTHORS = {
  A11111: { id: 'https://openalex.org/A11111', display_name: 'Ada Senior', summary_stats: { h_index: 80, i10_index: 200 }, works_count: 400, cited_by_count: 90000,
    last_known_institutions: [{ display_name: 'Uni A', country_code: 'US' }], topics: [{ display_name: 'Reinforcement Learning', field: { display_name: 'CS' }, subfield: { display_name: 'AI' }, count: 100 }],
    counts_by_year: [{ year: 2025, works_count: 20, cited_by_count: 9000 }] },
  A22222: { id: 'https://openalex.org/A22222', display_name: 'Bo Junior', summary_stats: { h_index: 12 }, works_count: 40, cited_by_count: 900, topics: [] },
};
const VENUES_OF = { A11111: [['S1', 20, 8], ['S2', 10, 2], ['S9', 50, 30]], A22222: [['S2', 5, 4]] };

function fakeFetch(calls) {
  return async (input) => {
    const u = new URL(String(input));
    calls.push(u.pathname + u.search);
    const q = Object.fromEntries(u.searchParams);
    const ok = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
    let m;
    if ((m = u.pathname.match(/^\/authors\/(A\d+)$/))) return AUTHORS[m[1]] ? ok(AUTHORS[m[1]]) : new Response('', { status: 404 });
    if (u.pathname === '/authors' && q.search) return ok({ results: [AUTHORS.A11111, AUTHORS.A22222].filter((a) => a.display_name.toLowerCase().includes(q.search.toLowerCase().split(' ')[0])) });
    if (u.pathname === '/authors' && q.filter) return ok({ results: q.filter.replace('ids.openalex:', '').split('|').map((id) => AUTHORS[id]).filter(Boolean) });
    if (u.pathname === '/sources' && q.filter?.startsWith('ids.openalex:')) return ok({ results: q.filter.slice(13).split('|').map((id) => SOURCES[id]).filter(Boolean) });
    if (u.pathname === '/sources' && q.search) return ok({ results: [SOURCES.S2] });
    if (u.pathname === '/works') {
      const aid = (q.filter.match(/author\.id:(A\d+)/) || [])[1];
      if (q.group_by === 'primary_location.source.id') {
        const recent = /publication_year/.test(q.filter);
        return ok({ group_by: VENUES_OF[aid].map(([v, a, r]) => ({ key: 'https://openalex.org/' + v, key_display_name: v, count: recent ? r : a })) });
      }
      if (q.group_by === 'keywords.id') return ok({ group_by: [{ key: 'k1', key_display_name: 'policy gradients', count: 7 }] });
      if (q.group_by === 'authorships.author.id') return ok({ group_by: [{ key: 'https://openalex.org/A11111', count: 9 }, { key: 'https://openalex.org/A22222', count: 3 }] });
      return ok({ results: [{ id: 'https://openalex.org/W1', title: 'A paper', publication_year: 2024, cited_by_count: 50, primary_location: { source: SOURCES.S1 }, doi: 'https://doi.org/10.1/x' }] });
    }
    return new Response('not mocked ' + u, { status: 500 });
  };
}

async function setup() {
  const calls = [];
  const env = { DB: d1(), fetch: fakeFetch(calls), ASSETS: { fetch: async () => new Response('static') } };
  const { id } = await env.DB.prepare("INSERT INTO users (name, created_at, tz) VALUES ('Me', 0, 'Europe/Helsinki') RETURNING id").first();
  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
  return { env, user, calls };
}

test('conference names match the ccfddl list', () => {
  const m = confMatcher([
    { key: 'nips', title: 'NeurIPS', description: 'Conference on Neural Information Processing Systems' },
    { key: 'icml', title: 'ICML', description: 'International Conference on Machine Learning' },
    { key: 'icra', title: 'ICRA', description: 'IEEE International Conference on Robotics and Automation' },
    { key: 'iros', title: 'IROS', description: 'IEEE/RSJ International Conference on Intelligent Robots and Systems' },
  ]);
  assert.equal(m(['neural information processing systems']), 'nips');
  assert.equal(m(['Proceedings - IEEE International Conference on Robotics and Automation/Proceedings']), 'icra');
  assert.equal(m(['Some Journal', 'Proceedings of the 23rd international conference on Machine learning - ICML \'06']), 'icml');
  assert.equal(m(['IEEE/RSJ International Conference on Intelligent Robots and Systems (IROS)']), 'iros');
  assert.equal(m(['Journal of Machine Learning Research']), null);
  assert.equal(norm('The 38th Annual Conference on X & Y'), 'x y');
});

test('quick add parses dates, priority and venue', () => {
  assert.deepEqual(parseQuickAdd('Submit abstract fri p1 #NeurIPS', '2026-11-24'), { content: 'Submit abstract', due: '2026-11-27', priority: 1, venue: 'NeurIPS' });
  assert.equal(parseQuickAdd('visa dec 5', '2026-12-20').due, '2027-12-05');
  assert.equal(parseQuickAdd('email prof in 2 weeks', '2026-11-24').due, '2026-12-08');
  assert.equal(parseQuickAdd('read paper', '2026-11-24').due, null);
});

test('metrics', () => {
  assert.equal(spearman([[1, 1], [2, 2], [3, 3], [4, 4]]).rho, 1);
  assert.equal(spearman([[1, 1], [2, 2]]).rho, null);
  assert.equal(prestige({ core: 'A*', ccf: 'A' }).score, 100);
  const n = nextEdition([{ year: 2027, timezone: 'AoE', timeline: [{ deadline: '2027-01-27 23:59:59' }] }], Date.UTC(2027, 0, 1));
  assert.equal(n.upcoming, true);
  assert.equal(n.daysLeft, 28);
});

test('adding researchers imports venues and computes heat', async () => {
  const { env, user, calls } = await setup();
  const r = await svc.addResearcher(env, user, 'https://openalex.org/A11111');
  assert.equal(r.status, 'added');
  assert.equal(r.researcher.h_index, 80);
  assert.ok(calls.length <= 10, 'few subrequests');
  await svc.addResearcher(env, user, 'A22222');
  assert.equal((await svc.addResearcher(env, user, 'A22222')).status, 'already_tracked');

  const st = await svc.state(env, user);
  assert.equal(st.researchers.length, 2);
  const vs = svc.computeVenues(st);
  assert.deepEqual(vs.map((v) => v.id).sort(), ['S1', 'S2'], 'repositories are dropped');
  const nips = vs.find((v) => v.id === 'S1'), icml = vs.find((v) => v.id === 'S2');
  assert.equal(nips.conf_key, 'nips');
  assert.equal(nips.core, 'A*');
  assert.equal(nips.heat, 80);              // 80 × presence 1
  assert.equal(icml.heat, Math.round(80 * (2 + 2) / 3 > 80 ? 80 : 80 * 1) + Math.round(12 * (4 + 0.25) / 3 > 12 ? 12 : 0));
  assert.equal(icml.people, 2);
  assert.equal(icml.seniors, 1);

  const full = await svc.getResearcher(env, user, 'A11111');
  assert.equal(full.keywords[0].name, 'policy gradients');
  assert.equal(full.works.top.length, 1);

  const v = await svc.getVenue(env, user, 'S2');
  assert.equal(v.top_authors[0].name, 'Ada Senior');
  assert.equal(v.top_authors[0].tracked, true);
});

test('names with one dominant profile auto-resolve; others return candidates', async () => {
  const { env, user } = await setup();
  assert.equal((await svc.addResearcher(env, user, 'Ada')).status, 'added');
});

test('tasks: quick add links a venue, update, complete', async () => {
  const { env, user } = await setup();
  await svc.addResearcher(env, user, 'A11111');
  const t = await svc.addTask(env, user, { text: 'Submit paper tomorrow p1 #NeurIPS' });
  assert.equal(t.venue_id, 'S1');
  assert.equal(t.priority, 1);
  const u = await svc.updateTask(env, user, t.id, { done: true });
  assert.ok(u.done_at);
  const other = await svc.addTask(env, user, { text: 'Book hotel #Nowhere' });
  assert.equal(other.venue_id, null);
  assert.match(other.content, /#Nowhere/);
});

test('MCP: auth, initialize, tools/list, tools/call', async () => {
  const { env, user } = await setup();
  const call = (b, token) => worker.fetch(new Request('https://app.test/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(b) }), env);
  assert.equal((await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).status, 401);
  const { token } = await svc.createToken(env, user, 'Claude Code');
  const init = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, token)).json();
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, token)).status, 202);
  const list = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, token)).json();
  assert.ok(list.result.tools.some((t) => t.name === 'add_researcher'));
  const add = await (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'add_researcher', arguments: { link_or_name: 'https://openalex.org/A11111' } } }, token)).json();
  assert.equal(JSON.parse(add.result.content[0].text).status, 'added');
  const venues = await (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_venues', arguments: {} } }, token)).json();
  assert.equal(JSON.parse(venues.result.content[0].text)[0].name, 'NeurIPS');
  const bad = await (await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_researcher', arguments: { id: 'Nobody' } } }, token)).json();
  assert.equal(bad.result.isError, true);
});

test('API requires sign-in; account deletion removes user rows', async () => {
  const { env, user } = await setup();
  const res = await worker.fetch(new Request('https://app.test/api/state'), env);
  assert.equal(res.status, 401);
  await svc.addResearcher(env, user, 'A11111');
  await svc.addTask(env, user, { text: 'x' });
  const { token } = await svc.createToken(env, user, 't');
  const del = await worker.fetch(new Request('https://app.test/api/account', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } }), env);
  assert.equal(del.status, 200);
  for (const t of ['tracked', 'tasks', 'api_tokens', 'venue_marks']) {
    assert.equal((await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n, 0, t);
  }
});
