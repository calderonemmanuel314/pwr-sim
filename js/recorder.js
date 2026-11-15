```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { AU } from './audio.js';
import { doseFromState } from './physics.js';

export function renderRecorder(S) {
  if (S.mode !== 'advanced') return;
  const rec = S.adv;
  const recording = rec.recording;
  const stopped = !recording && rec.rows.length > 0;
  const idle = !recording && rec.rows.length === 0;
  const dot = document.getElementById('recDot');
  const t = document.getElementById('recTime');
  const r = document.getElementById('recRows');
  const btnS = document.getElementById('recStart');
  const btnT = document.getElementById('recStop');
  const btnCSV = document.getElementById('recCSV');
  const btnC = document.getElementById('recClear');
  if (!dot) return;

  dot.className = 'rec-dot' + (recording ? ' rec-dot-on' : '');
  const secs = rec.rows.length;
  if (t) t.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
  if (r) r.textContent = 'Rows: ' + secs + ' / ' + rec.maxRows;
  if (btnS) { btnS.style.display = (idle || stopped) ? '' : 'none'; btnS.disabled = stopped; }
  if (btnT) btnT.style.display = recording ? '' : 'none';
  if (btnCSV) btnCSV.disabled = !stopped;
  if (btnC) btnC.disabled = rec.rows.length === 0;
}

export function exportCSV(S) {
  if (S.mode !== 'advanced' || !S.adv.rows.length) return;
  const header = 'time_s,rod_pct,pump_pct,boron_ppm,heat,spray,countrate_cps,dose_usvh,period_s,reactivity_pcm,k_eff,flux_thermal,temp_c,pressure_mpa';
  const csv = header + '\n' + S.adv.rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'pwr-data-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function recordAdvTick(S) {
  if (S.mode !== 'advanced') return;
  S.adv.n16 += 0.0975 * (S.Nf / 1000 - S.adv.n16);
  S.adv.fp += (1 / 3600) * (S.Nf / 1000 - S.adv.fp);
  S.adv.dPowerHistory.push(S.dPower);
  if (S.adv.dPowerHistory.length > 5) S.adv.dPowerHistory.shift();

  if (S.adv.recording && S.adv.rows.length < S.adv.maxRows) {
    const i = S.in;
    const cps = 1e9 * S.Nf / 1000;
    const dose = doseFromState(S.Nf, S.adv.n16, S.precursors || [], S.adv.fp);
    const flux = 3e13 * S.Nf / 1000;
    const avgDP = S.adv.dPowerHistory.length
      ? S.adv.dPowerHistory.reduce((a, b) => a + b, 0) / S.adv.dPowerHistory.length
      : 0;
    const nearNoise = S.Nf < 1e-5;
    const stable = nearNoise || Math.abs(avgDP) <= 0.001 * Math.abs(S.Nf || 1);
    const periodStr = stable ? 'inf' : (S.Nf / avgDP).toFixed(2);
    const rhoPcm = ((S.k - 1) / S.k * 1e5).toFixed(1);
    S.adv.rows.push([
      S.adv.rows.length,
      i.rods, i.pump, i.boron, i.heat, i.spray,
      cps.toFixed(0), dose.toFixed(1), periodStr, rhoPcm,
      S.k.toFixed(6), flux.toExponential(3), S.T.toFixed(2), S.P.toFixed(4),
    ].join(','));
    if (S.adv.rows.length >= S.adv.maxRows) S.adv.recording = false;
  }
}

export function bindRecorderControls(S) {
  const recStartBtn = document.getElementById('recStart');
  if (recStartBtn) recStartBtn.onclick = () => {
    if (S.mode !== 'advanced') return;
    S.adv.rows = [];
    S.adv.recording = true;
    renderRecorder(S);
    AU.init(); AU.tone(660, .08, 'square', .1);
  };
  const recStopBtn = document.getElementById('recStop');
  if (recStopBtn) recStopBtn.onclick = () => {
    if (S.mode !== 'advanced') return;
    S.adv.recording = false;
    renderRecorder(S);
    AU.init(); AU.tone(330, .1, 'square', .1);
  };
  const recCSVBtn = document.getElementById('recCSV');
  if (recCSVBtn) recCSVBtn.onclick = () => {
    if (S.mode !== 'advanced') return;
    exportCSV(S);
  };
  const recClearBtn = document.getElementById('recClear');
  if (recClearBtn) recClearBtn.onclick = () => {
    if (S.mode !== 'advanced') return;
    S.adv.rows = [];
    S.adv.recording = false;
    renderRecorder(S);
  };
}
```
