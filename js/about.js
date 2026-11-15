```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { APP_VERSION, APP_BUILD } from './config.js';

export function initAbout() {
  const bAbout = document.getElementById('bAbout');
  const aboutScr = document.getElementById('aboutScreen');
  const showAbout = () => { if (aboutScr) aboutScr.classList.remove('hide'); };
  const hideAbout = () => { if (aboutScr) aboutScr.classList.add('hide'); };

  if (bAbout) bAbout.onclick = showAbout;
  const closeBtn = document.getElementById('aboutClose');
  if (closeBtn) closeBtn.onclick = hideAbout;

  addEventListener('keydown', e => {
    if (e.key === 'Escape' && aboutScr && !aboutScr.classList.contains('hide')) hideAbout();
  });

  const vEl = document.getElementById('aboutVersion');
  if (vEl) vEl.textContent = 'v' + APP_VERSION + ' · ' + APP_BUILD;

  const dlLink = document.getElementById('aboutDownload');
  if (dlLink) dlLink.href = 'about.html?v=' + APP_VERSION;

  fetch('about.html', { method: 'HEAD', cache: 'no-store' }).then(r => {
    if (!r.ok && dlLink) dlLink.style.display = 'none';
  }).catch(() => { /* network error — leave button visible */ });
}
```
