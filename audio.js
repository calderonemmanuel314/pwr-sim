// SPDX-License-Identifier: AGPL-3.0-or-later
export const AU = { c: null, on: true, k: null };

AU.init = () => {
  if (!AU.c) {
    try { AU.c = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (AU.c && AU.c.state === 'suspended') AU.c.resume();
};

AU.tone = (f, d = .15, type = 'sine', v = .15, t0 = 0, f2) => {
  const c = AU.c;
  if (!c || !AU.on) return;
  const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + d + .02);
};

AU.noise = (d, v, fc) => {
  const c = AU.c;
  if (!c || !AU.on) return;
  const n = c.sampleRate * d, b = c.createBuffer(1, n, c.sampleRate), a = b.getChannelData(0);
  for (let i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  fl.type = 'lowpass';
  fl.frequency.value = fc;
  g.gain.value = v;
  s.buffer = b;
  s.connect(fl).connect(g).connect(c.destination);
  s.start();
};

AU.klaxon = on => {
  const c = AU.c;
  if (!c) return;
  if (on && AU.on && !AU.k) {
    const o = c.createOscillator(), g = c.createGain(), l = c.createOscillator(), lg = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = 650;
    l.frequency.value = 1.4; lg.gain.value = 220;
    l.connect(lg).connect(o.frequency);
    g.gain.value = .07;
    o.connect(g).connect(c.destination);
    o.start(); l.start();
    AU.k = { o, l };
  } else if ((!on || !AU.on) && AU.k) {
    try { AU.k.o.stop(); AU.k.l.stop(); } catch (e) {}
    AU.k = null;
  }
};

export const chime = () => [523, 659, 784, 1047].forEach((f, i) => AU.tone(f, .5, 'triangle', .18, i * .16));

let lastPhase = '';
export const phaseFx = (ph, m) => {
  if (ph === lastPhase) return;
  lastPhase = ph;
  document.body.classList.toggle('melt', ph === 'lose' && m);
  if (ph === 'lose') {
    AU.noise(2.5, .6, 500);
    AU.tone(90, 1.6, 'sawtooth', .3, 0, 30);
    navigator.vibrate && navigator.vibrate([400, 120, 400, 120, 800]);
  }
  if (ph === 'win') {
    chime();
    navigator.vibrate && navigator.vibrate(200);
  }
};

export function initAudioListeners() {
  addEventListener('pointerdown', () => AU.init());
  document.addEventListener('click', e => {
    if (e.target.closest('button')) AU.tone(660, .05, 'square', .05);
  });
}
