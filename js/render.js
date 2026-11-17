// SPDX-License-Identifier: AGPL-3.0-or-later
import { $, clamp, fmt, show, setText, setHTML, setAttr } from './dom.js';
import {
  tsat, phaseOf, BETA_EFF, THERMAL_TO_ELECTRIC, STATION_SERVICE_FRACTION,
  gridPowerMWe, formatCps, formatDose, formatPeriod, formatRho, doseFromState,
} from './physics.js';
import { renderRecorder } from './recorder.js';

const cls = (el, c) => { if (el) el.className = 'big ' + c; };
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

export function initReactorSvg() {
  const NS = 'http://www.w3.org/2000/svg', bd = $('#bdots'), nf = $('#nflux'), bm = $('#bmini');
  if (bd) bd.setAttribute('clip-path', 'url(#vc)');
  if (nf) nf.setAttribute('clip-path', 'url(#vc)');
  for (let k = 0; k < 28; k++) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 72 + Math.random() * 96); c.setAttribute('cy', 215 + Math.random() * 195);
    c.setAttribute('r', 2.4); c.setAttribute('fill', '#b36bff'); c.setAttribute('class', 'bd');
    c.style.animationDuration = (2 + Math.random() * 2.5) + 's';
    c.style.animationDelay = (-Math.random() * 3) + 's';
    if (bd) bd.appendChild(c);
    const m = document.createElement('i');
    m.style.left = Math.random() * 92 + '%'; m.style.top = Math.random() * 78 + '%';
    m.style.animationDelay = (-Math.random() * 3) + 's';
    if (bm) bm.appendChild(m);
  }
  if (bm) bm.appendChild(document.createElement('u'));
  for (let k = 0; k < 10; k++) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', 64); c.setAttribute('cy', 225 + Math.random() * 180);
    c.setAttribute('r', 1.8); c.setAttribute('fill', '#fff59a'); c.setAttribute('class', 'nu');
    c.style.animationDelay = (-Math.random() * 1.4) + 's';
    if (nf) nf.appendChild(c);
  }
  $('#kg').innerHTML = '<rect width="40" height="300" fill="#0a0f0b"/><rect width="20" height="300" fill="#35c8ff10"/><rect x="20" width="20" height="300" fill="#ff7a2a10"/><path d="M20 0V300" stroke="#39ff14" stroke-dasharray="4 4" stroke-width=".8"/><polyline id="kl" fill="none" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" points=""/>';
}

export function renderSbxTabs(S) {
  if (S.mode === 'group') return;
  document.querySelectorAll('#sbxTabs button').forEach(btn => {
    btn.classList.toggle('on', S.sbxTab === btn.dataset.sbx);
  });
  document.querySelectorAll('#right .pn').forEach(panel => {
    panel.classList.toggle('sbx-active', panel.dataset.role === S.sbxTab);
  });
}

export function burst() {
  const cv = $('#fx'), x = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  show('#fx', true);
  const q = $('#svgw svg').getBoundingClientRect(), sc = Math.min(q.width / 640, q.height / 500);
  const cx = q.left + (q.width - 640 * sc) / 2 + 120 * sc, cy = q.top + (q.height - 500 * sc) / 2 + 315 * sc;
  const ps = [];
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * 6.283, v = 2 + Math.random() * 15;
    ps.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 4, l: 1, h: 10 + Math.random() * 40 });
  }
  (function f() {
    x.clearRect(0, 0, cv.width, cv.height);
    ps.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += .25; p.vx *= .985; p.l -= .008;
      if (p.l > 0) {
        x.fillStyle = 'hsla(' + p.h + ',100%,' + (50 + p.l * 30) + '%,' + p.l + ')';
        x.beginPath(); x.arc(p.x, p.y, 2 + p.l * 6, 0, 6.3); x.fill();
      }
    });
    if (ps.some(p => p.l > 0)) requestAnimationFrame(f); else show('#fx', false);
  })();
}

export function render(S, D, WH, coachText) {
  try {
    const T = S.T, P = S.P, N = S.N, i = S.in;
    const grossP = N * THERMAL_TO_ELECTRIC, plantUseP = grossP * STATION_SERVICE_FRACTION, netGrid = gridPowerMWe(N);
    const vT = $('#vT'), vP = $('#vP'), vN = $('#vN');
    if (vT && vT.firstChild) vT.firstChild.nodeValue = T.toFixed(0);
    if (vP && vP.firstChild) vP.firstChild.nodeValue = P.toFixed(2);
    if (vN && vN.firstChild) vN.firstChild.nodeValue = netGrid.toFixed(0);
    setHTML('#thermalReadout', 'Heat ' + N.toFixed(0) + ' MWth · Gen ' + grossP.toFixed(0) + ' MWe gross<br>Plant ' + plantUseP.toFixed(1) + ' MWe · Grid <b>' + netGrid.toFixed(0) + ' MWe</b> net');
    cls(vT, (P < 22.064 && T >= tsat(P)) ? 'cr' : T > (D.thermalHigh || 350) ? 'wn' : 'ok');
    cls(vP, (P < (D.pressureCriticalLow || 10) || P > (D.pressureCriticalHigh || 20)) ? 'cr' : (P < (D.pressureLow || 13) || P > (D.pressureHigh || 17.5)) ? 'wn' : 'ok');
    cls(vN, Math.abs(N - 1000) <= D.band ? 'ok' : 'wn');

    setHTML('#rRods', i.rods + '<span style="font-size:.6em;color:var(--dim);margin-left:2px">%</span>');
    setAttr('#bRods', 'style', 'width:' + i.rods + '%');
    setText('#rPump', i.pump + '%'); setAttr('#bPump', 'style', 'width:' + i.pump + '%');
    setText('#rPres', i.heat ? '▲ HEAT' : (i.spray || S.stuck > 0) ? '▼ SPRAY' : '■ HOLD');
    setAttr('#bPres', 'style', 'width:' + ((i.heat ? 50 : 0) + ((i.spray || S.stuck > 0) ? 50 : 0)) + '%');
    setText('#rBor', i.boron + ' ppm'); setAttr('#bBor', 'style', 'width:' + (i.boron / 20) + '%');

    const bf = i.boron / 2000, nb = Math.round(bf * 28), nn = Math.round(clamp(N / 1500, 0, 1) * 10);
    const bdEl = $('#bdots'); if (bdEl) [...bdEl.children].forEach((c, k) => c.style.opacity = k < nb ? .9 : 0);
    const bmEl = $('#bmini'); if (bmEl) {
      [...bmEl.children].forEach((c, k) => { if (c.tagName === 'I') c.style.opacity = k < nb ? 1 : 0; });
      const u = bmEl.querySelector('u'); if (u) u.style.height = bf * 100 + '%';
    }
    setAttr('#blev', 'height', 64 * bf); setAttr('#blev', 'y', 339 - 64 * bf); setAttr('#bpipe', 'opacity', bf > 0 ? .35 + bf * .65 : 0);

    const nfEl = $('#nflux'); if (nfEl) [...nfEl.children].forEach((c, k) => {
      c.style.opacity = k < nn ? 1 : 0;
      c.style.animationDuration = (1.6 - clamp(N / 1500, 0, 1) * .9) + 's';
    });

    const t = clamp((T - 280) / 720, 0, 1);
    setAttr('#water', 'fill', 'rgb(' + lerp(30, 255, t) + ',' + lerp(107, 40, t) + ',' + lerp(255, 20, t) + ')');
    const rodsEl = $('#rods'); if (rodsEl) rodsEl.style.transform = 'translateY(' + (-(100 - i.rods) * 1.2) + 'px)';
    const fuelEl = $('#fuel'); if (fuelEl) fuelEl.style.filter = 'drop-shadow(0 0 ' + (2 + t * 14).toFixed(1) + 'px rgba(255,' + lerp(190, 40, t) + ',40,.9))';
    setAttr('#hot', 'stroke', 'rgb(255,' + lerp(160, 30, t) + ',40)');

    const fs = i.pump ? (2.1 - i.pump / 100 * 1.8).toFixed(2) + 's' : '0s';
    ['hot', 'cold', 'pump'].forEach(k => {
      const e = document.getElementById(k);
      if (e) { e.style.setProperty('--fs', fs); e.style.setProperty('--ts', fs); e.style.animationPlayState = i.pump ? 'running' : 'paused'; }
    });
    const ts = N > 20 ? (4 - N / 1500 * 3.6).toFixed(2) + 's' : '0s';
    ['turb', 'steam', 'feed'].forEach(k => {
      const e = document.getElementById(k);
      if (e) { e.style.setProperty('--ts', ts); e.style.setProperty('--fs', ts); e.style.animationPlayState = N > 20 ? 'running' : 'paused'; }
    });
    setAttr('#gl', 'opacity', clamp(N / 1100, .1, 1)); setAttr('#gl', 'stroke', Math.abs(N - 1000) <= 50 ? '#39ff14' : '#ffd400');
    setAttr('#heat', 'opacity', i.heat ? 1 : 0); setAttr('#spray', 'opacity', (i.spray || S.stuck > 0) ? 1 : 0);
    const pl = clamp((P - 8) / 12, 0, 1); setAttr('#plev', 'y', 110 - pl * 18); setAttr('#plev', 'height', 57 + pl * 18);

    const tvEl = $('#tv');
    if (tvEl) { tvEl.textContent = fmt(Math.max(0, S.rem)); tvEl.style.color = S.rem <= 60 ? '#ff7777' : S.rem <= 180 ? '#ffd400' : '#39ff14'; }
    setAttr('#hold', 'style', 'width:' + (S.mode === 'sandbox' ? 0 : S.hold / WH * 100) + '%');

    // Status banner
    const tsNow = P < 22.064 ? tsat(P) : Infinity, sub = tsNow - T;
    let msg = 'LOOKING GOOD — reactor conditions are within the model’s safe range', level = 0;
    const pCritLow = D.pressureCriticalLow || 10, pCritHigh = D.pressureCriticalHigh || 20, tCritHigh = D.thermalCritical || 350;
    const pLowWarn = D.pressureLow || 13, pHighWarn = D.pressureHigh || 17.5, tWarm = (D.thermalHigh || 350) - 20;
    if (P < pCritLow) { msg = 'PRESSURE TOO LOW — coolant may boil soon. Check the pressurizer.'; level = 2; }
    else if (P >= pCritHigh) { msg = 'PRESSURE VERY HIGH — near pressure limit. Lower it carefully.'; level = 2; }
    else if (T > tCritHigh) { msg = 'COOLANT TOO HOT — near temperature limit. Increase heat removal.'; level = 2; }
    else if (P < pLowWarn) { msg = 'PRESSURE LOW — less room before boiling. Check the pressurizer.'; level = 1; }
    else if (P > pHighWarn) { msg = 'PRESSURE HIGH — above usual range. Use spray to lower it.'; level = 1; }
    else if (sub < (D.subcoolMargin || 10)) { msg = 'COOLANT CLOSE TO BOILING — raise pressure or increase pump speed.'; level = 1; }
    else if (T > tWarm) { msg = 'COOLANT WARM — heat removal may lag. Check pump speed.'; level = 1; }
  else if (!document.body.classList.contains('k-blind')) {
      if (S.k > 1.01) { msg = 'CHAIN REACTION GROWING — more neutrons each generation. Watch power.'; level = 1; }
      else if (S.k < .99 && S.Nf > 10) { msg = 'CHAIN REACTION WEAKENING — too few neutrons to sustain it.'; level = 1; }
    }
    const ssEl = $('#studentStatus');
    if (ssEl) { ssEl.textContent = msg; ssEl.className = 'student-status' + (level === 2 ? ' danger' : level === 1 ? ' warn' : ''); }

    // Phase map strip + live dot
    const ph = phaseOf(T, P), tsatP = tsat(P);
    let ptxt = ph[0];
    if (ph[0].includes('SUPERCRITICAL')) ptxt = 'SUPERCRITICAL';
    else if (ph[0].includes('SUBCOOLED')) ptxt = 'SUBCOOLED';
    else if (ph[0].includes('SATURATION')) ptxt = 'SATURATION';
    else if (ph[0].includes('SUPERHEATED')) ptxt = 'SUPERHEATED';
    else if (ph[0].includes('VAPOR')) ptxt = 'VAPOR';
    const phEl = $('#phase');
    if (phEl) { phEl.textContent = ptxt + (P < 22.064 ? ' · ' + (tsatP - T).toFixed(0) + '°C margin' : ''); phEl.style.color = ph[1]; }
    const d = $('#pmdot'), d2 = $('#pmdot2'), y = 380 - Math.min(P, 30) * 12;
    if (d) { d.setAttribute('cx', 50 + Math.min(T, 500) * .98); d.setAttribute('cy', y); }
    if (d2) { d2.setAttribute('cy', y); }
    setHTML('#pmlive', '<b>LIVE · ' + ph[0] + '</b>Pressure ' + P.toFixed(2) + ' MPa; illustrative saturation temperature is ' + tsatP.toFixed(0) + ' °C. Hot-leg coolant ' + T.toFixed(0) + ' °C.');

    // k_eff gauge
    const k = S.k ?? 1, rho = S.rho ?? 0, promptCritical = k > 1 && rho >= BETA_EFF;
    let label, color;
    if (S.Nf < 1 && k < 1) { label = 'WEAK'; color = '#35c8ff'; }
    else if (Math.abs(k - 1) < .0001) { label = 'STEADY'; color = '#39ff14'; }
    else if (k < 1) { label = 'SHRINKING'; color = '#35c8ff'; }
    else if (promptCritical) { if (k >= 1.01) { label = 'RUNAWAY'; color = '#ff2a2a'; } else { label = 'RAPID'; color = '#ffd400'; } }
    else { label = 'GROWING'; color = '#ffd400'; }
    const kvEl = $('#kv'); if (kvEl) { kvEl.textContent = k.toFixed(4); kvEl.style.color = color; }
    const kstEl = $('#kst'); if (kstEl) { kstEl.textContent = label; kstEl.style.color = color; }
    // Auto-scaled k axis, always centred on k = 1. The window is the smallest "nice" half-width that
    // holds the history, so a deeply subcritical core (e.g. rods in, 1500 ppm) no longer pins to the edge.
    const arr = S.kh || [], arrLen = arr.length, ky = j => arrLen <= 1 ? 150 : 295 - (j / (arrLen - 1)) * 290;
    let dev = 0; arr.forEach(v => { dev = Math.max(dev, Math.abs(v - 1)); });
    const kHalf = [.02, .05, .1, .2, .5, 1].find(h => h >= dev * 1.1) || 1;
    const clip = k < 1 - kHalf ? '▼' : k > 1 + kHalf ? '▲' : '';
    const kclipEl = $('#kclip'); if (kclipEl) { kclipEl.textContent = clip; kclipEl.classList.toggle('hide', !clip); }
    const kx = v => 5 + (clamp(v, 1 - kHalf, 1 + kHalf) - (1 - kHalf)) / (2 * kHalf) * 30;
    setText('#kLo', (1 - kHalf).toFixed(2)); setText('#kHi', (1 + kHalf).toFixed(2));
    const klEl = $('#kl'); if (klEl) klEl.setAttribute('points', arr.map((v, j) => kx(v).toFixed(1) + ',' + ky(j).toFixed(1)).join(' '));

    setText('#lPump', i.pump + '% · hot leg ' + T.toFixed(0) + ' °C');
    setText('#lRods', i.rods < 40 ? 'withdrawn' : i.rods > 70 ? 'inserted' : 'mid-core');
    setText('#lPres', i.heat ? '▲ HEATING' : (i.spray || S.stuck > 0) ? '▼ SPRAY' : '■ HOLD');
    setText('#lBor', i.boron + ' ppm · ' + (bf > 0.5 ? 'high' : bf < 0.15 ? 'low' : 'mid'));
    setAttr('#prv', 'opacity', S.valve ? 1 : 0);

    const holdActive = S.hold > 0;
    const hlEl = $('#hl');
    if (hlEl) {
      hlEl.style.color = holdActive ? '#39ff14' : 'var(--dim)';
      hlEl.textContent = S.mode === 'sandbox' ? 'SANDBOX' : (holdActive ? '● HOLD ' + S.hold + '/' + WH + 's' : 'HOLD ' + S.hold + '/' + WH + 's');
    }

    const coachEl = $('#coach');
    if (coachEl) { coachEl.textContent = coachText; coachEl.classList.toggle('hide', !coachText); }
    if (S.mode !== 'group') renderSbxTabs(S);

    if (S.mode === 'advanced') {
      const cps = 1e9 * S.Nf / 1000;
      const dose = doseFromState(S.Nf, S.adv.n16, S.precursors || [], S.adv.fp);
      const flux = 3e13 * S.Nf / 1000;
      const avgDP = S.adv.dPowerHistory.length
        ? S.adv.dPowerHistory.reduce((a, b) => a + b, 0) / S.adv.dPowerHistory.length
        : 0;
      const nearNoise = S.Nf < 1e-5;
      const stable = nearNoise || Math.abs(avgDP) <= 0.001 * Math.abs(S.Nf || 1);
      const period = stable ? Infinity : S.Nf / avgDP;
      const doubling = stable ? Infinity : Math.LN2 * period;
      const rhoPcm = (S.k - 1) / S.k * 1e5;
const kBlind = document.body.classList.contains('k-blind');
      const setInstr = (sel, txt, c) => {
        const el = document.querySelector(sel);
        if (el) { el.textContent = txt; el.className = 'instr-value ' + c; }
      };
      setInstr('#vCps', nearNoise ? '—' : formatCps(cps), nearNoise ? 'off' : 'ok');
      setInstr('#vDose', formatDose(dose), dose > 16000 ? 'cr' : dose > 1000 ? 'wn' : 'ok');
      const perCls = nearNoise || stable ? 'ok' : Math.abs(period) < 60 ? 'cr' : Math.abs(period) < 300 ? 'wn' : 'ok';
      setInstr('#vPeriod', kBlind ? '—' : (nearNoise ? '—' : formatPeriod(period, stable)), kBlind ? 'off' : perCls);
      setInstr('#vRho', kBlind ? 'BLINDED' : formatRho(rhoPcm), kBlind ? 'off' : (Math.abs(rhoPcm) < 1000 ? 'ok' : Math.abs(rhoPcm) < 3000 ? 'wn' : 'cr'));
      setText('#vDoubling', kBlind ? 'hidden until DONE' : (nearNoise ? '—' : (stable ? 'doubling +∞' : 'doubling ' + doubling.toFixed(0) + 's')));
      setText('#vFlux2', 'n/cm²·s ' + flux.toExponential(2));
      renderRecorder(S);
    }
  } catch (err) {
    console.error('render failed:', err);
  }
}
