// SPDX-License-Identifier: AGPL-3.0-or-later
export const $ = s => document.querySelector(s);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const show = (id, on) => $(id).classList.toggle('hide', !on);
export const fmt = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

export const setText = (sel, txt) => {
  const el = document.querySelector(sel);
  if (el) el.textContent = txt;
};
export const setHTML = (sel, html) => {
  const el = document.querySelector(sel);
  if (el) el.innerHTML = html;
};
export const setAttr = (sel, attr, val) => {
  const el = document.querySelector(sel);
  if (el) el.setAttribute(attr, val);
};

export const ask = m => new Promise(r => {
  $('#cfm').textContent = m;
  show('#cf', true);
  $('#cfy').onclick = () => { show('#cf', false); r(true); };
  $('#cfn').onclick = () => { show('#cf', false); r(false); };
});

export const goto = u => location.replace(u + (u.includes('?') ? '&' : '?') + 't=' + Date.now());
