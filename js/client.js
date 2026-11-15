// SPDX-License-Identifier: AGPL-3.0-or-later
import { $, clamp, show, ask, goto } from './dom.js';
import { ROLES, DEF } from './config.js';
import { AU, phaseFx } from './audio.js';
import { loadPeer } from './qr.js';

export function joinPage() {
  show('#menu', false);
  show('#join', true);
  let sel = '';
  $('#jc').oninput = e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); };
  document.querySelectorAll('.dv').forEach(b => b.onclick = () => {
    sel = b.dataset.r;
    document.querySelectorAll('.dv').forEach(x => x.classList.toggle('on', x === b));
  });
  $('#jb').onclick = () => {
    const c = $('#jc').value;
    if (!/^\d{4}$/.test(c)) return $('#je').textContent = 'Enter the 4-digit join code.';
    if (!sel) return $('#je').textContent = 'Pick your division.';
    location.href = location.pathname + '?role=' + sel + '&room=gpwr-host-' + c;
  };
}

export function client(ROLE, ROOM) {
  const role = ROLE, R = ROLES[role], cur = DEF();
  let conn, peer, locked = false, retry, CD = 10, rejected = false, clientPhase = 'lobby';
  let SESSION_ID;
  try {
    SESSION_ID = sessionStorage.getItem('pwr_session_id');
    if (!SESSION_ID) {
      SESSION_ID = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      sessionStorage.setItem('pwr_session_id', SESSION_ID);
    }
  } catch (e) {
    SESSION_ID = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  show('#menu', false);
  show('#cl', true);
  $('#cn').textContent = R.n;
  $('#chome').onclick = async () => { if (await ask('Leave this panel?')) goto(location.pathname + '?role=join'); };

  const cc = $('#cc'), cv = $('#cv');
  const draw = () => {
    if (role === 'rods') cv.innerHTML = cur.rods + '<span>% INSERTED</span>';
    if (role === 'coolant') {
      cv.innerHTML = cur.pump + '<span>% PUMP</span>';
      const f = $('#fbi');
      if (f) {
        f.style.width = cur.pump + '%';
        f.style.animationDuration = (1.8 - cur.pump / 100 * 1.5) + 's';
        f.style.animationPlayState = cur.pump ? 'running' : 'paused';
      }
    }
    if (role === 'xenon') cv.innerHTML = cur.boron + '<span> ppm</span>';
    if (role === 'pressure') cv.innerHTML = '<span style="font-size:.42em">' + (cur.heat ? '▲ RISING' : cur.spray ? '▼ FALLING' : '■ HOLDING') + '</span>';
  };

  const slider = (k, max, step, txt, lo, hi) => {
    cc.innerHTML = '<p>' + txt + '</p><div class="srow"><button class="pm" data-d="-1">−</button><input type="range" id="sl" min="0" max="' + max + '" step="' + step + '" value="' + cur[k] + '"><button class="pm" data-d="1">+</button></div><div class="ends"><span>' + lo + '</span><span>' + hi + '</span></div>';
    $('#sl').oninput = e => { cur[k] = +e.target.value; draw(); };
    cc.querySelectorAll('.pm').forEach(b => b.onclick = () => {
      const q = $('#sl'), v = clamp(+q.value + (+b.dataset.d) * (k === 'boron' ? 50 : 5), +q.min, +q.max);
      q.value = v; cur[k] = v; draw();
    });
  };

  if (role === 'rods') slider('rods', 100, 1, 'Insert rods to slow the reaction. Withdraw them for more power.', '◄ WITHDRAW · more power', 'INSERT · less power ►');
  if (role === 'coolant') {
    slider('pump', 100, 1, 'A faster pump removes more heat from the core.', '◄ SLOWER · less cooling', 'FASTER · more cooling ►');
    cc.insertAdjacentHTML('beforeend', '<div class="flowbar"><i id="fbi"></i></div><p class="src">Closed loop.</p>');
    draw();
  }
  if (role === 'xenon') slider('boron', 2000, 10, 'Boron absorbs neutrons. Dilute it for more power, add it for less.', '◄ DILUTE · more power', 'ADD BORON · less power ►');
  if (role === 'pressure') {
    cc.innerHTML = '<p>Pick what the pressurizer does.</p><button class="tg up" data-m="1">▲ INCREASE PRESSURE<small>heaters ON</small></button><button class="tg" data-m="0">■ HOLD<small>heaters and spray off</small></button><button class="tg dn" data-m="-1">▼ DECREASE PRESSURE<small>spray ON</small></button>';
    cc.querySelectorAll('.tg').forEach(b => b.onclick = () => {
      const m = +b.dataset.m; cur.heat = m === 1 ? 1 : 0; cur.spray = m === -1 ? 1 : 0; sync(); draw();
    });
  }

  const sync = () => {
    const m = cur.heat ? 1 : cur.spray ? -1 : 0;
    cc.querySelectorAll('.tg').forEach(b => b.classList.toggle('on', +b.dataset.m === m));
  };
  const link = (t, ok, btnText) => {
    $('#lk').textContent = t; $('#lk').className = ok ? 'ok' : 'st'; $('#ex').disabled = !ok;
    if (btnText !== undefined) $('#ex').textContent = btnText;
  };
  const cool = () => {
    locked = true; $('#cl').classList.add('lock'); $('#ex').style.display = 'none'; $('#cd').style.display = 'block';
    const t0 = Date.now(), iv = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / (CD * 1000));
      $('#cdi').style.width = p * 100 + '%';
      if (p >= 1) {
        clearInterval(iv); locked = false; $('#cl').classList.remove('lock');
        $('#ex').style.display = ''; $('#cd').style.display = 'none';
      }
    }, 100);
  };

  $('#ex').onclick = () => {
    if (locked) return;
    if (clientPhase === 'overridden') {
      if (!conn || !conn.open) { link('OFFLINE · RECLAIM FAILED', false); $('#cb').textContent = 'Reconnect first.'; return; }
      try { conn.send({ t: 'reclaim', role }); $('#cb').textContent = 'Reclaim request sent.'; } catch (err) { $('#cb').textContent = 'Reclaim failed.'; }
      return;
    }
    const v = {}; R.k.forEach(k => v[k] = cur[k]);
    if (!conn || !conn.open) { link('OFFLINE · NOT SENT', false); $('#cb').textContent = 'Reconnect to the host first.'; return; }
    try { conn.send({ t: 'cmd', role, v }); } catch (err) { link('SEND FAILED', false); $('#cb').textContent = 'Not transmitted.'; return; }
    AU.init(); AU.tone(300, .25, 'sawtooth', .1, 0, 900); navigator.vibrate && navigator.vibrate(40); cool();
  };

  const re = () => {
    if (rejected) return;
    clearTimeout(retry);
    retry = setTimeout(() => { try { peer.destroy(); } catch (e) {} go(); }, 3000);
  };

  const go = () => {
    if (rejected) return;
    if (!ROOM) { link('NO ROOM IN URL', false, 'NO ROOM'); return; }
    link('CONNECTING…', false, 'CONNECTING…');
    if (!window.Peer) { loadPeer().then(go).catch(() => { link('PEERJS BLOCKED', false); re(); }); return; }
    try { peer = new window.Peer(); } catch (e) { link('PEERJS BLOCKED', false); return; }
    peer.on('open', () => {
      conn = peer.connect(ROOM, { reliable: true });
      conn.on('open', () => { link('CONNECTED · WAITING', false, 'WAITING FOR HOST'); conn.send({ t: 'hello', role, sessionId: SESSION_ID }); });
      conn.on('data', d => {
        if (!d) return;
        if (d.t === 'cap' && d.lim) {
          const q = $('#sl');
          if (q) {
            const key = R.k[0], mn = d.lim[key + 'Min'], mx = d.lim[key + 'Max'];
            if (mn !== undefined) q.min = mn;
            if (mx !== undefined) q.max = mx;
            if (+q.value < +q.min) { q.value = q.min; cur[key] = +q.min; }
            if (+q.value > +q.max) { q.value = q.max; cur[key] = +q.max; }
            draw();
          }
        }
        if (d.t === 'ack') {
          if (d.cd) CD = d.cd;
          if (d.br !== undefined) $('#cb').textContent = d.br + (d.hint ? ' · ' + d.hint : '');
          Object.assign(cur, d.v); draw(); sync();
          const s = $('#sl'); if (s) s.value = cur[R.k[0]];
        }
        if (d.t === 'st') {
          if (d.ph === 'rejected') {
            rejected = true; link('DIVISION TAKEN', false, 'DIVISION TAKEN');
            $('#cb').textContent = 'Returning to join page…';
            setTimeout(() => goto(location.pathname + '?role=join'), 3000);
            return;
          }
          clientPhase = d.ph;
          const eMap = { run: 'ONLINE', overridden: 'HOST HAS CONTROL', win: 'MISSION COMPLETE', lose: 'MISSION FAILED', lobby: 'WAITING FOR START', brief: 'BRIEFING ON SCREEN' };
          const bMap = { run: 'SEND ORDER', overridden: 'RECLAIM CONTROL', win: 'COMPLETE ✓', lose: 'ENDED', lobby: 'WAITING FOR HOST', brief: 'BRIEFING…' };
          const enabled = d.ph === 'run' || d.ph === 'overridden';
          link(eMap[d.ph] || 'ONLINE', enabled, bMap[d.ph] || 'WAITING…');
          phaseFx(d.ph, d.m);
        }
      });
      conn.on('close', () => { if (rejected) return; link('LINK LOST · RETRYING', false, 'LINK LOST'); re(); });
      conn.on('error', () => {});
    });
    peer.on('error', e => { link(e && e.type === 'peer-unavailable' ? 'ROOM NOT FOUND' : 'LINK ERROR · RETRYING', false); re(); });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  };

  draw(); sync(); go();
}
