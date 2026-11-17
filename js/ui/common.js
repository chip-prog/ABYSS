// 遊戲與 Studio 共用的畫面工具：建立元素、卡片外觀、彈出視窗、內容讀取。
import { CARD_TYPES } from '../engine/schema.js';
import { cardDef, isUnplayable } from '../engine/battle.js';
import { describeCard, keywordsOf } from '../engine/describe.js';

export const KEY_WORK = 'abyss.studio.content'; // Studio 的工作內容（測試環境）
export const KEY_RUN = 'abyss.run';

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) if (x != null) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x); }
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
  return el;
}
// 安全地替換子元素（自動略過空值）
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clone = (x) => JSON.parse(JSON.stringify(x));

export async function loadOfficial() {
  const r = await fetch('content/content.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('讀不到正式內容檔 content/content.json');
  return r.json();
}
export function loadWorking() {
  try { return JSON.parse(localStorage.getItem(KEY_WORK)); } catch { return null; }
}

const GLYPHS = {
  attack: '<path d="M6 34 L28 12 M28 12 l6 -6 l-1 7 z M9 27 l4 4 M5 35 l3 -1 l-2 -2 z"/>',
  skill: '<path d="M20 5 L33 10 V21 C33 29 27 34 20 37 C13 34 7 29 7 21 V10 Z"/>',
  blessing: '<path d="M20 4 l4 11 l11 1 l-9 7 l3 12 l-9 -7 l-9 7 l3 -12 l-9 -7 l11 -1 z"/>',
  status: '<circle cx="20" cy="20" r="13"/><path d="M12 20 q4 -7 8 0 t8 0"/>',
  curse: '<path d="M4 20 q16 -17 32 0 q-16 17 -32 0 z"/><circle cx="20" cy="20" r="5"/><path d="M20 3 v5 M20 32 v5"/>',
  tribute: '<path d="M12 8 a8 8 0 0 1 16 0 v6 h-16 z M9 14 h22 v20 h-22 z M20 21 v6"/>',
};

// 把說明文字裡的數字與〈狀態〉標出來
const richText = (s) => esc(s).replace(/〈[^〉]+〉/g, (m) => `<i>${m}</i>`).replace(/(\d+)/g, '<b>$1</b>');

export function cardEl(idx, source, opts = {}) {
  const def = source.effects ? source : cardDef(idx, source);
  if (!def) return h('div', { class: 'card' }, h('div', { class: 'card-name' }, '（遺失的卡片）'));
  const fac = idx.factions.get(def.faction);
  const na = isUnplayable(def);
  const el = h('div', {
    class: `card r-${def.rarity} t-${def.type}${source.upgraded || opts.upgraded ? ' upgraded' : ''}${opts.class ? ' ' + opts.class : ''}`,
    style: { '--fc': fac?.color || '#8c7a5e', ...(opts.width ? { '--cw': opts.width + 'px' } : {}) },
  },
    h('div', { class: 'card-cost' + (na ? ' na' : '') }, na ? '✕' : String(def.cost)),
    h('div', { class: 'card-name' }, def.name),
    h('div', { class: 'card-art' }, def.image ? h('img', { src: def.image, alt: '' }) : h('div', { html: `<svg viewBox="0 0 40 40">${GLYPHS[def.type] || ''}</svg>`, style: { display: 'contents' } })),
    h('div', { class: 'card-type' }, `${CARD_TYPES[def.type] || ''}・${fac?.name || ''}`),
    h('div', { class: 'card-text' }, h('div', { html: richText(describeCard(idx, def)) + (def.flavor && opts.flavor !== false ? `<div class="flavor">${esc(def.flavor)}</div>` : '') })),
    h('div', { class: 'card-rarity' }),
    def.publish === 'draft' ? h('div', { class: 'ribbon' }, '草稿') : null,
  );
  if (opts.tips !== false) {
    const kws = keywordsOf(idx, def);
    if (kws.length) el.append(h('div', { class: 'card-tips' }, kws.map((k) => h('div', { class: 'tip' }, h('b', {}, k.label), k.desc))));
  }
  return el;
}

export function modal(title, body, { closable = true, wide = false } = {}) {
  const back = h('div', { class: 'modal-back' });
  const box = h('div', { class: 'modal panel', style: wide ? { width: 'min(1100px, 96vw)' } : {} }, title ? h('h2', {}, title) : null, body);
  back.append(box);
  const close = () => back.remove();
  if (closable) back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.body.append(back);
  return { close, box, back };
}

export function toast(msg, ms = 2200) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function confirmBox(msg, okLabel = '確定', danger = false) {
  return new Promise((res) => {
    const m = modal('', h('div', {},
      h('p', { style: { margin: '4px 0 18px', whiteSpace: 'pre-line', textAlign: 'center' } }, msg),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn ghost', onclick: () => { m.close(); res(false); } }, '取消'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => { m.close(); res(true); } }, okLabel))), { closable: false });
  });
}

// 顯示一疊牌（牌組、棄牌堆等）
export function showCards(idx, title, cards, note) {
  modal(title, h('div', {},
    note ? h('p', { class: 'dim small', style: { textAlign: 'center', margin: 0 } }, note) : null,
    cards.length ? h('div', { class: 'card-pick' }, cards.map((c) => cardEl(idx, c, { width: 150 }))) : h('p', { class: 'dim', style: { textAlign: 'center' } }, '（空）')), { wide: true });
}
