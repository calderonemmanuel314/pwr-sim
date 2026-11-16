// SPDX-License-Identifier: AGPL-3.0-or-later
import { $, show } from './dom.js';
import { ROLES, DIFF } from './config.js';
import { initAudioListeners } from './audio.js';
import { loadPeer } from './qr.js';
import { initAbout } from './about.js';
import { learn } from './learn.js';
import { joinPage, client } from './client.js';
import { host } from './host.js';
import { initExperiments, openLibrary } from './experiments.js';

function showDiff() {
  show('#menu', false);
  show('#diff', true);
  $('#dcards').innerHTML = ['easy', 'moderate', 'hard'].map(k => {
    const d = DIFF[k];
    return (
      '<button class="dcard ' + k + '" data-d="' + k + '">' +
      '<b>' + d.n + '</b><i>' + d.t + '</i>' +
      '<p>' + d.story + '</p>' +
      '<small>Hold ' + d.hold + ' s · about 315 MWe to grid · ' + Math.round(d.rem / 60) + ' min</small>' +
      '</button>'
    );
  }).join('');
  document.querySelectorAll('.dcard').forEach(b => {
    b.onclick = () => { show('#diff', false); host('group', b.dataset.d); };
  });
  $('#dback').onclick = () => { show('#diff', false); show('#menu', true); };
}

initAudioListeners();
initAbout();
initExperiments();
loadPeer().catch(() => { /* Retry happens when entering Group Mode or Client */ });

const Q = new URLSearchParams(location.search);
const ROLE = Q.get('role');
const ROOM = Q.get('room');

if (ROLE === 'join') {
  joinPage();
} else if (ROLE && ROLES[ROLE]) {
  client(ROLE, ROOM);
} else {
  $('#bGroup').onclick = showDiff;
  $('#bSand').onclick = () => host('sandbox');
  $('#bLearn').onclick = learn;
  $('#bAdv').onclick = () => { show('#menu', false); show('#advLanding', true); };
  $('#advFreeBtn').onclick = () => { show('#advLanding', false); host('advanced'); };
  $('#advLibBtn').onclick = openLibrary;
  $('#advBack').onclick = () => { show('#advLanding', false); show('#menu', true); };

  const mode = Q.get('mode');
  if (mode === 'group') showDiff();
  if (mode === 'learn') learn();
  if (mode === 'advanced') { show('#menu', false); show('#advLanding', true); }
}
