// SPDX-License-Identifier: AGPL-3.0-or-later
// Experiment Library + Phase 5 rod-calibration mechanics.
// Renders the library grid from EXPERIMENTS; drives idle → briefing → running → complete.
// For rod-calibration-1m: runs a fast-forward settle loop, logs 5 Poisson samples per
// step, plots 1/cps vs rod %, fits the last 4–5 points, extrapolates to criticality.
import { $, show, setHTML, fmt } from './dom.js';
import { EXPERIMENTS } from './config.js';
import { host, advanceOneSecond, experimentalPreTick, experimentalPostTick } from './host.js';
import { equilibriumPrecursors, neutronBalance } from './physics.js';

let current = null;
let startedAt = 0;
let state = 'idle'; // idle | briefing | running | complete
let hostHandle = null;

// ── Phase 5: per-experiment session state (reset in beginExperiment) ──
let log = [];              // [{ step, rodPct, simT, samples:[s1..s5], avgCps, invCps, kEff, capped }]
let detEff = 1;            // detector efficiency offset, rolled once per session (1 ± 0.03)
let cpsFirst = null;       // reference count rate for 1/M = cpsFirst / cps_current
let settling = false;      // re-entry guard
let lastWarned = false;    // whether the last log hit the 1000 s cap
let predictedRodPct = null; // extrapolated critical rod position from DONE fit

const SETTLE_MAX_TICKS = 1000;
const SETTLE_DELTA_EPS = 0.005;
const SETTLE_CONSEC    = 5;
const CPS_SCALE        = 1e6;   // cps_true ≈ Nf(MWth) × 1e6; floor applies to subcritical
const CPS_FLOOR        = 100;   // source-level detector background

function stopHost() {
  if (hostHandle && typeof hostHandle.stop === 'function') hostHandle.stop();
  hostHandle = null;
}

function blindKeff(on) {
  document.body.classList.toggle('k-blind', !!on);
}

const hasFile = url => fetch(url, { method: 'HEAD' }).then(r => r.ok).catch(() => false);

const fmtDuration = sec => {
  const m = Math.round(sec / 60);
  return m < 1 ? '~' + sec + ' s' : '~' + m + ' min';
};

const fmtNum = n => (n < 1e6 ? Math.round(n) : n.toExponential(2));

// ── Poisson sampler (Knuth for small λ, normal approx for large λ) ──
function poissonSample(lambda) {
  if (!isFinite(lambda) || lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

// ── Ordinary least squares: y = m·x + b ──
function linearFit(points) {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  points.forEach(p => { sx += p.rodPct; sy += p.invM; sxy += p.rodPct * p.invM; sxx += p.rodPct * p.rodPct; });
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-15) return null;
  const m = (n * sxy - sx * sy) / denom;
  const b = (sy - m * sx) / n;
  return { m, b };
}



// ── Run settle loop until |ΔNf/Nf| < ε for K consecutive ticks, or 1000 s ──
// Returns { settled, simT, runaway }.
function runSettleLoop(S, D) {
  let prevNf = S.Nf;
  let consecutive = 0;
  let settled = false;
  let runaway = false;
  let simT = 0;
  for (let t = 0; t < SETTLE_MAX_TICKS; t++) {
    experimentalPreTick(S);
    advanceOneSecond(S, D);
    experimentalPostTick(S);
    simT = t + 1;
    const denom = Math.max(Math.abs(prevNf), 1e-12);
    const delta = Math.abs(S.Nf - prevNf) / denom;
    prevNf = S.Nf;
    if (delta < SETTLE_DELTA_EPS) consecutive++;
    else consecutive = 0;
    if (consecutive >= SETTLE_CONSEC) { settled = true; break; }
    if (S.Nf > 1e6) { runaway = true; break; }  // safety: supercritical runaway
  }
  // Release pressurizer after loop
  S.in.heat = 0; S.in.spray = 0;
  // Refresh drift baseline so the host's next normal tick is clean
  S.prev = { N: S.N, T: S.T, P: S.P, Nf: S.Nf };
  return { settled, simT, runaway };
}

// ── Rod-cal specific fixed setup: rod 100%, pump 50%, boron 1500, xenon 0 ──
function setupRodCal(handle) {
  const S = handle.state;
  const D = handle.diff;

  S.in.rods  = 100;
  S.in.pump  = 50;
  S.in.boron = 1500;
  S.in.heat  = 0;
  S.in.spray = 0;
  S.xe = 0;
  S.xi = 0;
  S.Nf = 1e-4;
  S.precursors = equilibriumPrecursors(S.Nf);
  S.Tfuel = S.T + (S.Nf + 20) / 16;  // approximate initial; settle loop corrects
  const bal = neutronBalance(S.in, S.xe, S.T, S.P, S.Tfuel, D.alphaDoppler);
  S.k = bal.kEff; S.rho = bal.rho; S.neutronBudget = bal;

  // Roll detEff once per session
  detEff = 1 + (Math.random() - 0.5) * 0.06;

  // Sync sliders + lock controls
  const sync = (sel, val, lock) => {
    const el = $(sel);
    if (!el) return;
    if (val !== undefined) el.value = val;
    if (lock !== undefined) el.disabled = lock;
  };
  sync('#oRods', 100, false);
  sync('#oPump', 50, true);
  sync('#oBor', 1500, true);
  sync('#oHeat', undefined, true);
  sync('#oSpr', undefined, true);
  sync('#oHold', undefined, true);
  ['pump', 'boron'].forEach(k => {
    document.querySelectorAll('.pn-ctl[data-key="' + k + '"] .pm').forEach(btn => btn.disabled = true);
  });
  ['coolant', 'pressure', 'xenon'].forEach(r => {
    const p = document.querySelector('.pn[data-role="' + r + '"]');
    if (p) p.classList.add('pc-locked');
  });
}

// ── Settle and log one step ──
function settleAndLog() {
  if (!hostHandle || !hostHandle.state || settling) return;
  settling = true;
  try {
    const S = hostHandle.state;
    const D = hostHandle.diff;
    const result = runSettleLoop(S, D);

    const cpsTrue = Math.max(CPS_FLOOR, Math.max(0, S.Nf) * CPS_SCALE * detEff);
    const samples = [];
    for (let i = 0; i < 5; i++) samples.push(poissonSample(cpsTrue));
    const avgCps = samples.reduce((a, b) => a + b, 0) / 5;

    // 1/M: reference is the first logged avgCps. detEff cancels in the ratio,
    // so detector calibration does not bias the extrapolated critical position.
    if (log.length === 0) cpsFirst = avgCps;
    const invM = (cpsFirst > 0 && avgCps > 0) ? (cpsFirst / avgCps) : 1;

    log.push({
      step: log.length + 1,
      rodPct: S.in.rods,
      simT: result.simT,
      samples,
      avgCps,
      invM,
      kEff: S.k,
      capped: !result.settled,
    });
    lastWarned = !result.settled;
    predictedRodPct = null;

    const predEl = $('#pcPred');
    if (predEl) { predEl.innerHTML = ''; predEl.classList.add('hide'); }

    renderProcCard();
    drawPlot(false);
  } finally {
    settling = false;
  }
}

// ── DONE: fit last 4–5 points, show extrapolated position ──
function finishExperiment() {
  if (log.length < 4) {
    const w = $('#pcWarn');
    if (w) {
      w.textContent = 'Need at least 4 logged steps to fit. Log more steps.';
      w.classList.remove('hide');
    }
    return;
  }
  const fit = linearFit(log.slice(-5));
  if (!fit || Math.abs(fit.m) < 1e-15) {
    const w = $('#pcWarn');
    if (w) {
      w.textContent = 'Fit failed — data too noisy or too few points. Log more near-critical steps.';
      w.classList.remove('hide');
    }
    return;
  }
  predictedRodPct = -fit.b / fit.m;

  // Reveal k_eff — the student's manual extrapolation is now checkable.
  blindKeff(false);

  const predEl = $('#pcPred');
  if (predEl) {
    predEl.innerHTML =
      '<b>Your extrapolation:</b> critical at ' + predictedRodPct.toFixed(1) + '% rod' +
      '<br><span style="color:var(--dim);font-size:.85em">k_eff readout is now live. Press TEST PREDICTION to verify your answer.</span>' +
      '<br><button class="btn" id="pcTest" type="button" style="margin-top:6px">TEST PREDICTION</button>';
    predEl.classList.remove('hide');
    const testBtn = $('#pcTest');
    if (testBtn) testBtn.onclick = testPrediction;
  }
  drawPlot(true);
}

// ── TEST PREDICTION: move rods to predicted position, settle, report k_eff ──
function testPrediction() {
  if (!hostHandle || !hostHandle.state || predictedRodPct === null) return;
  const S = hostHandle.state;
  const D = hostHandle.diff;

  const targetRod = Math.round(Math.max(0, Math.min(100, predictedRodPct)));
  S.in.rods = targetRod;
  const oRods = $('#oRods');
  if (oRods) oRods.value = targetRod;

  const result = runSettleLoop(S, D);

  let verdict;
  if (result.runaway || S.k > 1.002)      verdict = 'SUPERCRITICAL';
  else if (S.k < 0.998)                    verdict = 'SUBCRITICAL';
  else                                     verdict = 'CRITICAL';

  const predEl = $('#pcPred');
  if (predEl) {
    predEl.innerHTML =
      '<b>Predicted:</b> ' + predictedRodPct.toFixed(1) + '%' +
      '<br><b>Rods moved to:</b> ' + targetRod + '%' +
      '<br><b>k_eff after settle:</b> ' + S.k.toFixed(4) +
      '<br><b>Verdict:</b> <span style="color:' + (verdict === 'CRITICAL' ? 'var(--c)' : verdict === 'SUBCRITICAL' ? 'var(--y)' : 'var(--r)') + '">' + verdict + '</span>';
    predEl.classList.remove('hide');
  }
}

// ── Procedure-card updates ──
// ── Procedure-card updates ──
function renderProcCard() {
  const warnEl = $('#pcWarn');
  if (warnEl) {
    if (lastWarned) {
      warnEl.textContent = '⚠ This step didn\'t settle in 1000 s. Near critical, power takes longer to stabilize — try 2–3% steps instead of 5%.';
      warnEl.classList.remove('hide');
    } else {
      warnEl.classList.add('hide');
    }
  }
  const logEl = $('#pcLog');
  if (!logEl) return;
  if (log.length === 0) { logEl.classList.add('hide'); logEl.innerHTML = ''; return; }
  const rows = log.map(p =>
    '<tr>' +
      '<td style="text-align:left;padding:1px 4px">' + p.step + '</td>' +
      '<td style="text-align:right;padding:1px 4px">' + p.rodPct + '</td>' +
      '<td style="text-align:right;padding:1px 4px">' + fmtNum(p.avgCps) + '</td>' +
      '<td style="text-align:right;padding:1px 4px;color:var(--y)">' + p.invM.toFixed(2) + '</td>' +
      '<td style="text-align:center;padding:1px 4px">' + (p.capped ? '⚠' : '') + '</td>' +
    '</tr>'
  ).join('');
  logEl.innerHTML =
    '<table style="width:100%;font-family:monospace;font-size:.6rem;border-collapse:collapse">' +
      '<thead><tr style="color:#888;border-bottom:1px solid #333">' +
        '<th style="text-align:left;padding:1px 4px">#</th>' +
        '<th style="text-align:right;padding:1px 4px">rod%</th>' +
        '<th style="text-align:right;padding:1px 4px">cps</th>' +
        '<th style="text-align:right;padding:1px 4px">1/M</th>' +
        '<th style="text-align:center;padding:1px 4px"> </th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
  logEl.classList.remove('hide');
}

// ── Plot: 1/cps vs rod %, with fit line and zero crossing ──
// Axes always accommodate: all data points, the fit-line endpoints, and rCrit
// (if the fit produced one in [0,100]). Drawing is clipped to the plot rect
// so nothing spills into labels or off-canvas. A minimum x-span of 20% keeps
// a single point at rod=100 (or any edge) from hugging the border.
function drawPlot(showFit) {
  const c = $('#pcPlot');
  if (!c) return;
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  if (log.length === 0) {
    ctx.fillStyle = '#6b8f6b';
    ctx.font = '10px monospace';
    ctx.fillText('Press SETTLE & LOG to begin.', 20, H / 2);
    return;
  }

  const pad = { l: 40, r: 16, t: 8, b: 20 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // Fit computed first so its endpoints can influence axis ranges
  const fitPoints = log.slice(-5);
  const fit = (showFit && log.length >= 4) ? linearFit(fitPoints) : null;
  const rCrit = (fit && Math.abs(fit.m) > 1e-15) ? (-fit.b / fit.m) : null;

  // ── X-range ──
  const xRods = log.map(p => p.rodPct);
  if (rCrit !== null && rCrit >= 0 && rCrit <= 100) xRods.push(rCrit);
  const rawMinX = Math.min(...xRods);
  const rawMaxX = Math.max(...xRods);
  const spanX = Math.max(rawMaxX - rawMinX, 1);
  const padX = Math.max(5, spanX * 0.15);
  let xMin = Math.max(0, rawMinX - padX);
  let xMax = Math.min(100, rawMaxX + padX);
  // Enforce a minimum visible span of 20%, anchored so data stays in view
  if (xMax - xMin < 20) {
    if (rawMaxX >= 100 - 0.5) { xMin = Math.max(0, 100 - 20); xMax = 100; }
    else if (rawMinX <= 0.5) { xMin = 0; xMax = Math.min(100, 20); }
    else {
      const mid = (rawMinX + rawMaxX) / 2;
      xMin = Math.max(0, mid - 10);
      xMax = Math.min(100, mid + 10);
    }
  }

  // ── Y-range ──
  const yVals = fitPoints.map(p => p.invM);
  if (fit) {
    yVals.push(fit.m * xMin + fit.b);
    yVals.push(fit.m * xMax + fit.b);
  }
  const yMin = 0;
  const rawMaxY = Math.max(...yVals, 1e-15);
  const padY = Math.max(rawMaxY * 0.15, 1e-15);
  const yMax = rawMaxY + padY;

  const sx = r => pad.l + ((r - xMin) / Math.max(1e-9, xMax - xMin)) * plotW;
  const sy = v => pad.t + (1 - (v - yMin) / Math.max(1e-15, yMax - yMin)) * plotH;

  // Axes
  ctx.strokeStyle = '#2a4a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H - pad.b);
  ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = '#6b8f6b';
  ctx.font = '9px monospace';
  ctx.fillText('1/cps', 4, pad.t + 8);
  ctx.fillText('rod %', W - pad.r - 36, H - 4);
  ctx.textAlign = 'center';
  ctx.fillText(xMin.toFixed(0), pad.l, H - pad.b + 10);
  ctx.fillText(xMax.toFixed(0), W - pad.r, H - pad.b + 10);
  ctx.textAlign = 'left';

  // ── Clip drawing to the plot rect ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l, pad.t, plotW, plotH);
  ctx.clip();

  // Data points
  ctx.fillStyle = '#f2c94c';
  log.forEach(p => {
    const x = sx(p.rodPct);
    const y = sy(p.invM);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    if (p.capped) {
      ctx.strokeStyle = '#e8324a';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Fit line
  if (fit && Math.abs(fit.m) > 1e-15) {
    ctx.strokeStyle = '#35c8ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx(xMin), sy(fit.m * xMin + fit.b));
    ctx.lineTo(sx(xMax), sy(fit.m * xMax + fit.b));
    ctx.stroke();

    // rCrit vertical dashed marker
    if (rCrit !== null && rCrit >= 0 && rCrit <= 100) {
      ctx.strokeStyle = '#e8324a';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(rCrit), pad.t);
      ctx.lineTo(sx(rCrit), H - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();

  // rCrit label outside the clip, right-aligned near the edge so it stays visible
  if (fit && rCrit !== null && rCrit >= 0 && rCrit <= 100) {
    ctx.fillStyle = '#e8324a';
    ctx.font = '9px monospace';
    const lx = sx(rCrit);
    const labelW = 36;
    const drawX = (lx + labelW + 4 > W - pad.r) ? lx - labelW - 2 : lx + 2;
    ctx.fillText(rCrit.toFixed(1) + '%', drawX, pad.t + 10);
  }
}
// ── Completion screen table ──
function renderEcTable() {
  const el = $('#ecTable');
  if (!el) return;
  if (log.length === 0) { el.classList.add('hide'); el.innerHTML = ''; return; }
  const rows = log.map(p =>
    '<tr>' +
      '<td>' + p.step + '</td>' +
      '<td>' + p.rodPct + '</td>' +
      '<td>' + p.simT + '</td>' +
      '<td>' + fmtNum(p.samples[0]) + '</td>' +
      '<td>' + fmtNum(p.samples[1]) + '</td>' +
      '<td>' + fmtNum(p.samples[2]) + '</td>' +
      '<td>' + fmtNum(p.samples[3]) + '</td>' +
      '<td>' + fmtNum(p.samples[4]) + '</td>' +
      '<td>' + fmtNum(p.avgCps) + '</td>' +
      '<td>' + p.invM.toFixed(3) + '</td>' +
      '<td>' + p.kEff.toFixed(4) + '</td>' +
      '<td>' + (p.capped ? '⚠' : '') + '</td>' +
    '</tr>'
  ).join('');
  el.innerHTML =
    '<table class="ec-table">' +
      '<thead><tr>' +
        '<th>#</th><th>rod %</th><th>sim_t</th>' +
        '<th>s1</th><th>s2</th><th>s3</th><th>s4</th><th>s5</th>' +
        '<th>avg_cps</th><th>1/M</th><th>k_eff</th><th>⚠</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
  el.classList.remove('hide');
}

// ── CSV: step,rod_pct,sim_t,s1,s2,s3,s4,s5,avg_cps,inv_cps,k_eff ──
function buildCSV() {
  const header = 'step,rod_pct,sim_t,s1,s2,s3,s4,s5,avg_cps,inv_M,k_eff';
  const rows = log.map(p => [
    p.step,
    p.rodPct,
    p.simT,
    p.samples[0],
    p.samples[1],
    p.samples[2],
    p.samples[3],
    p.samples[4],
    p.avgCps.toFixed(2),
    p.invM.toFixed(6),
    p.kEff.toFixed(6),
  ].join(','));
  return [header].concat(rows).join('\n');
}

function downloadCSV() {
  if (log.length === 0) return;
  const blob = new Blob([buildCSV()], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (current ? current.id : 'experiment') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Library card rendering (unchanged from Phase 4) ──
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
  // Reset Phase-5 session state
  log = [];
  detEff = 1;
  cpsFirst = null;
  predictedRodPct = null;
  lastWarned = false;
  settling = false;
  // Clear any stale lock classes from a previous run
  document.querySelectorAll('.pn.pc-locked').forEach(p => p.classList.remove('pc-locked'));

  show('#expBrief', false);
  stopHost();
  hostHandle = host('advanced');

  const isRodCal = exp.id === 'rod-calibration-1m';
  if (hostHandle && hostHandle.state) {
    hostHandle.state._experimentActive = true;
  }
  document.body.classList.remove('sbx-sheet-open');
  cpsFirst = null;
  blindKeff(isRodCal);
  if (isRodCal && hostHandle && hostHandle.state) {
    setupRodCal(hostHandle);
  }

  $('#pcTitle').textContent = exp.title;
  setHTML('#pcSteps', (exp.procedure || []).map(s => '<li>' + s + '</li>').join(''));
  const stepsEl = $('#pcSteps');
  if (stepsEl) stepsEl.classList.toggle('hide', isRodCal);
  const rodCalEl = $('#pcRodCal');
  if (rodCalEl) rodCalEl.classList.toggle('hide', !isRodCal);
  const warnEl = $('#pcWarn');
  if (warnEl) warnEl.classList.add('hide');
  const predEl = $('#pcPred');
  if (predEl) { predEl.innerHTML = ''; predEl.classList.add('hide'); }

  show('#procCard', true);
  if (isRodCal) drawPlot(false);
}

function endExperiment() {
  if (state !== 'running' || !current) return;
  state = 'complete';
  if (hostHandle && hostHandle.state) hostHandle.state._experimentActive = false;
  document.body.classList.remove('sbx-sheet-open');
  blindKeff(false);
  stopHost();
  show('#procCard', false);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  $('#ecTitle').textContent = current.title;

  let metrics =
    '<div class="ec-metric"><b>' + fmt(elapsed) + '</b>elapsed</div>' +
    '<div class="ec-metric"><b>' + (current.phase === 4 ? 'SHELL' : 'PHASE ' + current.phase) + '</b>status</div>';
  if (log.length > 0) metrics += '<div class="ec-metric"><b>' + log.length + '</b>steps</div>';
  if (predictedRodPct !== null) metrics += '<div class="ec-metric"><b>' + predictedRodPct.toFixed(1) + '%</b>predicted</div>';
  setHTML('#ecMetrics', metrics);

  setWorksheet('#ecWks', current);

  const csvBtn = $('#ecCSV');
  if (csvBtn) {
    if (log.length > 0) {
      csvBtn.disabled = false;
      csvBtn.title = 'Download step CSV';
      csvBtn.onclick = downloadCSV;
    } else {
      csvBtn.disabled = true;
      csvBtn.title = 'No steps logged';
      csvBtn.onclick = null;
    }
  }

  renderEcTable();
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
  if (hostHandle && hostHandle.state) hostHandle.state._experimentActive = false;
  document.body.classList.remove('sbx-sheet-open');
  blindKeff(false);
  stopHost();
  log = [];
  predictedRodPct = null;
  lastWarned = false;
  document.querySelectorAll('.pn.pc-locked').forEach(p => p.classList.remove('pc-locked'));
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
  const pcHeadEl = document.querySelector('#procCard .pc-head');
  if (pcHeadEl) pcHeadEl.onclick = () => {
    const collapsed = $('#procCard').classList.toggle('pc-collapsed');
    const t = $('#pcToggle');
    if (t) t.textContent = collapsed ? '▸' : '▾';
  };
  $('#ecRerun').onclick = rerunExperiment;
  $('#ecLib').onclick = backToLibrary;
  const settleBtn = $('#pcSettle');
  if (settleBtn) settleBtn.onclick = settleAndLog;
  const doneBtn = $('#pcDone');
  if (doneBtn) doneBtn.onclick = finishExperiment;
}
