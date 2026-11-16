// SPDX-License-Identifier: AGPL-3.0-or-later
// Experiment Library shell (Phase 4).
// Renders the library grid from EXPERIMENTS; drives idle → briefing → running → complete.
import { $, show, setHTML } from './dom.js';
import { EXPERIMENTS } from './config.js';
import { host } from './host.js';

let current = null;
let startedAt = 0;
let state = 'idle'; // idle | briefing | running | complete
let hostHandle = null;

function stopHost() {
  if (hostHandle && typeof hostHandle.stop === 'function') hostHandle.stop();
  hostHandle = null;
}

const hasFile = url => fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);

const fmtDuration = sec => {
  const m = Math.round(sec / 60);
  return m < 1 ? '~' + sec + ' s' : '~' + m + ' min';
};

function renderCards() {
  const grid = $('#libGrid');
  if (!grid) return;
  grid.innerHTML = EXPERIMENTS.map(e => {
    const off = e.enabled ? '' : ' libcard-off';
    const dis = e.enabled ? '' : ' disabled';
    const tag = e.phase === 4 ? 'DEV' : ('PHASE ' + e.phase);
    return (
      '<button class="libcard' + off + '" data-id="' + e.id + '"' + dis + '>' +
        '<b>' + e.title + '</b>' +
        '<i>' + fmtDuration(e.duration) + '</i>' +
        '<small>' + tag + '</small>' +
      '</button>'
    );
  }).join('');
  grid.querySelectorAll('.libcard').forEach(btn => {
    btn.onclick = () => openBriefing(btn.dataset.id);
  });
}

const findExp = id => EXPERIMENTS.find(e => e.id === id) || null;

function setWorksheet(sel, exp) {
  const a = $(sel);
  if (!a) return;
  if (!exp || !exp.worksheet) { a.hidden = true; return; }
  const href = 'worksheets/' + exp.worksheet;
  a.href = href;
  a.hidden = true;
  hasFile(href).then(ok => { a.hidden = !ok; });
}

export function openLibrary() {
  current = null;
  state = 'idle';
  renderCards();
  show('#advLanding', false);
  show('#advLibrary', true);
}

function closeLibrary() {
  show('#advLibrary', false);
  show('#advLanding', true);
}

function openBriefing(id) {
  const e = findExp(id);
  if (!e || !e.enabled) return;
  current = e;
  state = 'briefing';
  $('#ebTitle').textContent = e.title;
  $('#ebMeta').textContent = fmtDuration(e.duration) + ' · ' + (e.phase === 4 ? 'SHELL TEST' : 'PHASE ' + e.phase);
  $('#ebObj').textContent = e.objective || '';
  setHTML('#ebProc', (e.procedure || []).map(s => '<li>' + s + '</li>').join(''));
  $('#ebRecord').textContent = e.record || '';
  $('#ebLimits').textContent = e.limitations || '';
  setWorksheet('#ebWks', e);
  show('#advLibrary', false);
  show('#expBrief', true);
}

function cancelBriefing() {
  show('#expBrief', false);
  current = null;
  state = 'idle';
  show('#advLibrary', true);
}

function beginExperiment() {
  if (!current) return;
  const exp = current;
  state = 'running';
  startedAt = Date.now();
  show('#expBrief', false);
  stopHost();
  hostHandle = host('advanced');
  setTimeout(() => {
    if (current !== exp) return;
    $('#pcTitle').textContent = exp.title;
    setHTML('#pcSteps', (exp.procedure || []).map(s => '<li>' + s + '</li>').join(''));
    show('#procCard', true);
  }, 200);
}

function endExperiment() {
  if (state !== 'running' || !current) return;
  state = 'complete';
  stopHost();
  show('#procCard', false);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  $('#ecTitle').textContent = current.title;
  setHTML('#ecMetrics',
    '<div class="ec-metric"><b>' + fmtDuration(elapsed) + '</b>elapsed</div>' +
    '<div class="ec-metric"><b>' + (current.phase === 4 ? 'SHELL' : 'PHASE ' + current.phase) + '</b>status</div>'
  );
  setWorksheet('#ecWks', current);
  $('#ecCSV').disabled = true; // Q5(a) — no data until Phase 5
  show('#expComplete', true);
}

function rerunExperiment() {
  show('#expComplete', false);
  if (current) {
    state = 'idle';
    beginExperiment();
  } else {
    openLibrary();
  }
}

function backToLibrary() {
  stopHost();
  show('#expComplete', false);
  show('#procCard', false);
  show('#hud', false);
  show('#bar', false);
  current = null;
  state = 'idle';
  openLibrary();
}

export function initExperiments() {
  $('#libBack').onclick = closeLibrary;
  $('#ebCancel').onclick = cancelBriefing;
  $('#ebBegin').onclick = beginExperiment;
  $('#pcEnd').onclick = endExperiment;
  $('#pcToggle').onclick = () => {
    const collapsed = $('#procCard').classList.toggle('pc-collapsed');
    $('#pcToggle').textContent = collapsed ? '▸' : '▾';
  };
  $('#ecRerun').onclick = rerunExperiment;
  $('#ecLib').onclick = backToLibrary;
}
