// SPDX-License-Identifier: AGPL-3.0-or-later
import { $, clamp, show, setText, ask, goto } from './dom.js';
import { ROLES, ROLE_KEYS, DEF, DIFF, ES } from './config.js';
import { AU, chime } from './audio.js';
import { qrMake, loadPeer } from './qr.js';
import {
  BETA_GROUPS, H_FUEL_COOLANT, TAU_FUEL, tsat,
  neutronBalance, equilibriumPrecursors, advancePointKinetics,
  coolantHeatRemovalFactor, pmSVG,
} from './physics.js';
import { recordAdvTick, bindRecorderControls } from './recorder.js';
import { initReactorSvg, renderSbxTabs, render, burst } from './render.js';

// Advance one simulated second of reactor physics.
// Mutates S (kinetics + xenon + thermal + pressure). Returns post-tick fission power.
// Does NOT render, play audio, remote-send, decrement timer, or run failure checks.
// Callers (tick(), settle loop in experiments.js) handle UI/failure/time separately.
export function advanceOneSecond(S, D) {
  const i = S.in;
  const TfEq = S.T + (S.Nf + 20) / H_FUEL_COOLANT;
  let TfNext = S.Tfuel + (TfEq - S.Tfuel) / TAU_FUEL;
  if (!isFinite(TfNext)) TfNext = S.T;
  S.Tfuel = clamp(TfNext, 0, 2000);

  const balance = neutronBalance(i, S.xe, S.T, S.P, S.Tfuel, D.alphaDoppler);
  S.k = balance.kEff; S.rho = balance.rho; S.neutronBudget = balance;
  const oldFissionPower = S.Nf;
  const kinetics = advancePointKinetics(S.Nf, S.precursors, S.rho);
  S.Nf = kinetics.power; S.precursors = kinetics.precursors;
  S.dPower = S.Nf - oldFissionPower;
  S.kh = (S.kh || []).concat(S.k).slice(-90);
  const n = S.Nf + 20; S.N = n;

  const f = Math.min(1.2, S.Nf / 1500), xi0 = S.xi, xe0 = S.xe;
  S.xi = Math.max(0, xi0 + .0077 * f - .0167 * xi0);
  S.xe = Math.max(0, xe0 + .0167 * xi0 + .0007 * f - (.002 + .01 * f) * xe0);

  recordAdvTick(S);

  const heatFactor = coolantHeatRemovalFactor(S.T, S.P);
  const rem = 32 * (Math.min(i.pump, S.pcap) / 100) * (S.T - 280) * heatFactor;
  S.T = Math.max(280, S.T + (n - rem) / (D.thermalTau || 150));
  S.P += (D.pressureRate || 1) * (.0025 * (S.T - 305) - .015 + (i.heat ? .05 : 0) - (i.spray || S.stuck > 0 ? .08 : 0));
  if (S.P > 17.2) S.valve = 1; else if (S.P < 16.4) S.valve = 0;
  if (S.valve) { S.P -= .15; if (!S.vlog) { S.vlog = 1; S._valveOpened = true; } } else { S.vlog = 0; S._valveOpened = false; }
  S.P = clamp(S.P, 0, 26); if (S.stuck > 0) S.stuck--;

  return S.Nf;
}

// ── Phase 5 experiment helpers ──
// Called around advanceOneSecond() when S._experimentActive is set, in BOTH
// the host's normal 1 Hz tick and the settle loop in experiments.js.
// Together they keep the plant in a safe, stable band so the rod-calibration
// experiment can complete without tripping end().

export function experimentalPreTick(S) {
  if (!S._experimentActive) return;
  // Auto-coolant: pump tracks fission power to hold hot-leg T ≈ 307 °C
  const feedforward = 2 + S.Nf * 0.117;
  const feedback = (S.T - 307) * 0.5;
  S.in.pump = Math.round(Math.max(2, Math.min(95, feedforward + feedback)));
  // Auto-pressurizer: hold P in [15.3, 15.7]
  if (S.P < 15.3)      { S.in.heat = 1; S.in.spray = 0; }
  else if (S.P > 15.7) { S.in.heat = 0; S.in.spray = 1; }
  else                 { S.in.heat = 0; S.in.spray = 0; }
}

export function experimentalPostTick(S) {
  if (!S._experimentActive) return;
  // Soft clamps — set just below alarm thresholds so no beep/failure fires.
  if (S.T > 335) S.T = 335;
  if (S.P < 15.0) S.P = 15.0;
  if (S.P > 17.0) S.P = 17.0;
  if (!isFinite(S.Nf) || S.Nf > 1e7) S.Nf = 1e7;
}

// ── Bottom bar height ──
// The bar wraps to a different height on phones, so CSS can't hard-code the room it needs.
// Publish the measured height as --bar-h; #hud, the dock and the About button all sit above it.
let barObserver = null;
function watchBarHeight() {
  const bar = document.getElementById('bar');
  if (!bar || barObserver) return;
  const apply = () => {
    const h = Math.ceil(bar.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--bar-h', h + 'px');
  };
  apply();
  if (typeof ResizeObserver !== 'undefined') { barObserver = new ResizeObserver(apply); barObserver.observe(bar); }
  else { barObserver = true; addEventListener('resize', apply); }
}

export function host(mode, diff) {
  let WH = 15;
  let STOPPED = false;
  const D = DIFF[mode === 'group' ? diff : mode] || DIFF.sandbox;
  const S = {
    mode, phase: 'lobby', in: DEF(), T: 307, P: 15.5, N: 0, xe: .3, xi: .3,
    rem: 600, hold: 0, holdGrace: 0, pcap: 100, stuck: 0, conns: {}, ov: false, peer: null,
    override: { rods: false, coolant: false, pressure: false, xenon: false },
    adv: { n16: 0, fp: 0, dPowerHistory: [], recording: false, rows: [], maxRows: 5000 },
  };

  const id = 'gpwr-host-' + (1000 + Math.floor(Math.random() * 9000));
  const base = location.origin + location.pathname;
  const pick = r => { const o = {}; ROLES[r].k.forEach(k => o[k] = S.in[k]); return o; };
  const getLim = () => ({
    rodsMin: D.rodsMin || 0, rodsMax: D.rodsMax || 100,
    pumpMin: D.pumpMin || 0, pumpMax: Math.min(S.pcap, D.pumpMax || 100),
    boronMin: D.boronMin || 0, boronMax: D.boronMax || 2000,
  });
  const bc = m => {
    Object.keys(S.conns).forEach(r => {
      const c = S.conns[r];
      try { if (c && c.open) c.send(m); } catch (e) {}
    });
  };
  const sendTo = (r, m) => { const c = S.conns[r]; if (c && c.open) { try { c.send(m); } catch (e) {} } };
  const nconn = () => Object.keys(S.conns).length;

  const evt = m => {
    const d = document.createElement('div'); d.textContent = m; d.className = 'r';
    $('#log').prepend(d); setTimeout(() => d.remove(), 20000);
    AU.tone(500, .4, 'square', .15, 0, 250);
    while ($('#log').children.length > 3) $('#log').lastChild.remove();
  };

  const note = (r, k, o, n) => {
    const L = { rods: ['DIV 1', 'Rods', '%'], pump: ['DIV 2', 'Pump', '%'], boron: ['DIV 4', 'Boron', ' ppm'] };
    let m;
    if (k === 'heat' || k === 'spray') m = 'DIV 3 ▸ ' + (k === 'heat' ? (n ? '▲ Heaters ON' : 'Heaters off') : (n ? '▼ Spray ON' : 'Spray off'));
    else { const l = L[k]; m = l[0] + ' ▸ ' + l[1] + ' ' + o + '→' + n + l[2] + (k === 'boron' ? (n > o ? ' (poison)' : ' (dilute)') : k === 'rods' ? (n > o ? ' (in)' : ' (out)') : ''); }
    const d = document.createElement('div'); d.textContent = m; if (r === 'xenon') d.className = 'x';
    $('#log').prepend(d); setTimeout(() => d.remove(), 9000);
    while ($('#log').children.length > 3) $('#log').lastChild.remove();
  };

  const coach = () => {
    const i = S.in, N = S.N, T = S.T, P = S.P;
    if (P < (D.pressureLow || 13) + 0.5) return 'Div 3: pressure low — use ▲ HEAT.';
    if (P > (D.pressureHigh || 17.5) - 0.5) return 'Div 3: pressure high — use ▼ SPRAY.';
    if (P < 22.064 && T >= tsat(P) - (D.subcoolMargin || 10)) return 'Margin low — coordinate cooling and pressure.';
    if (T > (D.thermalHigh || 350) - 20 && i.pump < 70) return 'Coolant warm — Div 2: review pump.';
    if (Math.abs(N - 1000) <= D.band) return 'On target — hold controls steady.';
    if (N < 1000) return 'Below target — Div 1: withdraw rods; Div 4: dilute boron.';
    return 'Above target — Div 1: insert rods; Div 4: add boron.';
  };

  const apply = (r, v) => {
    if (!v || typeof v !== 'object') return;
    ROLES[r].k.forEach(k => {
      if (typeof v[k] === 'number' && isFinite(v[k])) {
        const mx = k === 'boron' ? (D.boronMax || 2000) : (k === 'heat' || k === 'spray') ? 1 : k === 'pump' ? Math.min(S.pcap, D.pumpMax || 100) : (D.rodsMax || 100);
        const mn = k === 'boron' ? (D.boronMin || 0) : k === 'pump' ? (D.pumpMin || 0) : k === 'rods' ? (D.rodsMin || 0) : 0;
        const o = S.in[k]; S.in[k] = clamp(Math.round(v[k]), mn, mx);
        if (o !== S.in[k]) note(r, k, o, S.in[k]);
      }
    });
  };

  const updatePanelStatus = r => {
    try {
      const panel = document.querySelector('.pn[data-role="' + r + '"]');
      if (!panel) return;
      const st = document.getElementById('os-' + r), btn = document.getElementById('ob-' + r);
      if (!st || !btn) return;
      if (S.mode !== 'group') {
        st.textContent = ''; btn.textContent = '';
        panel.classList.remove('overridden', 'offline');
        panel.querySelectorAll('input[type=range], button.tb, button.pm').forEach(el => { el.disabled = false; });
        return;
      }
      const connected = !!S.conns[r], overridden = !!S.override[r];
      panel.classList.toggle('overridden', overridden);
      panel.classList.toggle('offline', !connected && !overridden);
      panel.querySelectorAll('input[type=range], button.tb, button.pm').forEach(el => { el.disabled = !overridden; });
      if (overridden) { st.textContent = '⚠ HOST OVERRIDE'; btn.textContent = 'RELEASE'; }
      else if (!connected) { st.textContent = '○ OFFLINE'; btn.textContent = 'OVERRIDE'; }
      else { st.textContent = '● LINK OK'; btn.textContent = 'OVERRIDE'; }
    } catch (err) { console.error('updatePanelStatus failed:', err); }
  };

  const lobby = () => {
    try {
      $('#slots').innerHTML = Object.keys(ROLES).map(r => '<div class="slot' + (S.conns[r] ? ' on' : '') + '"><b>' + ROLES[r].n + '</b><span class="st">' + (S.conns[r] ? 'CONNECTED' : 'WAITING') + '</span></div>').join('');
      $('#bStart').disabled = !(nconn() === 4 || S.ov);
      ROLE_KEYS.forEach(updatePanelStatus);
    } catch (err) { console.error('lobby failed:', err); }
  };

  const sync = () => {
    const i = S.in;
    const oR = document.getElementById('oRods'), oP = document.getElementById('oPump'), oB = document.getElementById('oBor');
    if (oR) oR.value = i.rods; if (oP) oP.value = i.pump; if (oB) oB.value = i.boron;
    const oH = document.getElementById('oHeat'), oS = document.getElementById('oSpr'), oHold = document.getElementById('oHold');
    if (oH) oH.classList.toggle('on', !!i.heat);
    if (oS) oS.classList.toggle('on', !!i.spray);
    if (oHold) oHold.classList.toggle('on', !i.heat && !i.spray);
    render(S, D, WH, D.hints && S.phase === 'run' ? coach() : '');
  };

  const startPeer2 = () => {
    try { S.peer = new window.Peer(id); } catch (e) { $('#lmsg').textContent = 'PeerJS failed.'; return; }
    S.peer.on('open', () => { $('#lmsg').textContent = 'Waiting for phones. Scan, type code, pick a division.'; });
    S.peer.on('error', e => { if (e.type === 'unavailable-id') location.reload(); else $('#lmsg').textContent = 'Signalling error (' + e.type + ').'; });
    S.peer.on('connection', c => {
      c.on('data', d => {
        try {
          if (!d || typeof d !== 'object' || !ROLES[d.role]) return;
          const r = d.role;
          if (d.t === 'hello') {
            const existing = S.conns[r], sameSession = existing && existing._session === d.sessionId;
            if (existing && existing !== c && !sameSession) {
              try { c.send({ t: 'st', ph: 'rejected' }); } catch (e) {}
              setTimeout(() => { try { c.close(); } catch (e) {} }, 500);
              return;
            }
            if (existing && existing !== c) try { existing.close(); } catch (e) {}
            S.conns[r] = c; c._r = r; c._session = d.sessionId || ('x' + Math.random().toString(36).slice(2, 10));
            try {
              c.send({ t: 'ack', v: pick(r), cd: D.cd, br: D.short, hint: D.ph ? D.ph[r] : '' });
              c.send({ t: 'cap', pcap: S.pcap, lim: getLim() });
              c.send({ t: 'st', ph: S.override[r] ? 'overridden' : S.phase });
            } catch (err) { console.error('hello send failed:', err); }
            updatePanelStatus(r); lobby();
          } else if (d.t === 'cmd' && c._r === r && S.conns[r] === c && S.phase === 'run' && !S.override[r]) {
            apply(r, d.v);
            try { c.send({ t: 'ack', v: pick(r), cd: D.cd, br: D.short, hint: D.ph ? D.ph[r] : '' }); } catch (e) {}
            AU.tone(520, .12, 'triangle', .1, 0, 780); sync();
          } else if (d.t === 'reclaim' && c._r === r && S.conns[r] === c && S.override[r]) {
            S.override[r] = false; updatePanelStatus(r);
            try {
              c.send({ t: 'ack', v: pick(r), cd: D.cd, br: D.short, hint: D.ph ? D.ph[r] : '' });
              c.send({ t: 'st', ph: S.phase });
            } catch (e) {}
            AU.tone(880, .15, 'triangle', .15, 0, 660);
          }
        } catch (err) { console.error('data handler failed:', err); }
      });
      c.on('close', () => { if (S.conns[c._r] === c) { const r = c._r; delete S.conns[r]; updatePanelStatus(r); lobby(); } });
      c.on('error', () => {});
    });
  };
  const startPeer = () => {
    $('#lmsg').textContent = 'Loading PeerJS…';
    loadPeer().then(startPeer2).catch(() => { $('#lmsg').textContent = 'PeerJS could not load. Use Shift + O override.'; });
  };

  function end(k) {
    const e = ES[k], b = document.body;
    S.phase = e.res; bc({ t: 'st', ph: e.res, m: e.m }); AU.klaxon(false); b.classList.remove('alarm');
    const fin = () => {
      if (S.phase === 'lobby') return;
      $('#ovr').className = e.cls; $('#ot').style.color = '';
      $('#ot').textContent = e.t; $('#om').textContent = e.x; show('#ovr', true);
    };
    if (e.res === 'win') { chime(); return fin(); }
    if (!e.m) {
      if (k === 'xenonLockout') { b.classList.add('cold'); AU.tone(400, 2.5, 'sine', .25, 0, 50); }
      else[0, .5, 1, 1.5].forEach(t => AU.tone(300, .4, 'square', .12, t, 150));
      return setTimeout(fin, 1600);
    }
    b.classList.add('melt'); AU.klaxon(true); AU.noise(3.4, .5, 260); AU.tone(55, 3.4, 'sawtooth', .18, 0, 140);
    setTimeout(() => { AU.klaxon(false); b.classList.add('boom'); AU.noise(2.6, 1, 1400); AU.tone(110, 2, 'sawtooth', .4, 0, 25); burst(); }, 3400);
    setTimeout(fin, 5600);
  }

  function tick() {
    if (S.phase !== 'run') return;
    try {
      const i = S.in, prev = S.prev || { N: S.N, T: S.T, P: S.P, Nf: S.Nf };
      experimentalPreTick(S);
      advanceOneSecond(S, D);
      experimentalPostTick(S);
      if (S._valveOpened) { S._valveOpened = false; evt('MODEL RELIEF VALVE · pressure above 17.2 MPa'); }

      if (S.mode === 'group') {
        S.rem--;
        const el = D.rem - S.rem;
        if (D.k === 'hard') {
          if (el >= 180 && !S.e1) {
            S.e1 = 1; S.pcap = 55; S.in.pump = Math.min(S.in.pump, 55);
            const oP = document.getElementById('oPump'); if (oP) oP.max = 55;
            bc({ t: 'cap', pcap: 55, lim: getLim() });
            evt('EVENT · Pump max 55%'); sync();
          }
          if (el >= 300 && !S.e2) { S.e2 = 1; S.stuck = 20; evt('EVENT · Spray stuck OPEN 20s'); }
        }
      }

      const shutdownSetup = i.rods >= 98 && i.boron >= 1000;
      if (S.mode === 'group' && D.k === 'hard' && !shutdownSetup) S.lockoutArmed = true;
      const lockoutReady = S.lockoutArmed && shutdownSetup && S.xe >= (D.xeLockout || 1.05) && S.N < 150;
      S.lockoutHold = lockoutReady ? S.lockoutHold + 1 : 0;
      S.bh = (S.bh || []).concat(i.boron).slice(-30);

      const sig = JSON.stringify(i), chg = sig !== S.sig; S.sig = sig;
      const satMargin = S.P < 22.064 ? tsat(S.P) - S.T : -Infinity;
      const thermalOK = S.T <= (D.thermalHigh || 350) && S.T >= 280 && S.P >= (D.pressureLow || 13) && S.P <= (D.pressureHigh || 17.5) && satMargin >= (D.subcoolMargin || 10);
      const driftOK = Math.abs(S.N - prev.N) <= (D.powerDrift || 25) && Math.abs(S.T - prev.T) <= (D.tempDrift || 1.5) && Math.abs(S.P - prev.P) <= (D.pressureDrift || .05);
      const powerOK = Math.abs(S.N - 1000) <= D.band;

      if (S.mode === 'group') {
        if (chg) { S.hold = 0; S.holdGrace = 0; }
        else if (powerOK && thermalOK && driftOK) { S.hold++; S.holdGrace = 0; }
        else { S.holdGrace = (S.holdGrace || 0) + 1; if (S.holdGrace > 3) { S.hold = 0; S.holdGrace = 0; } }
      }

      render(S, D, WH, D.hints && S.phase === 'run' ? coach() : '');
      bc({ t: 'st', ph: 'run' });

      const pCritLow = D.pressureCriticalLow || 10, pCritHigh = D.pressureCriticalHigh || 20, tCritHigh = D.thermalCritical || 350;
      const lv = (S.T > tCritHigh || S.P < pCritLow || S.P > pCritHigh || (S.P < 22.064 && S.T > tsat(S.P) + 15)) ? 2
        : (S.T > (D.thermalHigh || 350) - 20 || S.P < (D.pressureLow || 13) || S.P > (D.pressureHigh || 17.5) || S.valve || satMargin < (D.subcoolMargin || 10)) ? 1 : 0;
      document.body.classList.toggle('alarm', lv === 2); AU.klaxon(lv === 2);
      if (lv === 1) AU.tone(880, .12, 'square', .07);
      if (S.rem <= 10 && S.rem > 0) AU.tone(1300, .06, 'square', .07);

      if (S.P >= (D.failOver || 24)) return end('over');
      if (S.T > 800 && S.P < (D.failDepr || 10)) return end('boil');
      if (S.mode === 'group' && D.k === 'hard' && S.lockoutHold >= 10) return end('xenonLockout');
      if (S.T > 1200) {
        const dil = Math.max.apply(null, S.bh) - i.boron >= 400;
        return end(i.rods <= 15 && (dil || i.boron < 300) ? 'spike' : 'heat');
      }
      if (S.P < (D.failDepr || 10)) return end('depr');
      if (S.mode === 'group' && S.hold >= WH) return end('win');

      S.prev = { N: S.N, T: S.T, P: S.P, Nf: S.Nf };
      if (S.mode === 'group' && S.rem <= 0) end('time');
    } catch (err) { console.error('tick failed:', err); }
  }

  const begin = () => {
    const st = D.st;
    try {
      Object.assign(S, {
        sig: '', phase: S.mode === 'group' ? 'brief' : 'run', T: st.T, P: st.P, xe: st.xe, xi: st.xi,
        rem: D.rem, hold: 0, holdGrace: 0, N: 0, pcap: 100, stuck: 0, e1: 0, e2: 0,
        lockoutArmed: false, lockoutHold: 0, bh: [], kh: [], valve: 0, vlog: 0, sbxTab: 'rods',
        override: { rods: false, coolant: false, pressure: false, xenon: false },
        adv: { n16: 0, fp: 0, dPowerHistory: [], recording: false, rows: [], maxRows: 5000 },
      });
      WH = D.hold;
      S.in = { rods: st.rods, pump: st.pump, heat: 0, spray: 0, boron: st.boron };
      S.Nf = Math.max(0, D.initialFissionPower ?? 0);
      if (S.mode === 'advanced') { S.adv.n16 = S.Nf / 1000; S.adv.fp = S.Nf / 1000; }
      S.Tfuel = S.T + (S.Nf + 20) / H_FUEL_COOLANT;
      S.precursors = D.k === 'hard' ? BETA_GROUPS.map(() => 0) : equilibriumPrecursors(S.Nf);
      const balance = neutronBalance(S.in, S.xe, S.T, S.P, S.Tfuel, D.alphaDoppler);
      S.k = balance.kEff; S.rho = balance.rho; S.neutronBudget = balance; S.kh = [S.k];
      S.N = S.Nf + 20; S.dPower = 0; S.prev = { N: S.N, T: S.T, P: S.P, Nf: S.Nf };

      const oR = document.getElementById('oRods'); if (oR) { oR.min = D.rodsMin || 0; oR.max = D.rodsMax || 100; }
      const oP = document.getElementById('oPump'); if (oP) { oP.min = D.pumpMin || 0; oP.max = Math.min(S.pcap, D.pumpMax || 100); }
      const oB = document.getElementById('oBor'); if (oB) { oB.min = D.boronMin || 0; oB.max = D.boronMax || 2000; }

      bc({ t: 'cap', pcap: S.pcap, lim: getLim() });
      Object.keys(ROLES).forEach(r => {
        const c = S.conns[r];
        if (c && c.open) { try { c.send({ t: 'ack', v: pick(r), cd: D.cd, br: D.short, hint: D.ph ? D.ph[r] : '' }); } catch (e) {} }
      });
      ROLE_KEYS.forEach(updatePanelStatus);
      AU.init(); document.body.classList.remove('melt', 'boom', 'alarm', 'cold');
      document.body.classList.toggle('hard', D.k === 'hard');
      const ovrEl = $('#ovr'); if (ovrEl) ovrEl.className = 'hide';
      show('#fx', false); show('#lobby', false); show('#ovr', false); show('#hud', true);
      const logEl = $('#log'); if (logEl) logEl.innerHTML = '';
      sync();
    } catch (outerErr) { console.error('begin() setup failed:', outerErr); }

    if (S.mode !== 'group') {
      const tabsEl = document.getElementById('sbxTabs');
      if (tabsEl) tabsEl.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
          const wasActive = S.sbxTab === btn.dataset.sbx;
          const wasOpen = document.body.classList.contains('sbx-sheet-open');
          S.sbxTab = btn.dataset.sbx;
          renderSbxTabs(S);
          document.body.classList.toggle('sbx-sheet-open', !(wasActive && wasOpen));
        };
      });
    }

    if (S.mode === 'group') {
      setText('#bt', D.n + ' · ' + D.t); setText('#bs', D.story); setText('#bg', D.goal);
      show('#brf', true);
      bc({ t: 'st', ph: 'brief' });
    } else {
      bc({ t: 'st', ph: 'run' });
    }
  };

  // Setup static UI for host
  $('#hid').textContent = id.slice(-4);
  $('#jurl').textContent = base + '?role=join';
  const q = qrMake(base + '?role=join');
  $('#qr').innerHTML = q || '<div style="color:#000;padding:2vh">QR too long.</div>';
  $('#pmsvg').innerHTML = pmSVG('pm', 1);
  initReactorSvg();

  const pmt = o => show('#pm', o === undefined ? $('#pm').classList.contains('hide') : o);
  $('#bpm').onclick = () => pmt();
  const bpmFloatEl = $('#bpmMobile');
  if (bpmFloatEl) bpmFloatEl.onclick = () => pmt();
  $('#pmx').onclick = () => pmt(false);
  $('#phase').onclick = () => pmt(true);
  const onKeyDown = e => {
    if (e.key === 'Escape') pmt(false);
    else if (!e.shiftKey && !e.ctrlKey && (e.key === 'p' || e.key === 'P') && S.phase === 'run') pmt();
    else if (e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault(); S.ov = !S.ov; document.body.classList.toggle('ov', S.ov);
      if (S.phase === 'lobby') lobby();
    }
  };
  addEventListener('keydown', onKeyDown);

  const oRodsEl = $('#oRods'); if (oRodsEl) oRodsEl.oninput = e => { S.in.rods = +e.target.value; sync(); if (S.override.rods) sendTo('rods', { t: 'ack', v: pick('rods'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.rods : '' }); };
  const oPumpEl = $('#oPump'); if (oPumpEl) oPumpEl.oninput = e => { S.in.pump = +e.target.value; sync(); if (S.override.coolant) sendTo('coolant', { t: 'ack', v: pick('coolant'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.coolant : '' }); };
  const oBorEl = $('#oBor'); if (oBorEl) oBorEl.oninput = e => { S.in.boron = +e.target.value; sync(); if (S.override.xenon) sendTo('xenon', { t: 'ack', v: pick('xenon'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.xenon : '' }); };
  const oHeatEl = $('#oHeat'); if (oHeatEl) oHeatEl.onclick = () => { S.in.heat = 1; S.in.spray = 0; sync(); if (S.override.pressure) sendTo('pressure', { t: 'ack', v: pick('pressure'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.pressure : '' }); };
  const oSprEl = $('#oSpr'); if (oSprEl) oSprEl.onclick = () => { S.in.spray = 1; S.in.heat = 0; sync(); if (S.override.pressure) sendTo('pressure', { t: 'ack', v: pick('pressure'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.pressure : '' }); };
  const oHoldEl = $('#oHold'); if (oHoldEl) oHoldEl.onclick = () => { S.in.heat = 0; S.in.spray = 0; sync(); if (S.override.pressure) sendTo('pressure', { t: 'ack', v: pick('pressure'), cd: D.cd, br: D.short, hint: D.ph ? D.ph.pressure : '' }); };

  document.querySelectorAll('.pn-ctl[data-key]').forEach(ctl => {
    const input = ctl.querySelector('input[type=range]');
    if (!input) return;
    ctl.querySelectorAll('.pm').forEach(btn => {
      btn.onclick = () => {
        if (input.disabled) return;
        const dir = +btn.dataset.d, step = +btn.dataset.step || 5;
        input.value = clamp(+input.value + dir * step, +input.min, +input.max);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
    });
  });

  document.querySelectorAll('.ovr-btn').forEach(btn => {
    btn.onclick = () => {
      const r = btn.dataset.r;
      if (S.override[r]) {
        S.override[r] = false; updatePanelStatus(r); sendTo(r, { t: 'st', ph: S.phase }); AU.tone(440, .15, 'triangle', .15, 0, 880);
      } else {
        S.override[r] = true; updatePanelStatus(r); sendTo(r, { t: 'st', ph: 'overridden' }); AU.tone(660, .18, 'triangle', .18, 0, 330);
      }
    };
  });

  bindRecorderControls(S);
  $('#bgo').onclick = () => { show('#brf', false); S.phase = 'run'; AU.init(); bc({ t: 'st', ph: 'run' }); };
  $('#bStart').onclick = begin;

  const goHome = async () => {
    if (S.mode === 'group' && (nconn() || S.phase === 'run') && !await ask('Leave and disconnect all phones?')) return;
    goto(location.pathname);
  };
  $('#bhome').onclick = goHome;
  $('#bback').onclick = async () => {
    if (S.mode === 'sandbox') return goHome();
    if (S.mode === 'advanced') {
      if (!await ask('Leave Advanced Mode?')) return;
      AU.klaxon(false); document.body.classList.remove('melt', 'boom', 'alarm', 'cold');
      goto(location.pathname + '?mode=advanced');
      return;
    }
    if (S.phase === 'lobby') {
      if (nconn() && !await ask('Back to scenario select?')) return;
      return goto(location.pathname + '?mode=group');
    }
    if (S.phase === 'run' && !await ask('Stop this run?')) return;
    AU.klaxon(false); document.body.classList.remove('melt', 'boom', 'alarm', 'cold');
    ['#fx', '#pm', '#ovr', '#hud', '#brf'].forEach(x => show(x, false));
    S.phase = 'lobby'; bc({ t: 'st', ph: 'lobby' }); show('#lobby', true); lobby();
  };

  show('#bar', true);
  watchBarHeight();
  $('#snd').onclick = () => { AU.init(); AU.on = !AU.on; if (!AU.on) AU.klaxon(false); $('#snd').textContent = AU.on ? 'SOUND ON' : 'SOUND OFF'; };
  $('#bAgain').onclick = begin;

  let lastTickWall = Date.now();
  const intervalId = setInterval(() => {
    if (STOPPED) return;
    const now = Date.now();
    const missed = clamp(Math.floor((now - lastTickWall) / 1000), 1, 10);
    for (let k = 0; k < missed; k++) tick();
    lastTickWall = now;
  }, 1000);

  show('#menu', false);
  if (mode === 'group') {
    show('#lobby', true); startPeer(); lobby();
  } else {
    document.body.classList.add('sbx');
    if (mode === 'advanced') document.body.classList.add('adv');
    S.ov = true; document.body.classList.add('ov');
    begin();
  }
  window.addEventListener('beforeunload', () => { try { S.peer && S.peer.destroy(); } catch (e) {} });

  return {
    stop() {
      STOPPED = true;
      clearInterval(intervalId);
      removeEventListener('keydown', onKeyDown);
      AU.klaxon(false);
      document.body.classList.remove('melt', 'boom', 'alarm', 'cold');
    },
    state: S,
    diff: D,
  };
}
