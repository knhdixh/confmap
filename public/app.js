import { mountSignIn, mountAccountPanel, me as authMe, signOut } from '/auth.js';
import { computeVenues, insights } from '/lib/model.js';
import { parseQuickAdd, dueLabel, addDays, daysBetween, todayIn } from '/lib/dates.js';
import { SENIOR_H, milestones } from '/lib/metrics.js';
import { I, esc, fmtN, initials, seniorColor, coreBadge, ccfBadge, toast, api, dialog, menu, closeOverlay, hasOverlay } from '/ui.js';
import * as V from '/views.js';

// ---------------------------------------------------------------- state
export const app = {
  S: null,              // { me, researchers, venues (computed), links, tasks, today }
  route: [],
  sel: -1,
  opts: JSON.parse(localStorage.getItem('confmap.opts') || '{}'),
  cache: new Map(),     // detail payloads
};
export const saveOpts = () => localStorage.setItem('confmap.opts', JSON.stringify(app.opts));

export async function load() {
  const d = await api('/api/state');
  d.researchers.forEach((r) => { r.topics = JSON.parse(r.topics || '[]'); r.keywords = JSON.parse(r.keywords || '[]'); });
  d.venues = computeVenues(d);
  d.vById = new Map(d.venues.map((v) => [v.id, v]));
  d.rById = new Map(d.researchers.map((r) => [r.id, r]));
  app.S = d;
  return d;
}

export async function refresh({ keepDetail = false } = {}) {
  if (!keepDetail) app.cache.clear();
  await load();
  render();
}

// ---------------------------------------------------------------- shell
const NAV = [
  ['researchers', 'Researchers', I.people, 'r'],
  ['venues', 'Venues', I.venue, 'v'],
  ['upcoming', 'Upcoming', I.upcoming, 'u'],
  ['graph', 'Graph', I.graph, 'g'],
  ['insights', 'Insights', I.insights, 'i'],
];

function shell() {
  const root = document.getElementById('app');
  if (root.querySelector('.layout')) return;
  const collapsed = app.opts.sidebar === false || innerWidth < 760;
  root.innerHTML = `<div class="layout${collapsed ? ' collapsed' : ''}">
    <aside class="sidebar" id="sidebar" aria-label="Sidebar"></aside>
    <main class="content" id="content">
      <button class="icon-btn menu-btn" data-act="toggle-sidebar" title="Open sidebar (m)">${I.sidebar}</button>
      <div class="content-inner" id="view"></div>
    </main></div>`;
}

export function toggleSidebar(force) {
  const l = document.querySelector('.layout');
  const c = force ?? !l.classList.contains('collapsed');
  l.classList.toggle('collapsed', c);
  if (innerWidth >= 760) { app.opts.sidebar = !c; saveOpts(); }
}

function sidebar() {
  const { S } = app;
  const pri = S.venues.filter((v) => v.priority < 4).sort((a, b) => a.priority - b.priority || b.heat - a.heat).slice(0, 12);
  const due = S.tasks.filter((t) => !t.done_at && t.due && t.due <= S.today).length;
  const counts = { researchers: S.researchers.length, venues: S.venues.filter((v) => v.people > 0 || v.priority < 4).length, upcoming: due || '' };
  const cur = app.route[0] === 'r' ? 'researchers' : app.route[0] === 'v' ? 'venues' : app.route[0];
  document.getElementById('sidebar').innerHTML = `
    <div class="side-head">
      <button class="me" data-act="me-menu"><span class="avatar">${esc(initials(S.me.name))}</span><span>${esc(S.me.name || 'Me')}</span></button>
      <button class="icon-btn" data-act="toggle-sidebar" title="Close sidebar (m)">${I.sidebar}</button>
    </div>
    <ul class="nav">
      <li><button class="navlink add-link" data-act="quick-add" title="Quick add (q)"><span class="plus">${I.plus}</span>Add</button></li>
      <li><button class="navlink" data-act="palette" title="Search (/)">${I.search}Search</button></li>
      ${NAV.map(([k, label, icon]) => `<li><a href="#/${k}" class="${cur === k ? 'active' : ''}">${icon}${label}<span class="count">${counts[k] ?? ''}</span></a></li>`).join('')}
    </ul>
    <div class="side-section">
      <h4><span>Priority venues</span></h4>
      <ul class="nav">${pri.length ? pri.map((v) => `<li><a href="#/v/${v.id}" class="${app.route[1] === v.id ? 'active' : ''}"><span class="dot" style="background:var(--p${v.priority})"></span>${esc(vName(v))}<span class="count">${v.heat || ''}</span></a></li>`).join('')
        : '<li class="muted" style="font-size:12px;padding:4px 8px">Press 1–3 on a venue to pin it here.</li>'}</ul>
    </div>
    <div class="side-foot"><a href="#/settings" style="text-decoration:none">${'Settings'}</a> · <button data-act="shortcuts">Shortcuts</button></div>`;
}

export const vName = (v) => v.conf_title || v.abbr || v.name;

// ---------------------------------------------------------------- router
export function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : [app.S.researchers.length ? 'venues' : 'researchers'];
}

export function render() {
  shell();
  app.route = parseRoute();
  app.sel = -1;
  sidebar();
  const view = document.getElementById('view');
  view.classList.toggle('wide', app.route[0] === 'graph');
  const [k, id] = app.route;
  const fn = { researchers: V.researchers, venues: V.venues, upcoming: V.upcoming, graph: V.graph, insights: V.insights, settings: V.settings,
    r: () => V.researcher(id), v: () => V.venue(id) }[k] || V.venues;
  Promise.resolve(fn(view)).catch((e) => { view.innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`; });
  if (innerWidth < 760) toggleSidebar(true);
}

// ---------------------------------------------------------------- actions
export async function addResearcher(input, note) {
  const r = await api('/api/researchers', { method: 'POST', body: { input, note } });
  if (r.status === 'choose') return chooseCandidate(r, note);
  const name = r.researcher.name;
  await refresh();
  toast(r.status === 'added' ? `Added ${name} · ${r.researcher.top_venues.length ? 'top venue ' + r.researcher.top_venues[0].name : 'no venues found'}` : `${name} is already tracked`);
  return r;
}

function chooseCandidate(r, note) {
  const d = dialog(`<h3>Which ${esc(r.query)}?</h3><div class="body"><p class="muted" style="margin:0 0 8px;font-size:13px">OpenAlex has several profiles with this name. Pick the right one (usually the one with the most papers).</p>
    ${r.candidates.map((c, i) => `<div class="cand${i === 0 ? ' sel' : ''}" data-id="${esc(c.id)}"><span class="avatar" style="background:${seniorColor(c.h_index)}">${esc(initials(c.name))}</span>
      <div class="main"><div><b>${esc(c.name)}</b></div><div class="muted" style="font-size:12px">${esc(c.institution || 'No institution')} · h ${c.h_index} · ${fmtN(c.works)} works · ${fmtN(c.cited_by)} cites</div>
      <div class="muted" style="font-size:12px">${esc(c.topics.join(' · '))}</div></div></div>`).join('')}</div>`);
  let i = 0;
  const items = [...d.el.querySelectorAll('.cand')];
  const pick = async (id) => { d.close(); toast('Importing…'); try { await addResearcher(id, note); } catch (e) { toast(e.message, { error: true }); } };
  items.forEach((el) => el.addEventListener('click', () => pick(el.dataset.id)));
  d.el.tabIndex = -1; d.el.focus();
  d.el.addEventListener('keydown', (e) => {
    if (['ArrowDown', 'j'].includes(e.key)) i = Math.min(items.length - 1, i + 1);
    else if (['ArrowUp', 'k'].includes(e.key)) i = Math.max(0, i - 1);
    else if (e.key === 'Enter') return pick(items[i].dataset.id);
    else return;
    e.preventDefault();
    items.forEach((el, j) => el.classList.toggle('sel', j === i));
    items[i].scrollIntoView({ block: 'nearest' });
  });
}

export async function setVenuePriority(id, priority) {
  await api(`/api/venues/${id}`, { method: 'PATCH', body: { priority } });
  await refresh({ keepDetail: false });
}

export function priorityMenu(anchor, current, onPick) {
  menu(anchor, [{ lbl: 'Priority' }, ...[1, 2, 3, 4].map((p) => ({ label: p === 4 ? 'Priority 4 (none)' : `Priority ${p}`, key: String(p),
    icon: `<span class="flag p${p}">${p === 4 ? I.flag : I.flagFill}</span>`, cls: p === current ? 'sel' : '', onClick: () => onPick(p) }))]);
}

export async function completeTask(t) {
  await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done_at } });
  await refresh({ keepDetail: true });
  if (!t.done_at) toast('1 task completed', { undo: async () => { await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { done: false } }); refresh({ keepDetail: true }); } });
}

// ---------------------------------------------------------------- quick add (q / p)
const looksLikeProfile = (s) => /^https?:\/\//i.test(s.trim()) || /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(s.trim()) || /^A\d{6,}$/i.test(s.trim());

export function quickAdd(mode = app.opts.qaMode || 'task', preset = '') {
  const d = dialog(`<div class="tabs"><button data-m="task">Task</button><button data-m="person">Researcher</button><span class="muted" style="margin-left:auto;font-size:12px;align-self:center">Tab to switch</span></div>
    <form class="editor"><input class="big" name="q" autocomplete="off" spellcheck="false">
      <input name="note" autocomplete="off" placeholder="Note (optional)" style="width:100%;border:0;outline:0;background:none;font-size:13px;color:var(--muted);padding:2px 0" hidden>
      <div class="hint"></div>
      <div class="bar"><span class="left"></span><button type="button" class="btn ghost" data-act="cancel">Cancel</button><button class="btn primary" type="submit">Add</button></div></form>`);
  const f = d.el.querySelector('form'), q = f.q, hint = f.querySelector('.hint'), submit = f.querySelector('[type=submit]');
  const setMode = (m) => {
    mode = m; app.opts.qaMode = m; saveOpts();
    d.el.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    q.placeholder = m === 'task' ? 'e.g. Submit abstract fri p1 #NeurIPS' : 'Paste a profile link (OpenAlex, ORCID, Scholar, Semantic Scholar, dblp, homepage) or a name';
    f.note.hidden = m !== 'person';
    submit.textContent = m === 'task' ? 'Add task' : 'Add researcher';
    update(); q.focus();
  };
  const update = () => {
    if (mode === 'person') { hint.innerHTML = q.value.trim() ? (looksLikeProfile(q.value) ? 'Profile link' : 'Search by name') + ' · imports papers, fields, keywords and venues from OpenAlex' : ''; return; }
    if (looksLikeProfile(q.value)) return setMode('person');
    const p = parseQuickAdd(q.value, app.S.today);
    const dl = dueLabel(p.due, app.S.today);
    hint.innerHTML = [dl && `<span class="pill"><span class="due ${dl.cls}">${I.cal.replace('<svg', '<svg width="12" height="12"')} ${esc(dl.text)}</span></span>`,
      p.priority < 4 && `<span class="pill p${p.priority}">P${p.priority}</span>`, p.venue && `<span class="pill"># ${esc(p.venue)}</span>`].filter(Boolean).join('')
      || '<span>Dates: today, fri, next week, dec 5 · p1–p4 · #Venue</span>';
    submit.disabled = !p.content;
  };
  d.el.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
  f.querySelector('[data-act=cancel]').onclick = () => d.close();
  q.addEventListener('input', update);
  q.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); setMode(mode === 'task' ? 'person' : 'task'); } });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = q.value.trim();
    if (!val) return;
    submit.disabled = true;
    try {
      if (mode === 'task') {
        await api('/api/tasks', { method: 'POST', body: { text: val } });
        q.value = ''; update(); toast('Task added');
        await refresh({ keepDetail: false });
      } else {
        submit.innerHTML = '<span class="spinner"></span> Importing';
        const note = f.note.value.trim();
        d.close();
        toast('Importing from OpenAlex…');
        await addResearcher(val, note);
      }
    } catch (err) { toast(err.message, { error: true }); }
    finally { submit.disabled = false; if (mode === 'person') submit.textContent = 'Add researcher'; }
  });
  q.value = preset;
  setMode(looksLikeProfile(preset) ? 'person' : mode);
}

// ---------------------------------------------------------------- search / command palette
export function palette() {
  const { S } = app;
  const cmds = [
    ...NAV.map(([k, label, icon, key]) => ({ g: 'Navigate', label: 'Go to ' + label, icon, k: 'g ' + key, run: () => go('#/' + k) })),
    { g: 'Navigate', label: 'Go to Settings', icon: I.settings, k: 'g s', run: () => go('#/settings') },
    { g: 'Add', label: 'Add task', icon: I.plus, k: 'q', run: () => quickAdd('task') },
    { g: 'Add', label: 'Add researcher', icon: I.person, k: 'p', run: () => quickAdd('person') },
    { g: 'Add', label: 'Connect Claude Code / Codex (MCP)', icon: I.bolt, run: () => go('#/settings') },
  ];
  const people = S.researchers.map((r) => ({ g: 'Researchers', label: r.name, sub: r.institution, icon: I.person, run: () => go('#/r/' + r.id) }));
  const venues = S.venues.map((v) => ({ g: 'Venues', label: vName(v), sub: v.conf_name || v.name, icon: I.venue, run: () => go('#/v/' + v.id) }));
  const d = dialog('<div class="palette"><input placeholder="Search researchers, venues, commands…" autocomplete="off"><div class="list"></div></div>', { cls: 'pal' });
  const input = d.el.querySelector('input'), list = d.el.querySelector('.list');
  let items = [], i = 0;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const match = (x) => !q || (x.label + ' ' + (x.sub || '')).toLowerCase().includes(q);
    items = [...people.filter(match), ...venues.filter(match), ...cmds.filter(match)].slice(0, 40);
    if (q && !items.length && q.length > 2) items = [{ g: 'Add', label: `Add researcher "${input.value.trim()}"`, icon: I.plus, run: () => quickAdd('person', input.value.trim()) }];
    i = Math.min(i, Math.max(0, items.length - 1));
    let g = '';
    list.innerHTML = '<ul>' + items.map((x, j) => (x.g !== g ? `<div class="group">${esc((g = x.g))}</div>` : '') +
      `<li data-j="${j}" class="${j === i ? 'sel' : ''}">${x.icon}<span>${esc(x.label)}${x.sub ? ` <span class="muted" style="font-size:12px">${esc(x.sub)}</span>` : ''}</span>${x.k ? `<span class="k"><kbd>${esc(x.k)}</kbd></span>` : ''}</li>`).join('') + '</ul>';
  };
  const run = (j) => { const x = items[j]; if (x) { d.close(); x.run(); } };
  input.addEventListener('input', () => { i = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') i = Math.min(items.length - 1, i + 1);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - 1);
    else if (e.key === 'Enter') return run(i);
    else return;
    e.preventDefault(); draw(); list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  });
  list.addEventListener('click', (e) => { const li = e.target.closest('li[data-j]'); if (li) run(+li.dataset.j); });
  draw(); input.focus();
}

export function shortcuts() {
  const rows = [['q', 'Quick add (task, or paste a link)'], ['p', 'Add researcher'], ['/ or ⌘K', 'Search and commands'], ['m', 'Toggle sidebar'],
    ['g r · g v · g u', 'Researchers · Venues · Upcoming'], ['g g · g i · g s', 'Graph · Insights · Settings'], ['j / k', 'Move selection'], ['Enter', 'Open selected'],
    ['e', 'Complete selected task'], ['1 – 4', 'Set priority of selected venue or task'], ['Esc', 'Close or go back'], ['?', 'This list']];
  dialog(`<h3>Keyboard shortcuts</h3><div class="body"><div class="shortcuts">${rows.map(([k, l]) => `<div>${k.split(' ').map((x) => /^[a-z0-9/⌘?–]|Enter|Esc|K$/i.test(x) && x !== 'or' && x !== '·' ? `<kbd>${esc(x)}</kbd>` : esc(x)).join(' ')}</div><div>${esc(l)}</div>`).join('')}</div></div>`);
}

// ---------------------------------------------------------------- keyboard
let gPending = 0;
const rows = () => [...document.querySelectorAll('#view [data-row]')];
export function select(i) {
  const rs = rows();
  if (!rs.length) return;
  app.sel = Math.max(0, Math.min(rs.length - 1, i));
  rs.forEach((r, j) => r.classList.toggle('sel', j === app.sel));
  rs[app.sel].scrollIntoView({ block: 'nearest' });
}

document.addEventListener('keydown', (e) => {
  if (!app.S) return;
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  if (e.key === 'Escape') {
    if (closeOverlay()) return e.preventDefault();
    if (typing) { e.target.blur(); return; }
    if (app.route[0] === 'r') return go('#/researchers');
    if (app.route[0] === 'v') return go('#/venues');
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); return palette(); }
  if (typing || hasOverlay() || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (Date.now() - gPending < 1200) {
    gPending = 0;
    const to = { r: 'researchers', v: 'venues', u: 'upcoming', g: 'graph', i: 'insights', s: 'settings' }[k];
    if (to) { e.preventDefault(); go('#/' + to); }
    return;
  }
  const sel = rows()[app.sel];
  const actions = {
    q: () => quickAdd(), p: () => quickAdd('person'), '/': () => palette(), m: () => toggleSidebar(), '?': () => shortcuts(),
    g: () => { gPending = Date.now(); },
    j: () => select(app.sel + 1), ArrowDown: () => select(app.sel + 1), k: () => select(app.sel - 1), ArrowUp: () => select(app.sel - 1),
    Enter: () => sel?.click(),
    e: () => { const t = sel && app.S.tasks.find((x) => x.id === +sel.dataset.task); if (t) completeTask(t); },
  };
  if (/^[1-4]$/.test(k) && sel) {
    e.preventDefault();
    if (sel.dataset.venue) return setVenuePriority(sel.dataset.venue, +k).then(() => toast(`Priority ${k}`));
    if (sel.dataset.task) return api(`/api/tasks/${sel.dataset.task}`, { method: 'PATCH', body: { priority: +k } }).then(() => refresh({ keepDetail: true }));
    return;
  }
  if (actions[k]) { e.preventDefault(); actions[k](); }
});

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'toggle-sidebar') toggleSidebar();
  else if (act === 'quick-add') quickAdd();
  else if (act === 'palette') palette();
  else if (act === 'shortcuts') shortcuts();
  else if (act === 'me-menu') menu(a, [
    { label: 'Settings', icon: I.settings, key: 'g s', onClick: () => go('#/settings') },
    { label: 'Connect agents (MCP)', icon: I.bolt, onClick: () => go('#/settings') },
    { label: 'Keyboard shortcuts', icon: I.key, key: '?', onClick: shortcuts }, 'hr',
    { label: 'Sign out', icon: I.back, onClick: signOut },
  ]);
});

window.addEventListener('hashchange', () => { if (app.S) { closeOverlay(); render(); } });

// ---------------------------------------------------------------- boot
async function boot() {
  const user = await authMe();
  const root = document.getElementById('app');
  if (!user) {
    root.innerHTML = `<div class="landing"><div class="logo">${I.graph}</div><h1>confmap</h1>
      <p>Track researchers. See which conferences the senior people go to, how prestigious they are, and plan how to get there.</p>
      <div id="signin"></div>
      <ul><li>Paste a prof's profile link: papers, fields, keywords and venues are imported from OpenAlex.</li>
      <li>Venues are scored by CORE/CCF rank, citations, and how many senior people go.</li>
      <li>Works with Claude Code and Codex over MCP.</li></ul></div>`;
    await mountSignIn(root.querySelector('#signin'), { onError: (m) => toast(m, { error: true }) });
    return;
  }
  await load();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (tz && tz !== app.S.me.tz) { api('/api/me', { method: 'POST', body: { tz } }).then(load).then(render).catch(() => {}); }
  render();
}

boot().catch((err) => { document.getElementById('app').innerHTML = `<div class="empty"><h3>Failed to load</h3><p>${esc(err.message)}</p></div>`; });

export { mountAccountPanel, I, esc, fmtN, initials, seniorColor, coreBadge, ccfBadge, toast, api, dialog, menu, dueLabel, addDays, daysBetween, todayIn, milestones, SENIOR_H, insights, parseQuickAdd };
