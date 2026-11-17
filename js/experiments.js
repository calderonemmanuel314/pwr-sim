// SPDX-License-Identifier: AGPL-3.0-or-later
// Experiment Library + Phase 5 rod-calibration mechanics.
// Renders the library grid from EXPERIMENTS; drives idle → briefing → running → complete.
// For rod-calibration-1m: runs a fast-forward settle loop, logs 5 Poisson samples per
// step, plots 1/cps vs rod %, fits the last 4–5 points, extrapolates to criticality.
import { $, show, setHTML, fmt, ask } from './dom.js';
import { EXPERIMENTS } from './config.js';
import { host, advanceOneSecond, experimentalPreTick, experimentalPostTick } from './host.js';
import { equilibriumPrecursors, neutronBalance } from './physics.js';

let current = null;
let startedAt = 0;
let state = 'idle'; // idle | briefing | running | complete
let hostHandle = null;

// ── Phase 5: per-experiment session state (reset in beginExperiment) ──
let log = [];              // [{ step, rodPct, simT, samples:[s1..s5], avgCps, invM, kEff, capped }]
let detEff = 1;            // detector efficiency offset, rolled once per session (1 ± 0.03)
let cpsFirst = null;       // reference count rate for 1/M = cpsFirst / cps_current
let settling = false;      // re-entry guard
let lastWarned = false;    // whether the last log hit the 1000 s cap
let predictedRodPct = null; // extrapolated critical rod position from DONE fit
let testPoint = null;       // { rod, k } after TEST PREDICTION, drawn on the k_eff plot
let plotShowFit = false;    // last showFit passed to drawPlot (so resize can redraw the same view)
let trippedWhileLogging = false;
let testTripped = false;
let earlyDoneAck = false;

function showWarn(msg) {
  const w = $('#pcWarn');
  if (!w) return;
  if (!msg) { w.textContent = ''; w.classList.add('hide'); return; }
  w.textContent = msg;
  w.classList.remove('hide');
}

function updatePlotNote() {
  const note = $('#gMNote');
  if (!note) return;
  const minInvM = log.length ? Math.min(...log.map(p => p.invM)) : 1;
  note.textContent = log.length
    ? (log.length + ' step' + (log.length > 1 ? 's' : '') + ' · min 1/M: ' + minInvM.toFixed(2))
    : 'goal: track 1/M toward 0';
}

const SETTLE_MAX_TICKS = 1500;
const SETTLE_DELTA_EPS = 0.0005;
const SETTLE_CONSEC    = 5;
const CPS_SCALE        = 1e6;   // cps_true ≈ Nf(MWth) × 1e6; floor applies to subcritical
const CPS_FLOOR        = 20;    // source-level detector background

function stopHost() {
  if (hostHandle && typeof hostHandle.stop === 'function') hostHandle.stop();
  hostHandle = null;
  document.body.classList.remove('exp-run', 'exp-rodcal', 'exp-revealed', 'sbx-sheet-open');
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



// Pick the N distinct rod positions closest to criticality (smallest 1/M)
// so S-curve curvature far from criticality doesn't skew the tangent fit.
function nearCriticalPts(points, count = 3) {
  const byRod = new Map();
  points.forEach(p => byRod.set(p.rodPct, p));
  return Array.from(byRod.values())
    .sort((a, b) => a.invM - b.invM)
    .slice(0, Math.max(2, count));
}

// ── Run settle loop until |ΔNf/Nf| < ε for K consecutive ticks, or 1000 s ──
// Returns { settled, simT, runaway, tripped }.
function runSettleLoop(S, D) {
  const khBefore = (S.kh || []).slice();   // the 1 Hz history must not be flooded by up to 1000 fast-forward ticks
  let prevNf = S.Nf;
  let consecutive = 0;
  let settled = false;
  let runaway = false;
  let tripped = false;
  let simT = 0;
  S._experimentInSettle = true;
  S._experimentTripped = false;
  try {
    for (let t = 0; t < SETTLE_MAX_TICKS; t++) {
      experimentalPreTick(S);
      advanceOneSecond(S, D);
      experimentalPostTick(S);
      simT = t + 1;
      if (S._experimentTripped) { tripped = true; runaway = true; break; }
      const denom = Math.max(Math.abs(prevNf), 1e-12);
      const delta = Math.abs(S.Nf - prevNf) / denom;
      prevNf = S.Nf;
      if (delta < SETTLE_DELTA_EPS) consecutive++;
      else consecutive = 0;
      if (consecutive >= SETTLE_CONSEC) { settled = true; break; }
      if (S.Nf > 1e6) { runaway = true; break; }  // safety: supercritical runaway
    }
  } finally {
    S._experimentInSettle = false;
  }
  S.kh = khBefore.concat(S.k).slice(-90);
  // Release pressurizer after loop
  S.in.heat = 0; S.in.spray = 0;
  // Refresh drift baseline so the host's next normal tick is clean
  S.prev = { N: S.N, T: S.T, P: S.P, Nf: S.Nf };
  return { settled, simT, runaway, tripped };
}

// ── Rod-cal specific fixed setup: rod 100%, pump 50%, boron 1500, xenon 0 ──
function setupRodCal(handle) {
  const S = handle.state;
  const D = handle.diff;

  S.in.rods  = 100;
  S.in.pump  = 50;
  S.in.boron = 1800;
  S.in.heat  = 0;
  S.in.spray = 0;
S.xe = 0;
  S.xi = 0;
  S.Nf = 1e-4;
  S._experimentFreezeXe = true;
  S._experimentMaxPower = 25;
  S._experimentSafeRods = 100;
  S._onExperimentTrip = (_S, tripRod) => {
    if (!S._experimentInSettle) {
      trippedWhileLogging = true;
      const at = tripRod !== undefined ? (' near ' + tripRod + '% rods') : '';
      const stopHint = tripRod !== undefined ? (tripRod + '%') : 'that position';
      showWarn('⚠ AUTO-SCRAM' + at + ': power passed 25 MWth (supercritical)! Rods reset to 100% — stop short of ' + stopHint + ' next time.');
    }
  };
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
  sync('#oBor', 1800, true);
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
    if (log.some(p => p.rodPct === S.in.rods)) {
      showWarn('Already logged at ' + S.in.rods + '% rods. Move the rods to a new position before pressing SETTLE & LOG.');
      return;
    }
    if (S.k >= 1.0) {
      showWarn('⚠ Reactor is supercritical (k_eff ≥ 1) at ' + S.in.rods + '% — push rods back in to stay subcritical before logging 1/M.');
      return;
    }
    const rodAtStart = S.in.rods;
    const result = runSettleLoop(S, D);
    if (result.tripped || result.runaway || S.k >= 1.0) {
      trippedWhileLogging = true;
      showWarn('⚠ Crossed critical near ' + rodAtStart + '% during settle — Auto-SCRAM reset rods to 100%. Stop short of ' + rodAtStart + '% and log subcritical points only.');
      return;
    }

    const cpsTrue = Math.max(CPS_FLOOR, Math.max(0, S.Nf) * CPS_SCALE * detEff);
    const samples = [];
    for (let i = 0; i < 5; i++) samples.push(poissonSample(cpsTrue));
    const avgCps = samples.reduce((a, b) => a + b, 0) / 5;

    log.push({
      step: log.length + 1,
      rodPct: S.in.rods,
      simT: result.simT,
      samples,
      avgCps,
      invM: 1,
      kEff: S.k,
      capped: !result.settled,
    });

    // Anchor CR_0 to the most-inserted (highest rodPct) logged step and clamp 1/M to [0.0, 1.0].
    // detEff cancels in the ratio, so detector calibration does not bias the critical intercept.
    const baseline = log.reduce((best, p) => (p.rodPct > best.rodPct ? p : best), log[0]);
    cpsFirst = baseline.avgCps;
    log.forEach(p => {
      const raw = (cpsFirst > 0 && p.avgCps > 0) ? (cpsFirst / p.avgCps) : 1;
      p.invM = Math.max(0, Math.min(1, raw));
    });
    lastWarned = !result.settled;
    earlyDoneAck = false;
    predictedRodPct = null;
    testPoint = null;

    const predEl = $('#pcPred');
    if (predEl) { predEl.innerHTML = ''; predEl.classList.add('hide'); }

    renderProcCard();
    if (!lastWarned && log.length === 1 && S.in.rods < 95) {
      showWarn('Note: Step 1 was logged at ' + S.in.rods + '% instead of 100%. For standard 1/M (1.00 → 0), start at 100% rods and step down.');
    }
    updatePlotNote();
    drawPlot(false);
  } finally {
    settling = false;
  }
}

// ── DONE: fit the 3 distinct near-critical points, show extrapolated position ──
function finishExperiment() {
  const distinctRods = new Set(log.map(p => p.rodPct)).size;
  if (log.length < 4 || distinctRods < 3) {
    showWarn('Need at least 4 logged steps across 3+ different rod positions before clicking DONE (currently ' + log.length + ' step(s), ' + distinctRods + ' position(s)).');
    return;
  }
  const fit = linearFit(nearCriticalPts(log, 3));
  if (!fit || Math.abs(fit.m) < 1e-15 || fit.m <= 0) {
    showWarn('Your 1/M values have not started trending downward yet. Pull rods further out and log closer steps before clicking DONE.');
    return;
  }
  const minInvM = Math.min(...log.map(p => p.invM));
  if (minInvM > 0.65 && !earlyDoneAck) {
    earlyDoneAck = true;
    showWarn('Stopping early? Your lowest 1/M is ' + minInvM.toFixed(2) + ' (still on the flat part of the S-curve). Log closer steps until 1/M ≤ 0.65 for an accurate line, or click DONE again to fit anyway.');
    return;
  }
  showWarn('');
  predictedRodPct = -fit.b / fit.m;
  const outOfRange = predictedRodPct < 0 || predictedRodPct > 100;

  // Reveal k_eff — the student's manual extrapolation is now checkable.
  blindKeff(false);
  updatePlotNote();

  const predEl = $('#pcPred');
  if (predEl) {
    predEl.innerHTML =
      '<b>Your extrapolation:</b> critical at ' + predictedRodPct.toFixed(1) + '% rod' +
      (outOfRange ? '<br><span style="color:var(--y);font-size:.85em">Outside 0–100%: points were too far from critical on the S-curve.</span>' : '') +
      '<br><span style="color:var(--dim);font-size:.85em">k_eff is now live — press TEST PREDICTION to check.</span>' +
      '<br><button class="btn" id="pcTest" type="button" style="margin-top:6px">TEST PREDICTION</button>';
    predEl.classList.remove('hide');
    const testBtn = $('#pcTest');
    if (testBtn) testBtn.onclick = testPrediction;
  }
  redrawPlots(true);
}

// ── TEST PREDICTION: evaluate k_eff at predicted position safely (Auto-SCRAM if supercritical) ──
function testPrediction() {
  if (!hostHandle || !hostHandle.state || predictedRodPct === null) return;
  const S = hostHandle.state;
  const D = hostHandle.diff;

  const targetRod = Math.round(Math.max(0, Math.min(100, predictedRodPct)));
  S.in.rods = targetRod;
  const oRods = $('#oRods');
  if (oRods) oRods.value = targetRod;

  // Capture k_eff at targetRod before any safety Auto-SCRAM reinserts rods
  const balAtTarget = neutronBalance(S.in, S.xe, S.T, S.P, S.Tfuel, D.alphaDoppler);
  const result = runSettleLoop(S, D);
  const kMeasured = (result.tripped || result.runaway) ? balAtTarget.kEff : S.k;
  testTripped = !!(result.tripped || result.runaway);
  testPoint = { rod: targetRod, k: kMeasured };

  let verdict, why;
  if (testTripped || kMeasured > 1.002) {
    verdict = 'SUPERCRITICAL';
    why = 'Your line overshot past k_eff = 1.000 — points taken further out on the S-curve can under-predict how steeply reactivity climbs near critical.';
  } else if (kMeasured < 0.998) {
    verdict = 'SUBCRITICAL';
    why = 'Your line stopped slightly short of k_eff = 1.000 — S-curve bending earlier in the pull made the line cross 0 too soon.';
  } else {
    verdict = 'CRITICAL';
    why = 'Spot on! Your near-critical points matched the critical rod position (0.998 ≤ k_eff ≤ 1.002).';
  }

  const predEl = $('#pcPred');
  if (predEl) {
    predEl.innerHTML =
      '<b>Predicted:</b> ' + predictedRodPct.toFixed(1) + '%' +
      '<br><b>Rods tested at:</b> ' + targetRod + '%' +
      '<br><b>k_eff at target:</b> ' + kMeasured.toFixed(4) +
      '<br><b>Verdict:</b> <span style="color:' + (verdict === 'CRITICAL' ? 'var(--c)' : verdict === 'SUBCRITICAL' ? 'var(--y)' : 'var(--r)') + '">' + verdict + '</span>' +
      '<br><span style="color:var(--tx);font-size:.85em">' + why + '</span>' +
      (result.tripped ? '<br><span style="color:var(--y);font-size:.85em">Auto-SCRAM reset rods to 100% for lab safety.</span>' : '');
    predEl.classList.remove('hide');
  }
  updatePlotNote();
}
// ── Procedure-card updates ──
// ── Procedure-card updates ──
function renderProcCard() {
  if (lastWarned) {
    showWarn('⚠ This step didn\'t settle in 1500 s. Near critical, power takes longer to stabilize — try 2–3% steps instead of 5%.');
  } else {
    showWarn('');
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

// ── Plot: 1/M vs rod %, with labeled increments, gridlines, fit line, and zero crossing ──
// Keeps generous margins around [0, 100] and above 1.00 so edge points (like 100%, 1.00)
// are never clipped by the axes or canvas frame.
function drawPlot(showFit) {
  plotShowFit = !!showFit;
  const c = $('#pcPlot');
  const g = fitCanvas(c);
  if (!g) return;
  const { ctx, W, H } = g;
  ctx.clearRect(0, 0, W, H);
  ctx.lineWidth = 1; ctx.setLineDash([]);

  if (log.length === 0) {
    ctx.fillStyle = '#6b8f6b';
    ctx.font = '12px monospace';
    ctx.fillText('Press SETTLE & LOG at 100% to record your baseline.', 16, H / 2 + 4);
    return;
  }

  const pad = { l: 42, r: 20, t: 16, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  const fitPoints = nearCriticalPts(log, 3);
  const distinctRods = new Set(log.map(p => p.rodPct)).size;
  const fit = (showFit && log.length >= 4 && distinctRods >= 3) ? linearFit(fitPoints) : null;
  const rCrit = (fit && Math.abs(fit.m) > 1e-15) ? (-fit.b / fit.m) : null;

  // ── X-range: 100% (inserted, left) → 0% (withdrawn, right) ──
  const xLeft = 105;
  const xRight = -5;

  // ── Y-range: strictly bounded 0.0 → 1.0 (0.08 headroom so 1.0 dot is never clipped) ──
  const yMin = 0;
  const yMax = 1.08;

  const sx = r => pad.l + ((xLeft - r) / (xLeft - xRight)) * plotW;
  const sy = v => pad.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // ── Y gridlines and tick labels (0.0, 0.2, 0.4, 0.6, 0.8, 1.0) ──
  ctx.font = '10px monospace';
  for (let y = 0; y <= 1.0001; y += 0.2) {
    const py = sy(y);
    ctx.strokeStyle = y === 0 ? '#2a4a2a' : '#142214';
    ctx.beginPath(); ctx.moveTo(pad.l, py); ctx.lineTo(W - pad.r, py); ctx.stroke();
    ctx.fillStyle = '#6b8f6b';
    ctx.textAlign = 'right';
    ctx.fillText(y.toFixed(1), pad.l - 6, py + 3);
  }

  // Subtle dashed reference at 1/M = 0.50 (suggested fit threshold)
  ctx.strokeStyle = '#39ff1433';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, sy(0.5)); ctx.lineTo(W - pad.r, sy(0.5)); ctx.stroke();
  ctx.setLineDash([]);

  // ── X gridlines and tick labels (100% inserted on left → 0% withdrawn on right) ──
  for (let x = 100; x >= 0; x -= 20) {
    const px = sx(x);
    ctx.strokeStyle = '#142214';
    ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H - pad.b); ctx.stroke();
    ctx.fillStyle = '#6b8f6b';
    ctx.textAlign = 'center';
    ctx.fillText(x + '%', px, H - pad.b + 14);
  }
  
  // Main axes
  ctx.strokeStyle = '#2a4a2a';
  ctx.beginPath();
  ctx.moveTo(pad.l, pad.t);
  ctx.lineTo(pad.l, H - pad.b);
  ctx.lineTo(W - pad.r, H - pad.b);
  ctx.stroke();

  // Axis captions
  ctx.fillStyle = '#6b8f6b';
  ctx.textAlign = 'left';
  ctx.textAlign = 'right';
  ctx.fillText('rod %', W - 6, H - 4);
  ctx.textAlign = 'left';

  // ── Clip drawing with a 6px margin so points on 0% / 100% / 1.00 are never sliced ──
  ctx.save();
  ctx.beginPath();
  ctx.rect(pad.l - 6, pad.t - 6, plotW + 12, plotH + 12);
  ctx.clip();

  // Connect points lightly in rod order
  if (log.length >= 2) {
    const sorted = log.slice().sort((a, b) => a.rodPct - b.rodPct);
    ctx.strokeStyle = '#f2c94c55';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    sorted.forEach((p, idx) => {
      const x = sx(p.rodPct), y = sy(p.invM);
      if (idx) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Fit line
  if (fit && Math.abs(fit.m) > 1e-15) {
    ctx.strokeStyle = '#35c8ff';
    ctx.lineWidth = 1.75;
    ctx.beginPath();
    ctx.moveTo(sx(xLeft), sy(fit.m * xLeft + fit.b));
    ctx.lineTo(sx(xRight), sy(fit.m * xRight + fit.b));
    ctx.stroke();

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

  // Data points (drawn on top of lines)
  log.forEach(p => {
    const x = sx(p.rodPct);
    const y = sy(p.invM);
    ctx.fillStyle = '#f2c94c';
    ctx.strokeStyle = '#050805';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (p.capped) {
      ctx.strokeStyle = '#e8324a';
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  ctx.restore();

  if (fit && rCrit !== null && rCrit >= 0 && rCrit <= 100) {
    ctx.fillStyle = '#e8324a';
    ctx.font = '11px monospace';
    const lx = sx(rCrit);
    const labelW = 46;
    const drawX = (lx + labelW + 4 > W - pad.r) ? lx - labelW - 2 : lx + 4;
    ctx.fillText(rCrit.toFixed(1) + '%', drawX, pad.t + 12);
  }
}

// ── Canvas sizing: match the CSS box, scale for devicePixelRatio ──
function fitCanvas(c) {
  if (!c) return null;
  const r = c.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return null;       // hidden or collapsed
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(r.width), H = Math.round(r.height);
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W, H };
}

function redrawPlots(showFit) {
  drawPlot(showFit === undefined ? plotShowFit : showFit);
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
 $('#ebConcept').textContent = e.concept || '';
  show('#ebConceptWrap', !!e.concept);
  $('#ebGoal').textContent = e.goal || '';
  show('#ebGoalWrap', !!e.goal);
  $('#ebObj').textContent = e.objective || '';
  const hasCrit = Array.isArray(e.criteria) && e.criteria.length > 0;
  setHTML('#ebCriteria', hasCrit ? e.criteria.map(s => '<li>' + s + '</li>').join('') : '');
  show('#ebCriteriaWrap', hasCrit);
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
  testPoint = null;
  plotShowFit = false;
  lastWarned = false;
  settling = false;
  trippedWhileLogging = false;
  testTripped = false;
  earlyDoneAck = false;
  // Clear any stale lock classes from a previous run
  document.querySelectorAll('.pn.pc-locked').forEach(p => p.classList.remove('pc-locked'));

  show('#expBrief', false);
  stopHost();
  hostHandle = host('advanced');

  const isRodCal = exp.id === 'rod-calibration-1m';
  if (hostHandle && hostHandle.state) {
    hostHandle.state._experimentActive = true;
  }
  // Layout hooks (see advanced.css): docked procedure card + graph slot; phones open the rods dock.
  document.body.classList.add('exp-run');
  document.body.classList.toggle('exp-rodcal', isRodCal);
  document.body.classList.remove('exp-revealed');
  document.body.classList.toggle('sbx-sheet-open', isRodCal);
  if (isRodCal && hostHandle && hostHandle.state) hostHandle.state.sbxTab = 'rods';
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
  showWarn('');
  const predEl = $('#pcPred');
  if (predEl) { predEl.innerHTML = ''; predEl.classList.add('hide'); }

  show('#procCard', true);
  if (isRodCal) {
    updatePlotNote();
    requestAnimationFrame(() => redrawPlots(false));   // after layout so the canvas has a size
  }
}

async function endExperiment() {
  if (state !== 'running' || !current) return;
  if (current.id === 'rod-calibration-1m') {
    let confirmMsg = '';
    if (log.length === 0) confirmMsg = 'You have not logged any steps yet. End the experiment anyway?';
    else if (predictedRodPct === null) confirmMsg = 'You have not clicked DONE to predict the critical rod % yet. End the experiment early?';
    else if (!testPoint) confirmMsg = 'You have not pressed TEST PREDICTION yet to verify k_eff. End the experiment anyway?';
    if (confirmMsg && !await ask(confirmMsg)) return;
  }
  state = 'complete';
  if (hostHandle && hostHandle.state) hostHandle.state._experimentActive = false;
  document.body.classList.remove('sbx-sheet-open');
  blindKeff(false);
  stopHost();
  show('#procCard', false);
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  $('#ecTitle').textContent = current.title;

  const vEl = $('#ecVerdict');
  if (vEl) {
    if (current.id === 'rod-calibration-1m') {
      const minInvM = log.length ? Math.min(...log.map(p => p.invM)) : 1;
      let vCls = 'ec-fail', vHead = '', vBody = '';
      if (predictedRodPct === null || !testPoint) {
        vCls = 'ec-fail';
        vHead = 'INCOMPLETE LAB';
        vBody = log.length < 4
          ? 'Only ' + log.length + ' step(s) were logged (need 4+ distinct steps, DONE, and TEST PREDICTION).'
          : predictedRodPct === null
            ? 'You logged ' + log.length + ' steps (lowest 1/M = ' + minInvM.toFixed(2) + '), but ended before clicking DONE to extrapolate critical rod %.'
            : 'You extrapolated ' + predictedRodPct.toFixed(1) + '% rods, but ended before clicking TEST PREDICTION to check k_eff.';
      } else {
        const kErr = Math.abs(testPoint.k - 1);
        if (kErr <= 0.002 && !testTripped && !trippedWhileLogging) {
          vCls = 'ec-pass';
          vHead = 'PASS · EXCELLENT CRITICAL PREDICTION';
          vBody = 'Predicted ' + predictedRodPct.toFixed(1) + '% → tested at ' + testPoint.rod + '% with k_eff = ' + testPoint.k.toFixed(4) + ' (inside 0.998–1.002) and zero Auto-SCRAM trips.';
        } else if (kErr <= 0.010 && !testTripped) {
          vCls = trippedWhileLogging ? 'ec-close' : 'ec-pass';
          vHead = trippedWhileLogging ? 'PASS (WITH SCRAM TRIP) · NEAR CRITICAL' : 'PASS · NEAR CRITICAL';
          vBody = 'Tested k_eff = ' + testPoint.k.toFixed(4) + ' (within ±0.010 of critical).' +
            (trippedWhileLogging ? ' Note: Auto-SCRAM tripped earlier while withdrawing rods—use smaller 2–5% steps near critical.' : ' Taking 1–2 closer steps below 1/M = 0.50 will sharpen the fit even further.');
        } else {
          vCls = 'ec-fail';
          vHead = 'NEEDS IMPROVEMENT';
          vBody = 'Tested k_eff = ' + testPoint.k.toFixed(4) + (testTripped ? ' (tripped Auto-SCRAM at ' + testPoint.rod + '%)' : '') +
            ' was outside ±0.010 of critical. Lowest 1/M logged was ' + minInvM.toFixed(2) +
            (minInvM > 0.50 ? ' — stepping closer until 1/M ≤ 0.50 avoids S-curve bias.' : ' — try smaller 2–3% steps right before critical.');
        }
      }
      vEl.className = 'ec-verdict ' + vCls;
      vEl.innerHTML = '<b>' + vHead + '</b>' + vBody;
    } else {
      vEl.className = 'ec-verdict hide';
      vEl.innerHTML = '';
    }
  }

  let metrics =
    '<div class="ec-metric"><b>' + fmt(elapsed) + '</b>elapsed</div>' +
    '<div class="ec-metric"><b>' + (current.phase === 4 ? 'SHELL' : 'PHASE ' + current.phase) + '</b>status</div>';
  if (log.length > 0) {
    const minInvM = Math.min(...log.map(p => p.invM));
    metrics += '<div class="ec-metric"><b>' + log.length + '</b>steps</div>';
    metrics += '<div class="ec-metric"><b>' + minInvM.toFixed(2) + '</b>min 1/M</div>';
  }
  if (predictedRodPct !== null) metrics += '<div class="ec-metric"><b>' + predictedRodPct.toFixed(1) + '%</b>predicted</div>';
  if (testPoint !== null) metrics += '<div class="ec-metric"><b>' + testPoint.k.toFixed(4) + '</b>tested k_eff</div>';
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
  testPoint = null;
  lastWarned = false;
  trippedWhileLogging = false;
  testTripped = false;
  earlyDoneAck = false;
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
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => { if (state === 'running') redrawPlots(); });
    const gM = $('#gM'); if (gM) ro.observe(gM);
  }
  addEventListener('orientationchange', () => setTimeout(() => { if (state === 'running') redrawPlots(); }, 200));
  const doneBtn = $('#pcDone');
  if (doneBtn) doneBtn.onclick = finishExperiment;
}
