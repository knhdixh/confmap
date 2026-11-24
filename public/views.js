import { app, go, refresh, vName, addResearcher, setVenuePriority, priorityMenu, completeTask, quickAdd, select, saveOpts } from '/app.js';
import { I, esc, fmtN, initials, seniorColor, coreBadge, ccfBadge, toast, api, menu, dialog, bars, scatter } from '/ui.js';
import { dueLabel, addDays, daysBetween } from '/lib/dates.js';
import { SENIOR_H, milestones, describeRho } from '/lib/metrics.js';
import { insights as computeInsights } from '/lib/model.js';
import { mountAccountPanel } from '/auth.js';

const EMPTY_ART = '<svg viewBox="0 0 120 90" fill="none"><circle cx="30" cy="40" r="10" fill="currentColor" opacity=".25"/><circle cx="85" cy="28" r="14" fill="currentColor" opacity=".45"/><circle cx="70" cy="70" r="9" fill="currentColor" opacity=".3"/><path d="M38 43 72 31M36 48l27 17M80 41l-6 21" stroke="currentColor" stroke-width="2" opacity=".5"/></svg>';

const head = (title, sub = '', opts = '') => `<header class="view-head"><div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="grow"></div><div class="view-opts">${opts}</div></header>`;
const seg = (name, options, cur) => `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
function bindSeg(el, name, cb) {
  el.querySelector(`[data-seg="${name}"]`)?.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) cb(b.dataset.v); });
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const daysText = (n) => n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
const dueCls = (n) => n <= 7 ? 'overdue' : n <= 30 ? 'tomorrow' : n <= 90 ? 'week' : 'later';

function inlineAdd(container, { label, placeholder, onSubmit, suggest, preset = '', open = false }) {
  const wrap = document.createElement('div');
  container.append(wrap);
  const closed = () => {
    wrap.innerHTML = `<button class="add-row"><span class="plus">${I.plus}</span>${esc(label)}</button>`;
    wrap.firstChild.onclick = opened;
  };
  const opened = () => {
    wrap.innerHTML = `<form class="editor"><input class="big" name="q" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}"><div class="hint"></div>
      <div class="bar"><button type="button" class="btn ghost">Cancel</button><button class="btn primary" type="submit">${esc(label)}</button></div></form>`;
    const f = wrap.firstChild, hint = f.querySelector('.hint');
    f.q.value = preset;
    f.querySelector('.btn.ghost').onclick = closed;
    f.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closed(); } });
    if (suggest) f.q.addEventListener('input', () => suggest(f.q.value, hint, (v) => { f.q.value = v; f.requestSubmit(); }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = f.q.value.trim();
      if (!v) return;
      const b = f.querySelector('[type=submit]');
      b.disabled = true; b.innerHTML = '<span class="spinner"></span>';
      try { await onSubmit(v); } catch (err) { toast(err.message, { error: true }); b.disabled = false; b.textContent = label; }
    });
    f.q.focus();
  };
  open ? opened() : closed();
}

// ================================================================ researchers
export function researchers(el) {
  const { S } = app;
  const sort = app.opts.rsort || 'h';
  const list = [...S.researchers].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : sort === 'added' ? (a, b) => b.added_at - a.added_at : (a, b) => b.h_index - a.h_index);
  const venuesOf = new Map();
  for (const l of S.links) if (l.n_recent > 0) (venuesOf.get(l.author_id) || venuesOf.set(l.author_id, []).get(l.author_id)).push(l);
  const seniors = list.filter((r) => r.h_index >= SENIOR_H).length;
  el.innerHTML = head('Researchers', list.length ? `${list.length} tracked · ${seniors} senior (h ≥ ${SENIOR_H})` : '', seg('rsort', [['h', 'h-index'], ['added', 'Recent'], ['name', 'Name']], sort)) +
    (list.length ? `<ul class="rows">${list.map((r) => {
      const vs = (venuesOf.get(r.id) || []).sort((a, b) => b.n_recent - a.n_recent).slice(0, 3).map((l) => S.vById.get(l.venue_id)).filter(Boolean);
      return `<li class="row" data-row data-href="#/r/${r.id}">
        <span class="avatar" style="background:${seniorColor(r.h_index)}" title="h-index ${r.h_index}">${esc(initials(r.name))}</span>
        <div class="main"><div class="title">${esc(r.name)}</div>
          <div class="meta"><span>${esc(r.institution || 'Unknown institution')}</span><span>h ${r.h_index}</span><span>${fmtN(r.cited_by)} cites</span>
          ${r.topics.slice(0, 2).map((t) => `<span class="tag">${I.hash}${esc(t.name)}</span>`).join('')}</div></div>
        <div class="side"><span class="hover-acts"><button class="icon-btn" data-refresh="${r.id}" title="Refresh from OpenAlex">${I.refresh}</button><button class="icon-btn" data-remove="${r.id}" title="Stop tracking">${I.trash}</button></span>
          ${vs.map((v) => `<span class="badge">${esc(vName(v))}</span>`).join(' ')}</div></li>`;
    }).join('')}</ul>` : `<div class="empty">${EMPTY_ART}<h3>Start with one prof</h3><p>Paste a profile link (OpenAlex, ORCID, Google Scholar, Semantic Scholar, dblp or a homepage) or a name.<br>Press <kbd>p</kbd> any time, or let Claude Code add them over MCP.</p></div>`);
  bindSeg(el, 'rsort', (v) => { app.opts.rsort = v; saveOpts(); researchers(el); });
  inlineAdd(el, { label: 'Add researcher', placeholder: 'Profile link or name, e.g. https://orcid.org/0000-0002-… or "Pieter Abbeel"', open: !list.length,
    onSubmit: async (v) => { toast('Importing from OpenAlex…'); await addResearcher(v); } });
  bindRows(el);
}

function bindRows(el) {
  el.querySelectorAll('[data-row]').forEach((row, i) => row.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input')) return;
    select(i);
    if (row.dataset.href) go(row.dataset.href);
  }));
  el.querySelectorAll('[data-refresh]').forEach((b) => b.addEventListener('click', async () => {
    b.innerHTML = '<span class="spinner"></span>';
    try { await api(`/api/researchers/${b.dataset.refresh}/refresh`, { method: 'POST' }); await refresh(); toast('Refreshed'); }
    catch (e) { toast(e.message, { error: true }); b.innerHTML = I.refresh; }
  }));
  el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.remove, r = app.S.rById.get(id);
    await api(`/api/researchers/${id}`, { method: 'DELETE' });
    await refresh();
    toast(`Removed ${r?.name || id}`, { undo: () => addResearcher(id) });
    if (app.route[0] === 'r') go('#/researchers');
  }));
  el.querySelectorAll('[data-pri]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = app.S.vById.get(b.dataset.pri);
    priorityMenu(b, v?.priority || 4, (p) => setVenuePriority(b.dataset.pri, p));
  }));
  el.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = app.S.tasks.find((x) => x.id === +b.dataset.check);
    if (t) completeTask(t);
  }));
  el.querySelectorAll('[data-del-task]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    await api(`/api/tasks/${b.dataset.delTask}`, { method: 'DELETE' });
    await refresh({ keepDetail: true }); toast('Task deleted');
  }));
  el.querySelectorAll('[data-edit-task]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); editTask(+b.dataset.editTask); }));
}

// ================================================================ venues
function venueRow(v) {
  const n = v.next;
  const dl = n?.upcoming ? `<span class="due ${n.estimated ? 'later' : dueCls(n.daysLeft)}" title="${n.estimated ? 'Estimated from last year' : ''}">${I.clock}${esc(n.kind)} ${n.estimated ? '~' + new Date(n.at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' (est.)' : daysText(n.daysLeft)}</span>` : n?.year ? `<span>${I.cal}${esc(n.year)}</span>` : '';
  return `<li class="row" data-row data-venue="${v.id}" data-href="#/v/${v.id}">
    <button class="circle p${v.priority}" data-pri="${v.id}" title="Priority ${v.priority} (1–4)">${I.flagFill}</button>
    <div class="main"><div class="title">${esc(vName(v))}${vName(v) !== (v.conf_name || v.name) ? ` <span class="muted">· ${esc(v.conf_name || v.name)}</span>` : ''}</div>
      <div class="meta">${coreBadge(v.core)}${ccfBadge(v.ccf)}${v.type === 'journal' ? '<span class="badge">Journal</span>' : ''}<span title="Citation h-index (OpenAlex)">h ${v.h_index}</span>
      <span title="Prestige 0-100">prestige ${v.prestige}</span>${v.people ? `<span>${I.people}${v.people}${v.seniors ? ` · ${v.seniors} senior` : ''}</span>` : ''}${dl}
      ${n?.upcoming && !n.estimated && n.place ? `<span>${I.pin}${esc(n.place.split(';')[0])}</span>` : ''}</div></div>
    <div class="side"><span class="heat" title="Heat: h-index of tracked people, weighted by recent papers">${I.flame}${v.heat}</span></div></li>`;
}

export function venues(el) {
  const { S } = app;
  const sort = app.opts.vsort || 'heat', group = app.opts.vgroup ?? true, confOnly = app.opts.vconf ?? false;
  const minor = app.opts.vminor ?? false;
  let list = S.venues.filter((v) => v.people > 0 || v.priority < 4);
  const isMinor = (v) => v.priority === 4 && !v.conf_key && v.people < 2;
  const hidden = minor ? 0 : list.filter(isMinor).length;
  if (!minor) list = list.filter((v) => !isMinor(v));
  if (confOnly) list = list.filter((v) => v.type === 'conference' || v.conf_key);
  const key = { heat: (v) => -v.heat, prestige: (v) => -v.prestige * 1e4 - v.heat, deadline: (v) => (v.next?.upcoming ? v.next.at : 9e15), name: null }[sort];
  list.sort(key ? (a, b) => key(a) - key(b) : (a, b) => vName(a).localeCompare(vName(b)));
  const sections = group ? [1, 2, 3, 4].map((p) => [p === 4 ? (list.some((v) => v.priority < 4) ? 'Other' : 'All venues') : `Priority ${p}`, list.filter((v) => v.priority === p)]).filter(([, l]) => l.length) : [['', list]];
  el.innerHTML = head('Venues', list.length ? `${list.length} venues · heat = h-index of the tracked people who go` : '',
    seg('vsort', [['heat', 'Heat'], ['prestige', 'Prestige'], ['deadline', 'Deadline'], ['name', 'Name']], sort) +
    `<button class="chip-btn ${confOnly ? 'on' : ''}" data-t="vconf">Conferences only</button><button class="chip-btn ${group ? 'on' : ''}" data-t="vgroup">Group by priority</button><button class="chip-btn ${minor ? 'on' : ''}" data-t="vminor" title="Venues with one tracked person and no CORE/CCF entry">Minor venues${hidden ? ` (${hidden})` : ''}</button>`) +
    (list.length ? sections.map(([title, l]) => (title ? `<div class="section-head">${esc(title)} <span class="n">${l.length}</span></div>` : '') + `<ul class="rows">${l.map(venueRow).join('')}</ul>`).join('')
      : `<div class="empty">${EMPTY_ART}<h3>No venues yet</h3><p>Venues appear when you track researchers. You can also add one by name.</p></div>`);
  bindSeg(el, 'vsort', (v) => { app.opts.vsort = v; saveOpts(); venues(el); });
  el.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { app.opts[b.dataset.t] = !(app.opts[b.dataset.t] ?? b.dataset.t === 'vgroup'); saveOpts(); venues(el); }));
  let timer;
  inlineAdd(el, { label: 'Add venue', placeholder: 'Conference name or acronym, e.g. CHI or "Symposium on Operating Systems Principles"',
    suggest: (q, hint, pick) => {
      clearTimeout(timer);
      if (q.trim().length < 2) { hint.innerHTML = ''; return; }
      timer = setTimeout(async () => {
        const { confs } = await api('/api/venues/search?q=' + encodeURIComponent(q.trim()));
        hint.innerHTML = confs.map((c) => `<button type="button" class="chip-btn" data-c="${esc(c.title)}">${esc(c.title)} <span class="muted">${esc(c.core ? 'CORE ' + c.core : '')}</span></button>`).join('');
        hint.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => pick(b.dataset.c));
      }, 200);
    },
    onSubmit: async (q) => { const { id } = await api('/api/venues', { method: 'POST', body: { query: q } }); await refresh(); go('#/v/' + id); toast('Venue added at priority 3'); } });
  bindRows(el);
}

// ================================================================ upcoming
function taskRow(t) {
  const { S } = app;
  const dl = dueLabel(t.due, S.today), v = t.venue_id && S.vById.get(t.venue_id);
  return `<li class="row${t.done_at ? ' done' : ''}" data-row data-task="${t.id}">
    <button class="circle p${t.priority}${t.done_at ? ' checked' : ''}" data-check="${t.id}" title="Complete (e)">${I.check}</button>
    <div class="main"><div class="title">${esc(t.content)}</div>
      <div class="meta">${dl ? `<span class="due ${dl.cls}">${I.cal}${esc(dl.text)}</span>` : ''}${v ? `<a class="tag" href="#/v/${v.id}">${I.hash}${esc(vName(v))}</a>` : ''}</div></div>
    <div class="side"><span class="hover-acts"><button class="icon-btn" data-edit-task="${t.id}" title="Edit">${I.edit}</button><button class="icon-btn" data-del-task="${t.id}" title="Delete">${I.trash}</button></span></div></li>`;
}

function editTask(id) {
  const t = app.S.tasks.find((x) => x.id === id);
  if (!t) return;
  const v = t.venue_id && app.S.vById.get(t.venue_id);
  const d = dialog(`<form class="editor"><input class="big" name="content" autocomplete="off"><div class="hint"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><input name="due" type="date" class="pill" style="padding:3px 6px">
    <select name="priority" class="pill" style="padding:3px 6px">${[1, 2, 3, 4].map((p) => `<option value="${p}" ${p === t.priority ? 'selected' : ''}>Priority ${p}</option>`).join('')}</select>
    ${v ? `<span class="pill">#${esc(vName(v))}</span>` : ''}</div>
    <div class="bar"><button type="button" class="btn ghost">Cancel</button><button class="btn primary">Save</button></div></form>`);
  const f = d.el.querySelector('form');
  f.content.value = t.content; f.due.value = t.due || '';
  f.querySelector('.btn.ghost').onclick = () => d.close();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api(`/api/tasks/${id}`, { method: 'PATCH', body: { content: f.content.value, due: f.due.value || '', priority: +f.priority.value } }); d.close(); await refresh({ keepDetail: true }); }
    catch (err) { toast(err.message, { error: true }); }
  });
  f.content.focus();
}

export function upcoming(el) {
  const { S } = app;
  const today = S.today, horizon = addDays(today, 120);
  const mine = S.venues.filter((v) => v.people > 0 || v.priority < 4);
  const days = new Map();
  const put = (day, item) => (days.get(day) || days.set(day, []).get(day)).push(item);
  const open = S.tasks.filter((t) => !t.done_at);
  const overdue = open.filter((t) => t.due && t.due < today);
  for (const t of open) if (t.due && t.due >= today && t.due <= horizon) put(t.due, { t });
  for (const v of mine) for (const m of milestones(v.editions).filter((x) => x.kind === 'Abstract' || x.kind === 'Paper')) {
    const day = new Date(m.at).toISOString().slice(0, 10);
    if (day >= today && day <= horizon) put(day, { m, v });
  }
  const nodate = open.filter((t) => !t.due);
  const sorted = [...days.keys()].sort();
  const dayHead = (d) => {
    const n = daysBetween(today, d), dt = new Date(d + 'T00:00:00Z');
    const nice = dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const wd = dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return `${nice} · ${n === 0 ? 'Today · ' : n === 1 ? 'Tomorrow · ' : ''}${wd}`;
  };
  const msRow = ({ m, v }) => `<li class="row" data-row data-href="#/v/${v.id}"><span class="cal-icon">${I.cal}</span>
    <div class="main"><div class="title"><b>${esc(vName(v))} ${esc(m.year)}</b> · ${esc(m.kind)} deadline</div>
      <div class="meta">${coreBadge(v.core)}${v.people ? `<span>${I.people}${v.people} going</span>` : ''}${m.place ? `<span>${I.pin}${esc(m.place.split(';')[0])}</span>` : ''}${m.date ? `<span>${esc(m.date)}</span>` : ''}</div></div>
    <div class="side"><span class="hover-acts"><button class="icon-btn" data-plan="${v.id}" data-day="${new Date(m.at).toISOString().slice(0, 10)}" title="Plan a task for this">${I.plus}</button></span><span class="heat">${I.flame}${v.heat}</span></div></li>`;
  el.innerHTML = head('Upcoming', 'Your tasks and the deadlines of your venues, next 4 months') +
    (overdue.length ? `<div class="section-head">Overdue <span class="n">${overdue.length}</span></div><ul class="rows">${overdue.map(taskRow).join('')}</ul>` : '') +
    sorted.map((d) => `<div class="section-head">${esc(dayHead(d))} <span class="n">${days.get(d).length}</span></div><ul class="rows">${days.get(d).map((x) => x.t ? taskRow(x.t) : msRow(x)).join('')}</ul>`).join('') +
    (nodate.length ? `<div class="section-head">No date <span class="n">${nodate.length}</span></div><ul class="rows">${nodate.map(taskRow).join('')}</ul>` : '') +
    (!sorted.length && !overdue.length && !nodate.length ? `<div class="empty">${EMPTY_ART}<h3>Nothing coming up</h3><p>Deadlines of venues your tracked people go to show up here. Press <kbd>q</kbd> to add a task.</p></div>` : '');
  inlineAdd(el, { label: 'Add task', placeholder: 'e.g. Apply for student volunteer dec 10 p2 #ICML', onSubmit: async (text) => { await api('/api/tasks', { method: 'POST', body: { text } }); await refresh(); toast('Task added'); } });
  el.querySelectorAll('[data-plan]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = app.S.vById.get(b.dataset.plan);
    const due = addDays(b.dataset.day, -14) < today ? today : addDays(b.dataset.day, -14);
    quickAdd('task', `Draft ${vName(v)} submission ${due} p2 #"${vName(v)}"`);
  }));
  bindRows(el);
}

// ================================================================ researcher detail
export async function researcher(id) {
  const el = document.getElementById('view');
  let r = app.cache.get('r' + id);
  if (!r) { el.innerHTML = '<div class="loading">Loading…</div>'; r = await api('/api/researchers/' + id); app.cache.set('r' + id, r); }
  if (app.route[1] !== id) return;
  const { S } = app;
  const tab = app.opts.rtab || 'top';
  const years = r.by_year.filter((y) => y.year >= new Date().getFullYear() - 14);
  const maxT = Math.max(...r.topics.map((t) => t.count), 1);
  const nameQ = encodeURIComponent(r.name);
  el.innerHTML = `<a class="crumb" href="#/researchers">${I.back.replace('<svg', '<svg width="12" height="12"')} Researchers</a>
    <div class="profile-head"><span class="avatar lg" style="background:${seniorColor(r.h_index)}">${esc(initials(r.name))}</span>
      <div><h1>${esc(r.name)}</h1><div class="sub">${esc(r.institution || 'Unknown institution')}${r.country ? ' · ' + esc(r.country) : ''}${r.h_index >= SENIOR_H ? ' · senior' : ''}</div>
      <div class="links"><a href="https://openalex.org/${esc(r.id)}" target="_blank" rel="noopener">OpenAlex ↗</a>${r.orcid ? `<a href="https://orcid.org/${esc(r.orcid)}" target="_blank" rel="noopener">ORCID ↗</a>` : ''}
        <a href="https://scholar.google.com/scholar?q=${nameQ}" target="_blank" rel="noopener">Google Scholar ↗</a><a href="https://www.semanticscholar.org/search?q=${nameQ}" target="_blank" rel="noopener">Semantic Scholar ↗</a>
        <a href="https://dblp.org/search?q=${nameQ}" target="_blank" rel="noopener">dblp ↗</a>${r.source && /^https?:/.test(r.source) ? `<a href="${esc(r.source)}" target="_blank" rel="noopener">Added from ↗</a>` : ''}</div></div>
      <div class="acts">${r.tracked ? `<button class="icon-btn" data-refresh="${r.id}" title="Refresh">${I.refresh}</button><button class="icon-btn" data-remove="${r.id}" title="Stop tracking">${I.trash}</button>`
        : `<button class="btn primary" id="track">Track</button>`}</div></div>
    ${r.tracked ? `<textarea class="note-box" id="note" placeholder="Notes (where you met, what they work on, who introduced you…)" rows="2">${esc(r.note || '')}</textarea>` : ''}
    <div class="stats"><div class="stat"><div class="v">${r.h_index}</div><div class="l">h-index</div></div><div class="stat"><div class="v">${fmtN(r.cited_by)}</div><div class="l">citations</div></div>
      <div class="stat"><div class="v">${fmtN(r.works_count)}</div><div class="l">works</div></div><div class="stat"><div class="v">${r.i10_index}</div><div class="l">i10-index</div></div>
      <div class="stat"><div class="v">${(r.mean2yr || 0).toFixed(1)}</div><div class="l">2-yr mean citedness</div></div></div>
    <div class="section-head">Citations per year</div><div class="chart">${bars(years.map((y) => ({ label: "'" + String(y.year).slice(2), v: y.cites })))}</div>
    <div class="section-head">Fields <span class="n">${r.topics.length}</span></div>
    ${r.topics.map((t) => `<div class="topic"><div class="t">${esc(t.name)}<small>${esc([t.subfield, t.field].filter(Boolean).join(' · '))} · ${t.count} papers</small></div><div class="meter"><i style="width:${(100 * t.count / maxT).toFixed(0)}%"></i></div></div>`).join('')}
    <div class="section-head">Keywords <span class="n">last 6 years</span></div>
    <div class="chips">${r.keywords.map((k) => `<span class="chip">${esc(k.name)}<i>${k.count}</i></span>`).join('') || '<span class="muted">None</span>'}</div>
    <div class="section-head">Venues <span class="n">${r.venues.length}</span><span class="right">recent = last 4 years</span></div>
    <ul class="rows">${r.venues.slice(0, 30).map((v) => `<li class="row" data-row data-venue="${v.id}" data-href="#/v/${v.id}">
      <button class="circle p${v.priority}" data-pri="${v.id}">${I.flagFill}</button>
      <div class="main"><div class="title">${esc(v.conf_title || v.abbr || v.name)}${(v.conf_title || v.abbr) ? ` <span class="muted">· ${esc(v.name)}</span>` : ''}</div>
      <div class="meta">${coreBadge(v.core)}${ccfBadge(v.ccf)}${v.type === 'journal' ? '<span class="badge">Journal</span>' : ''}<span>h ${v.h_index}</span><span>prestige ${v.prestige}</span></div></div>
      <div class="side"><b style="color:var(--text)">${v.n_recent}</b>&nbsp;recent · ${v.n_all} all</div></li>`).join('')}</ul>
    <div class="section-head">Papers ${seg('rtab', [['top', 'Most cited'], ['recent', 'Recent']], tab)}</div>
    <ul class="rows">${r.works[tab].map((w) => `<li class="row"><span class="cal-icon">${I.doc}</span><div class="main"><div class="title"><a href="${esc(w.url)}" target="_blank" rel="noopener" style="text-decoration:none">${esc(w.title)}</a></div>
      <div class="meta"><span>${esc(w.year || '')}</span>${w.venue_id ? `<a class="tag" href="#/v/${w.venue_id}">${I.hash}${esc(S.vById.get(w.venue_id) ? vName(S.vById.get(w.venue_id)) : w.venue)}</a>` : w.venue ? `<span>${esc(w.venue)}</span>` : ''}</div></div>
      <div class="side">${fmtN(w.cites)} cites</div></li>`).join('')}</ul>`;
  el.querySelector('.section-head .seg')?.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { app.opts.rtab = b.dataset.v; saveOpts(); researcher(id); } });
  el.querySelector('#track')?.addEventListener('click', async () => { app.cache.delete('r' + id); await addResearcher(id); });
  const note = el.querySelector('#note');
  note?.addEventListener('change', async () => { await api('/api/researchers/' + id, { method: 'PATCH', body: { note: note.value } }); r.note = note.value; toast('Note saved'); });
  bindRows(el);
}

// ================================================================ venue detail
export async function venue(id) {
  const el = document.getElementById('view');
  let v = app.cache.get('v' + id);
  if (!v) { el.innerHTML = '<div class="loading">Loading venue and who publishes there…</div>'; v = await api('/api/venues/' + id); app.cache.set('v' + id, v); }
  if (app.route[1] !== id) return;
  const now = Date.now();
  const ms = milestones(v.editions);
  const n = v.next;
  const accept = v.accept || [];
  el.innerHTML = `<a class="crumb" href="#/venues">${I.back.replace('<svg', '<svg width="12" height="12"')} Venues</a>
    <div class="profile-head"><button class="circle p${v.priority}" data-pri="${v.id}" style="width:24px;height:24px;margin-top:6px" title="Priority (1–4)">${I.flagFill}</button>
      <div><h1>${esc(v.conf_title || v.abbr || v.name)}</h1><div class="sub">${esc(v.conf_name || v.name)}</div>
      <div class="links" style="align-items:center">${coreBadge(v.core)}${ccfBadge(v.ccf)}<span class="badge">${esc(v.type || 'venue')}</span>
        ${v.homepage ? `<a href="${esc(v.homepage)}" target="_blank" rel="noopener">Homepage ↗</a>` : ''}<a href="https://openalex.org/${esc(v.id)}" target="_blank" rel="noopener">OpenAlex ↗</a>
        ${v.conf_key ? `<a href="https://dblp.org/db/conf/${esc(v.conf_key)}/" target="_blank" rel="noopener">dblp ↗</a>` : ''}</div></div></div>
    <textarea class="note-box" id="note" placeholder="Notes (why it matters, who to meet, budget…)" rows="2">${esc(v.note || '')}</textarea>
    <div class="stats"><div class="stat"><div class="v">${v.heat}</div><div class="l">heat</div></div><div class="stat"><div class="v">${v.prestige}</div><div class="l">prestige / 100</div></div>
      <div class="stat"><div class="v">${v.h_index}</div><div class="l">citation h-index</div></div><div class="stat"><div class="v">${(v.mean2yr || 0).toFixed(1)}</div><div class="l">2-yr mean citedness</div></div>
      <div class="stat"><div class="v">${v.people_count}${v.seniors ? ` <small class="muted" style="font-size:12px">(${v.seniors} sr)</small>` : ''}</div><div class="l">tracked people go</div></div></div>
    <div class="callout">Prestige = mean of ${Object.entries(v.prestige_parts).map(([k, x]) => `<b>${{ core: 'CORE', ccf: 'CCF', cite: 'citations' }[k]}</b> ${x}`).join(', ') || 'no signals'}. Heat = sum of h-index of tracked people, weighted by how much they publish here lately.</div>
    <div class="section-head">How to get there</div>
    ${n?.upcoming && n.estimated ? `<div class="deadline-big"><div class="days" style="color:var(--muted)">~${Math.round(n.daysLeft / 30)}<small>months</small></div><div><div><b>${esc(v.conf_title || '')} ${esc(n.year)}: dates not announced yet</b></div><div class="muted" style="font-size:13px">If it follows last year, the ${esc(n.kind.toLowerCase())} deadline is around ${new Date(n.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.</div>${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener" style="font-size:13px">Last edition ↗</a>` : ''}</div></div>`
      : n?.upcoming ? `<div class="deadline-big"><div class="days ${''}" style="color:var(--${dueCls(n.daysLeft) === 'later' ? 'text' : dueCls(n.daysLeft)})">${n.daysLeft}<small>days left</small></div>
      <div><div><b>${esc(n.kind)} deadline · ${esc(v.conf_title || '')} ${esc(n.year)}</b></div><div class="muted" style="font-size:13px">${new Date(n.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} your time${n.place ? ' · ' + esc(n.place) : ''}${n.date ? ' · ' + esc(n.date) : ''}</div>
      ${n.link ? `<a href="${esc(n.link)}" target="_blank" rel="noopener" style="font-size:13px">Call for papers ↗</a>` : ''}</div></div>`
      : n ? `<p class="muted">No upcoming deadline listed yet. Latest edition: ${esc(n.year)}${n.place ? ', ' + esc(n.place) : ''}${n.date ? ' (' + esc(n.date) + ')' : ''}.</p>`
      : '<p class="muted">No deadline data for this venue (deadlines come from ccfddl and cover CS conferences).</p>'}
    ${ms.length ? `<ul class="timeline">${ms.slice(-10).map((m) => `<li class="${m.at < now ? 'past' : ''}"><b>${fmtDate(m.at)}</b><span>${esc(m.year)} ${esc(m.kind)}${m.place ? ' · ' + esc(m.place.split(';')[0]) : ''}</span></li>`).join('')}</ul>` : ''}
    ${accept.length ? `<div class="section-head">Acceptance rate</div><div class="chart">${bars(accept.map((a) => ({ label: String(a.year), v: Math.round(a.rate * 100) })), { h: 80, fmt: (x) => x + '%', color: 'var(--p3)' })}</div>
      <p class="muted" style="font-size:12px;margin:0">${esc(accept[accept.length - 1].accepted)} of ${esc(accept[accept.length - 1].submitted)} accepted in ${esc(accept[accept.length - 1].year)}.</p>` : ''}
    <div class="section-head">Plan <span class="n">${v.tasks.filter((t) => !t.done_at).length}</span></div><ul class="rows" id="plan">${v.tasks.map(taskRow).join('')}</ul><div id="plan-add"></div>
    <div class="section-head">Tracked people who go <span class="n">${v.recent_people.length}</span></div>
    <ul class="rows">${v.recent_people.map((p) => `<li class="row" data-row data-href="#/r/${p.id}"><span class="avatar" style="background:${seniorColor(p.h_index)}">${esc(initials(p.name))}</span>
      <div class="main"><div class="title">${esc(p.name)}</div><div class="meta"><span>h ${p.h_index}</span></div></div><div class="side"><b style="color:var(--text)">${p.n_recent}</b>&nbsp;recent · ${p.n_all} all</div></li>`).join('') || '<li class="muted" style="padding:10px 0">None of your tracked researchers published here in the last 4 years.</li>'}</ul>
    <div class="section-head">Top authors here, last 3 years <span class="right">by h-index · from OpenAlex</span></div>
    ${v.top_authors_error ? `<p class="error">${esc(v.top_authors_error)}</p>` : ''}
    <ul class="rows">${(v.top_authors || []).map((p) => `<li class="row" data-row ${p.tracked ? `data-href="#/r/${p.id}"` : ''}><span class="avatar" style="background:${seniorColor(p.h_index)}">${esc(initials(p.name))}</span>
      <div class="main"><div class="title">${esc(p.name)}</div><div class="meta"><span>${esc(p.institution || '')}</span><span>h ${p.h_index}</span><span>${fmtN(p.cited_by)} cites</span></div></div>
      <div class="side">${p.papers} papers ${p.tracked ? '<span class="badge">tracked</span>' : `<button class="btn small" data-track="${p.id}">Track</button>`}</div></li>`).join('')}</ul>`;
  const note = el.querySelector('#note');
  note.addEventListener('change', async () => { await api('/api/venues/' + id, { method: 'PATCH', body: { note: note.value } }); v.note = note.value; toast('Note saved'); });
  el.querySelectorAll('[data-track]').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation(); b.innerHTML = '<span class="spinner"></span>';
    try { await addResearcher(b.dataset.track); } catch (err) { toast(err.message, { error: true }); b.textContent = 'Track'; }
  }));
  const tag = ` #"${v.conf_title || v.abbr || v.name}"`;
  inlineAdd(el.querySelector('#plan-add'), { label: 'Add task', placeholder: 'e.g. Apply for travel grant dec 15 p2',
    onSubmit: async (text) => { await api('/api/tasks', { method: 'POST', body: { text: text + (/#/.test(text) ? '' : tag) } }); await refresh(); toast('Task added'); } });
  bindRows(el);
}

// ================================================================ graph
export async function graph(el) {
  el.innerHTML = `<div class="graph-title"><h1>Graph</h1><div class="sub muted" style="font-size:13px">Researchers ↔ venues. Size = h-index / heat. Click to open.</div></div>
    <div class="graph-legend"><label><span class="dot" style="background:var(--p1)"></span>Senior (h ≥ ${SENIOR_H})</label><label><span class="dot" style="background:var(--p3)"></span>Researcher</label>
    <label><span class="dot" style="background:#8a63d2"></span>Venue</label><label><span class="dot" style="background:#24a47f"></span>Field</label>
    <label><input type="checkbox" id="g-fields" ${app.opts.gFields ? 'checked' : ''}> Show fields</label><label><input type="checkbox" id="g-minor" ${app.opts.gMinor ? 'checked' : ''}> Minor venues</label><label><input type="checkbox" id="g-recent" ${app.opts.gRecent ?? true ? 'checked' : ''}> Recent links only</label></div>
    <div class="graph-wrap" id="graph"></div>`;
  const { renderGraph } = await import('/graph.js');
  const draw = () => renderGraph(el.querySelector('#graph'), app.S, { fields: !!app.opts.gFields, minor: !!app.opts.gMinor, recent: app.opts.gRecent ?? true, onOpen: (h) => go(h) });
  el.querySelector('#g-fields').onchange = (e) => { app.opts.gFields = e.target.checked; saveOpts(); draw(); };
  el.querySelector('#g-minor').onchange = (e) => { app.opts.gMinor = e.target.checked; saveOpts(); draw(); };
  el.querySelector('#g-recent').onchange = (e) => { app.opts.gRecent = e.target.checked; saveOpts(); draw(); };
  draw();
}

// ================================================================ insights
export function insights(el) {
  const { S } = app;
  const ins = computeInsights(S, S.venues);
  const vs = S.venues.filter((v) => v.people > 0);
  const go2 = ins.hot.filter((h) => h.next?.upcoming).slice(0, 3);
  el.innerHTML = head('Insights', 'Is citation prestige where the senior people actually go?') +
    (S.researchers.length < 3 ? '<div class="callout">Track at least 3–5 researchers for these numbers to mean something. Correlations need 4+ data points.</div>' : '') +
    (go2.length ? `<div class="callout"><b>Where to go next:</b> ${go2.map((h) => `<a href="#/v/${h.id}">${esc(h.name)}</a> (${h.people} tracked people, ${esc(h.next.kind.toLowerCase())} deadline ${h.next.estimated ? '~' : ''}${daysText(h.next.daysLeft)}${h.next.estimated ? ', est.' : ''})`).join(' · ')}</div>` : '') +
    `<div class="cards">${ins.correlations.map((c) => `<div class="card"><div class="rho ${c.rho > 0.2 ? 'pos' : c.rho < -0.2 ? 'neg' : ''}">${c.rho == null ? '–' : (c.rho > 0 ? '+' : '') + c.rho.toFixed(2)}</div>
      <div class="lbl">${esc(c.label)}</div><div class="read">${esc(c.reading)} · n = ${c.n} · Spearman ρ</div></div>`).join('')}</div>
    <div class="section-head">Heat vs citation h-index <span class="right">each dot is a venue, coloured by your priority</span></div>
    <div class="chart">${vs.length ? scatter(vs.map((v) => ({ x: v.h_index, y: v.heat, label: vName(v), cls: 'p' + v.priority, href: '#/v/' + v.id, r: 4 + Math.min(6, v.people) })), { xLabel: 'venue citation h-index', yLabel: 'heat', logX: true }) : '<p class="muted">No data yet.</p>'}</div>
    <div class="section-head">Researcher h-index vs prestige of where they publish</div>
    <div class="chart">${ins.researchers.some((r) => r.venue_prestige != null) ? scatter(ins.researchers.filter((r) => r.venue_prestige != null).map((r) => ({ x: r.h_index, y: r.venue_prestige, label: r.name.split(' ').slice(-1)[0], href: '#/r/' + r.id, cls: r.h_index >= SENIOR_H ? 'p1' : 'p3' })), { xLabel: 'researcher h-index', yLabel: 'avg venue prestige', fit: true, h: 240 }) : '<p class="muted">No data yet.</p>'}</div>
    <div class="section-head">Where the hot people go <span class="n">top ${ins.hot.length}</span></div>
    <ul class="rows">${ins.hot.map((h) => venueRow(S.vById.get(h.id))).join('')}</ul>
    <p class="muted" style="font-size:12px;margin-top:18px">Sources: OpenAlex (papers, citations, h-index), ccfddl (CORE/CCF ranks, deadlines, acceptance rates). Correlations are descriptive and limited to the people you track.</p>`;
  bindRows(el);
}

// ================================================================ settings
export async function settings(el) {
  const origin = location.origin;
  el.innerHTML = head('Settings') + `
    <section class="settings-sec"><h2>Connect Claude Code or Codex (MCP)</h2>
      <p class="muted" style="font-size:13px;margin:0 0 8px">Agents can add researchers from links, read profiles and venues, set priorities and plan tasks. Create a token, then run one of the commands below.</p>
      <div id="tokens"></div>
      <form id="new-token" style="display:flex;gap:8px;margin-top:8px"><input name="name" class="pill" style="padding:6px 8px;flex:1;max-width:260px" placeholder="Token name, e.g. Claude Code on laptop" required maxlength="60"><button class="btn primary">Create token</button></form>
      <div id="token-out"></div>
      <p style="font-size:13px;margin:14px 0 2px"><b>Claude Code</b></p>
      <pre class="code">claude mcp add --transport http confmap ${esc(origin)}/mcp --header "Authorization: Bearer $CONFMAP_TOKEN"</pre>
      <p style="font-size:13px;margin:10px 0 2px"><b>Codex</b> (~/.codex/config.toml, with CONFMAP_TOKEN exported in your shell)</p>
      <pre class="code">[mcp_servers.confmap]
url = "${esc(origin)}/mcp"
bearer_token_env_var = "CONFMAP_TOKEN"</pre>
      <p class="muted" style="font-size:12px">Then just say: "add https://scholar.google.com/citations?user=… to confmap" or "which venues do my senior people go to, and what are the next deadlines?"</p></section>
    <section class="settings-sec"><h2>Sign-in methods</h2><div id="passkeys"></div></section>
    <section class="settings-sec"><h2>Time zone</h2><p class="muted" style="font-size:13px;margin:0">${esc(app.S.me.tz || 'UTC')} (taken from this browser; used for "today" and task dates)</p></section>
    <section class="settings-sec"><h2>Data</h2><p class="muted" style="font-size:13px;margin:0">Papers, citations, fields and keywords come from <a href="https://openalex.org" target="_blank" rel="noopener">OpenAlex</a> (CC0). Conference ranks, deadlines and acceptance rates come from <a href="https://github.com/ccfddl/ccf-deadlines" target="_blank" rel="noopener">ccfddl</a> (MIT). Researcher data refreshes every 30 days.</p></section>
    <section class="settings-sec"><h2>Delete account</h2><p class="muted" style="font-size:13px;margin:0 0 8px">Removes your tracked researchers, priorities, tasks, tokens and sign-in methods.</p><button class="btn danger" id="del">Delete my account</button></section>`;
  const drawTokens = async () => {
    const list = await api('/api/tokens');
    el.querySelector('#tokens').innerHTML = list.length ? `<ul class="rows">${list.map((t) => `<li class="row"><span class="cal-icon">${I.key}</span><div class="main"><div class="title">${esc(t.name)} <span class="muted">…${esc(t.hint)}</span></div>
      <div class="meta"><span>created ${fmtDate(t.created_at)}</span><span>${t.last_used_at ? 'last used ' + fmtDate(t.last_used_at) : 'never used'}</span></div></div>
      <div class="side"><button class="btn small danger" data-revoke="${t.id}">Revoke</button></div></li>`).join('')}</ul>` : '';
    el.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => { await api('/api/tokens/' + b.dataset.revoke, { method: 'DELETE' }); drawTokens(); toast('Token revoked'); });
  };
  drawTokens();
  el.querySelector('#new-token').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { token } = await api('/api/tokens', { method: 'POST', body: { name: e.target.name.value } });
    e.target.reset();
    el.querySelector('#token-out').innerHTML = `<div class="token-new"><b style="font-size:13px">Copy this token now. It won't be shown again.</b>
      <pre class="code" id="tok">${esc(token)}</pre><p style="font-size:13px;margin:6px 0 2px">One-liner for Claude Code:</p>
      <pre class="code">claude mcp add --transport http confmap ${esc(origin)}/mcp --header "Authorization: Bearer ${esc(token)}"</pre>
      <button class="btn small" id="copy">Copy token</button></div>`;
    el.querySelector('#copy').onclick = () => navigator.clipboard.writeText(token).then(() => toast('Copied'));
    drawTokens();
  });
  mountAccountPanel(el.querySelector('#passkeys'), { onError: (m) => toast(m, { error: true }), onMessage: (m) => toast(m) });
  el.querySelector('#del').onclick = async () => {
    if (!confirm('Delete your account and all your confmap data? This cannot be undone.')) return;
    await api('/api/account', { method: 'DELETE' });
    location.assign('/');
  };
}
