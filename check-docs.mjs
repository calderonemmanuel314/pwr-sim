// SPDX-License-Identifier: AGPL-3.0-or-later
// tools/check-docs.mjs — checks that the docs agree with the code.
// Run from the repo root:   node tools/check-docs.mjs
// Needs Node 18+ (check with: node --version). No npm install, no network.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.existsSync(path.join(ROOT, f)) ? fs.readFileSync(path.join(ROOT, f), 'utf8') : null;
const strip = html => html.replace(/<[^>]*>/g, '');           // HTML -> plain text
const num = s => parseFloat(String(s).replace(/,/g, '').replace('−', '-'));

const { APP_VERSION, APP_BUILD, DIFF } = await import(pathToFileURL(path.join(ROOT, 'js/config.js')));
const P = await import(pathToFileURL(path.join(ROOT, 'js/physics.js')));

let fails = 0, warns = 0;
const ok   = m => console.log('  \x1b[32m✔\x1b[0m ' + m);
const bad  = m => { fails++; console.log('  \x1b[31m✖\x1b[0m ' + m); };
const warn = m => { warns++; console.log('  \x1b[33m!\x1b[0m ' + m); };
const skip = m => console.log('  \x1b[90m–\x1b[0m ' + m);
const head = t => console.log('\n' + t);

// ---------- helper: compare a number in a doc against a recomputed value ----------
// file: doc to search | re: regex with ONE capture group holding the number
// value: what the code computes | tol: allowed absolute difference
const docs = { 'about.html': strip(read('about.html') || ''), 'README.md': read('README.md') || '' };
function claim(name, file, re, value, tol, unit = '') {
  const text = docs[file];
  const m = text && text.match(re);
  if (!m) return skip(`${name}: not mentioned in ${file} (nothing to check)`);
  const doc = num(m[1]);
  const diff = Math.abs(doc - value);
  const msg = `${name}: ${file} says ${doc}${unit}, code gives ${value.toFixed(2)}${unit}`;
  diff <= tol ? ok(msg) : bad(msg + `  (off by ${diff.toFixed(2)}, allowed ${tol})`);
}

// ---------- 1. version and build date ----------
head('1. Version and build date  (source of truth: js/config.js → ' + APP_VERSION + ' / ' + APP_BUILD + ')');
const v = (name, found) => found == null ? warn(`${name}: version string not found`)
  : found === APP_VERSION ? ok(`${name}: ${found}`) : bad(`${name}: says ${found}, config.js says ${APP_VERSION}`);
v('about.html header', docs['about.html'].match(/Version\s*(\d+\.\d+\.\d+)/)?.[1]);
v('about.html footer', docs['about.html'].match(/End of documentation\.\s*Version\s*(\d+\.\d+\.\d+)/)?.[1]);
v('index.html badge', (read('index.html') || '').match(/id="aboutVersion">v(\d+\.\d+\.\d+)/)?.[1]);
const bld = docs['about.html'].match(/End of documentation\.\s*Version\s*[\d.]+\s*·\s*(\d{4}-\d{2}-\d{2})/)?.[1];
bld && (bld === APP_BUILD ? ok(`about.html build date: ${bld}`) : bad(`about.html build date ${bld} ≠ config.js ${APP_BUILD}`));

// ---------- 2. files ----------
head('2. Files referenced by index.html exist');
const idx = read('index.html') || '';
for (const m of idx.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)/g))
  fs.existsSync(path.join(ROOT, m[1])) ? ok(m[1]) : bad(`index.html references ${m[1]} but it does not exist`);
['LICENSE', 'README.md', 'about.html'].forEach(f =>
  fs.existsSync(path.join(ROOT, f)) ? ok(f + ' present') : warn(f + ' is missing from the repo root'));

// ---------- 3. physics numbers recomputed from the code ----------
head('3. Physics numbers quoted in the docs, recomputed from js/physics.js');
const pcm = k => (k - 1) / k * 1e5;
const nb = (o, xe, T, Tf, aD) => P.neutronBalance({ rods: o.rods, boron: o.boron }, xe, T, 15.5, Tf, aD).kEff;
const base = { rods: 50, boron: 1000 };

// boron worth, pcm per ppm
const boron = (pcm(nb({ ...base, boron: 1100 }, 0, 310, 310, 0.0001)) - pcm(nb(base, 0, 310, 310, 0.0001))) / 100;
claim('Boron worth (pcm/ppm)', 'about.html', /approximately\s*([−-]?\d+(?:\.\d+)?)\s*pcm\/ppm/, boron, 0.7);

// Doppler at full power: fuel is (1000+20)/H_FUEL_COOLANT kelvin hotter than coolant
const dTf = (1000 + 20) / P.H_FUEL_COOLANT;
const doppler = key => {
  const aD = DIFF[key].alphaDoppler;
  return pcm(nb(base, 0, 310, 310, aD)) - pcm(nb(base, 0, 310, 310 + dTf, aD));
};
claim('Doppler, Easy, full power (pcm)',     'about.html', /Easy gives\s*~?([\d,]+)\s*pcm/,     doppler('easy'),     150, ' pcm');
claim('Doppler, Moderate, full power (pcm)', 'about.html', /Moderate gives\s*~?([\d,]+)\s*pcm/, doppler('moderate'),  80, ' pcm');
claim('Doppler, Hard, full power (pcm)',     'about.html', /Hard gives\s*~?([\d,]+)\s*pcm/,     doppler('hard'),      60, ' pcm');

// total rod-bank worth
const rodWorth = pcm(nb({ ...base, rods: 0 }, 0, 310, 310, 0.0001)) - pcm(nb({ ...base, rods: 100 }, 0, 310, 310, 0.0001));
claim('Total rod worth (pcm)', 'about.html', /(?:control bank|rod bank|rod worth)[^.]{0,40}?~?([\d,]{4,6})\s*pcm/i, rodWorth, 400, ' pcm');

// Λ inflation of the asymptotic ρ–period relation
const sBL = P.BETA_GROUPS.reduce((a, b, j) => a + b / P.LAMBDA_GROUPS[j], 0);
claim('Λ inflation factor', 'about.html', /Λ[\s\S]{0,250}?(\d\.\d+)\s*×/, (P.LAMBDA_PROMPT_MODEL + sBL) / sBL, 0.05, '×');

// grid power at 1000 MWth
claim('Grid power at 1000 MWth (MWe)', 'about.html', /delivers\s*~?(\d+)\s*MWe/, P.gridPowerMWe(1000), 3, ' MWe');

// xenon: replicate the 2 update lines in js/host.js (guarded below)
const hostSrc = read('js/host.js') || '';
const xenonLines = ['xi0 + .0077 * f - .0167 * xi0', 'xe0 + .0167 * xi0 + .0007 * f - (.002 + .01 * f) * xe0'];
if (!xenonLines.every(s => hostSrc.includes(s))) {
  warn('host.js xenon equations changed — update the copy in tools/check-docs.mjs before trusting the xenon checks');
} else {
  const step = (s, f) => { const xi = s.xi, xe = s.xe;
    s.xi = Math.max(0, xi + .0077 * f - .0167 * xi);
    s.xe = Math.max(0, xe + .0167 * xi + .0007 * f - (.002 + .01 * f) * xe); };
  const settle = f => { const s = { xi: .3, xe: .3 }; for (let t = 0; t < 30000; t++) step(s, f); return s; };
  const trip = f => { const s = settle(f), eq = s.xe; let pk = 0, tp = 0;
    for (let t = 0; t < 3000; t++) { step(s, 0); if (s.xe > pk) { pk = s.xe; tp = t; } }
    return { eq, pk, tp }; };
  const r = trip(1000 / 1500);
  claim('Post-trip xenon peak time (s)',     'about.html', /peaks (?:about |~)?(\d+)\s*seconds/, r.tp, 10, ' s');
  claim('Post-trip xenon overshoot (%)',     'about.html', /~?(\d+)%\s*overshoot/,             (r.pk / r.eq - 1) * 100, 3, '%');
  claim('Max xenon the model can reach',     'about.html', /can (?:produce|reach)[^~\d]*~?(\d\.\d+)/i, trip(1.2).pk, 0.02);
  const xeWorth = pcm(nb(base, 0, 310, 310, 0.0001)) - pcm(nb(base, r.eq, 310, 310, 0.0001));
  claim('Equilibrium xenon worth (pcm)',     'about.html', /equilibrium xenon worth[^~]{0,40}~([\d,]{5,6})\s*pcm/i, xeWorth, 900, ' pcm');
}

// ---------- 4. stale wording ----------
head('4. Stale wording');
const stale = [[/PWR Control Room|GPWR Control Room/, 'old project name'],
               [/matches theory/, '"matches theory" (periods are ~2–5× off a real reactor; see inhour check)'],
               [/Temperature responds slowly/, '"responds slowly" (thermalTau is MJ/K; real response is ~5–25 s)']];
let hit = false;
for (const [f, txt] of [['README.md', docs['README.md']], ['about.html', docs['about.html']]])
  for (const [re, why] of stale)
    if (txt.split('\n').some(l => re.test(l) && !/renamed/i.test(l))) { hit = true; warn(`${f}: contains ${why}`); }
hit || ok('no stale phrases found');

console.log(`\n${fails ? '\x1b[31mFAILED\x1b[0m' : '\x1b[32mPASSED\x1b[0m'} — ${fails} mismatch(es), ${warns} warning(s)`);
process.exit(fails ? 1 : 0);
