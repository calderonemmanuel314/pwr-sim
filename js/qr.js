// SPDX-License-Identifier: AGPL-3.0-or-later
let peerPromise = null;

export function loadPeer() {
  if (peerPromise) return peerPromise;
  const urls = [
    'https://unpkg.com/peerjs@1.5.1/dist/peerjs.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.1/dist/peerjs.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.1/peerjs.min.js',
  ];
  peerPromise = new Promise((res, rej) => {
    let i = 0;
    (function next() {
      if (window.Peer) return res();
      if (i >= urls.length) return rej(new Error('PeerJS unavailable'));
      const s = document.createElement('script');
      let done = false;
      const t = setTimeout(() => { if (!done) { done = true; s.remove(); next(); } }, 7000);
      s.src = urls[i++];
      s.onload = () => { if (!done) { done = true; clearTimeout(t); window.Peer ? res() : next(); } };
      s.onerror = () => { if (!done) { done = true; clearTimeout(t); next(); } };
      document.head.appendChild(s);
    })();
  });
  peerPromise.catch(() => { peerPromise = null; });
  return peerPromise;
}

export const qrMake = text => {
  const u = Array.from(new TextEncoder().encode(text)), ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22], NB = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5];
  const raw = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; } if (v >= 7) r -= 36; return r; };
  let v = 1; for (; v <= 9; v++) if (12 + 8 * u.length <= (Math.floor(raw(v) / 8) - ECC[v] * NB[v]) * 8) break;
  if (v > 9) return null;
  const cw = Math.floor(raw(v) / 8), dc = cw - ECC[v] * NB[v], bits = [], pb = (x, n) => { for (let i = n - 1; i >= 0; i--) bits.push((x >>> i) & 1); };
  pb(4, 4); pb(u.length, 8); u.forEach(b => pb(b, 8)); pb(0, Math.min(4, dc * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const d = []; for (let i = 0; i < bits.length; i += 8) d.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xEC; d.length < dc; pad ^= 0xEC ^ 0x11) d.push(pad);
  const gm = (x, y) => { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; };
  const n = ECC[v], dv = Array(n).fill(0); dv[n - 1] = 1; for (let i = 0, r = 1; i < n; i++) { for (let j = 0; j < n; j++) { dv[j] = gm(dv[j], r); if (j + 1 < n) dv[j] ^= dv[j + 1]; } r = gm(r, 2); }
  const nb = NB[v], ns = nb - cw % nb, sl = Math.floor(cw / nb), bl = []; let k = 0;
  for (let i = 0; i < nb; i++) { const dat = d.slice(k, k + sl - n + (i < ns ? 0 : 1)); k += dat.length; const rm = Array(n).fill(0); dat.forEach(b => { const f = b ^ rm.shift(); rm.push(0); dv.forEach((c, q) => rm[q] ^= gm(c, f)); }); if (i < ns) dat.push(0); bl.push(dat.concat(rm)); }
  const all = []; for (let i = 0; i < bl[0].length; i++) bl.forEach((b, j) => { if (i !== sl - n || j >= ns) all.push(b[i]); });
  const sz = v * 4 + 17, m = Array.from({ length: sz }, () => Array(sz).fill(false)), fn = Array.from({ length: sz }, () => Array(sz).fill(false)), sf = (x, y, c) => { m[y][x] = c; fn[y][x] = true; }, bt = (x, i) => ((x >>> i) & 1) === 1;
  for (let i = 0; i < sz; i++) { sf(6, i, i % 2 === 0); sf(i, 6, i % 2 === 0); }
  const fd = (x, y) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const q = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy; if (xx >= 0 && xx < sz && yy >= 0 && yy < sz) sf(xx, yy, q !== 2 && q !== 4); } };
  fd(3, 3); fd(sz - 4, 3); fd(3, sz - 4);
  const na = v === 1 ? 0 : Math.floor(v / 7) + 2, ap = []; if (na) { const st = Math.ceil((v * 4 + 4) / (na * 2 - 2)) * 2; ap.push(6); for (let p = sz - 7, c = 1; c < na; c++, p -= st) ap.splice(1, 0, p); }
  ap.forEach((a, i) => ap.forEach((b, j) => { if (!((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0))) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) sf(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const fmt = mk => {
    let r = mk; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537); const b = ((mk << 10) | r) ^ 0x5412;
    for (let i = 0; i <= 5; i++) sf(8, i, bt(b, i)); sf(8, 7, bt(b, 6)); sf(8, 8, bt(b, 7)); sf(7, 8, bt(b, 8)); for (let i = 9; i < 15; i++) sf(14 - i, 8, bt(b, i));
    for (let i = 0; i < 8; i++) sf(sz - 1 - i, 8, bt(b, i)); for (let i = 8; i < 15; i++) sf(8, sz - 15 + i, bt(b, i)); sf(8, sz - 8, true);
  };
  fmt(0);
  if (v >= 7) { let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25); const b = (v << 12) | r; for (let i = 0; i < 18; i++) { const c = bt(b, i), a = sz - 11 + i % 3, q = Math.floor(i / 3); sf(a, q, c); sf(q, a, c); } }
  let i = 0; for (let right = sz - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vt = 0; vt < sz; vt++) for (let j = 0; j < 2; j++) { const x = right - j, y = ((right + 1) & 2) === 0 ? sz - 1 - vt : vt; if (!fn[y][x] && i < all.length * 8) { m[y][x] = bt(all[i >>> 3], 7 - (i & 7)); i++; } } }
  const mf = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  const am = mk => { for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) if (!fn[y][x] && mf[mk](x, y)) m[y][x] = !m[y][x]; };
  const pen = () => {
    let p = 0; for (let a = 0; a < 2; a++) for (let ii = 0; ii < sz; ii++) { let run = 1; for (let j = 1; j < sz; j++) { const c = a ? m[j][ii] : m[ii][j], e = a ? m[j - 1][ii] : m[ii][j - 1]; if (c === e) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
    for (let y = 0; y < sz - 1; y++) for (let x = 0; x < sz - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    let dk = 0; m.forEach(r => r.forEach(c => dk += c ? 1 : 0)); return p + (Math.ceil(Math.abs(dk * 20 - sz * sz * 10) / (sz * sz)) - 1) * 10;
  };
  let best = 0, bp = 1e9; for (let mk = 0; mk < 8; mk++) { am(mk); fmt(mk); const p = pen(); am(mk); if (p < bp) { bp = p; best = mk; } }
  am(best); fmt(best);
  let pth = ''; m.forEach((r, y) => r.forEach((c, x) => { if (c) pth += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z'; }));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + (sz + 8) + ' ' + (sz + 8) + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + pth + '" fill="#000"/></svg>';
};
