```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { $ , show } from './dom.js';
import { LEARN } from './config.js';
import { pmSVG } from './physics.js';

export function learn() {
  show('#menu', false);
  show('#learn', true);
  $('#lsvg').innerHTML = $('#svgw svg').outerHTML
    .replace(/id="(\w+)"/g, 'id="L$1"')
    .replace(/url\(#(\w+)\)/g, 'url(#L$1)');

  const sel = {
    core: ['#Lwater', '#Lvessel'],
    fuel: ['#Lfuel'],
    rods: ['#Lrods'],
    boron: ['rect[x="296"][y="274"]', '#Lblev', '#Lbpipe'],
    pump: ['#Lpump', 'circle[cx="260"][cy="400"]'],
    press: ['rect[x="215"][y="60"]', '#Lplev'],
    sg: ['rect[x="340"][y="150"]'],
    turb: ['#Lturb', 'polygon'],
    gen: ['rect[x="548"][y="60"]'],
    cond: ['rect[x="480"][y="430"]'],
    dome: ['#Ldome'],
    hot: ['#Lhot'],
    cold: ['#Lcold'],
    steam: ['#Lsteam', '#Lfeed'],
  };

  for (const k in sel) {
    sel[k].forEach(q => $('#lsvg').querySelectorAll(q).forEach(e => {
      e.dataset.part = k;
      e.classList.add('hp');
    }));
  }
  $('#lsvg').querySelectorAll('#Lcrack,#Lmolten').forEach(e => e.remove());
  const sh = $('#lsvg').querySelector('rect[fill="url(#Lsheen)"]');
  if (sh) sh.style.pointerEvents = 'none';

  const one = k => {
    const L = LEARN[k];
    $('#lt').textContent = L[0];
    $('#lr').textContent = L[1];
    $('#lg').textContent = L[2] ? 'In this game: ' + L[2] : '';
    $('#lx').innerHTML = L[3] === 'chart'
      ? '<svg viewBox="0 0 560 440" font-family="monospace" style="width:100%;max-height:44vh">' + pmSVG('lm', 0) + '</svg>'
      : '';
    document.querySelectorAll('#lsvg .hp').forEach(e => e.classList.toggle('sel', e.dataset.part === k));
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.p === k));
  };

  $('#lsvg').onclick = e => {
    const t = e.target.closest('[data-part]');
    if (t) one(t.dataset.part);
  };
  $('#lchips').innerHTML = Object.keys(LEARN).map(k => '<button class="chip" data-p="' + k + '">' + LEARN[k][0] + '</button>').join('');
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => one(c.dataset.p));
  $('#lback').onclick = () => { show('#learn', false); show('#menu', true); };
  one('rods');
}
```
