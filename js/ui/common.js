// 遊戲與 Studio 共用的畫面工具：建立元素、卡片外觀、彈出視窗、內容讀取。
import { CARD_TYPES, CARD_RATIO, frameLayout, MOOD } from '../engine/schema.js';
import { cardDef, isUnplayable } from '../engine/battle.js';
import { describeCard, keywordsOf } from '../engine/describe.js';
import { imgUrl, kvGet, initImages, setAssetVersion } from './store.js';

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
  const text = await r.text();
  setAssetVersion(text);
  return JSON.parse(text);
}
// Studio 的工作內容（測試環境）。同時把上傳的圖片準備好。
export async function loadWorking() {
  try { await initImages(); return (await kvGet('content')) || null; } catch { return null; }
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
// 卡面文字上色：「卡名」→ 該卡陣營色粗體、〈狀態〉→ 紫色、能量數字 → 湖水綠、其他數字 → 暗紅。
// 以「§」開頭的行是置中粗體的標題行。
export function richText(idx, s) {
  const byName = new Map([...idx.cards.values()].map((c) => [c.name, c]));
  return String(s ?? '').split('\n').map((line) => {
    const head = line.startsWith('§');
    const html = esc(head ? line.slice(1) : line).replace(/「([^」]+)」|〈([^〉]+)〉|(\d+)(?=點能量)|(\d+)/g, (m, card, st, en, num) => {
      if (card != null) {
        const col = idx.factions.get(byName.get(card)?.faction)?.color;
        return `<span class="cn" style="color:${col ? `color-mix(in srgb, ${col} 78%, #000)` : 'inherit'}">${card}</span>`;
      }
      if (st != null) return `<i>${m}</i>`;
      if (en != null) return `<b class="en">${en}</b>`;
      return `<b>${num}</b>`;
    });
    return `<div class="ln${head ? ' head' : ''}">${html}</div>`;
  }).join('');
}

export function cardEl(idx, source, opts = {}) {
  const def = source.effects ? source : cardDef(idx, source);
  if (!def) return h('div', { class: 'card' }, h('div', { class: 'card-name' }, '（遺失的卡片）'));
  const fac = idx.factions.get(def.faction);
  const na = isUnplayable(def);
  if (fac?.frame?.img && imgUrl(fac.frame.img)) return framedCard(idx, def, fac, na, source.upgraded || opts.upgraded, opts);
  const el = h('div', {
    class: `card r-${def.rarity} t-${def.type}${source.upgraded || opts.upgraded ? ' upgraded' : ''}${opts.class ? ' ' + opts.class : ''}`,
    style: { '--fc': fac?.color || '#8c7a5e', ...(opts.width ? { '--cw': opts.width + 'px' } : {}) },
  },
    h('div', { class: 'card-cost' + (na ? ' na' : '') }, na ? '✕' : String(def.cost)),
    h('div', { class: 'card-name' }, def.name),
    h('div', { class: 'card-art' }, def.image && imgUrl(def.image) ? h('img', { src: imgUrl(def.image), alt: '', style: def.imagePos ? { objectPosition: `${def.imagePos.x ?? 50}% ${def.imagePos.y ?? 50}%`, scale: String(def.imagePos.zoom ?? 1) } : {} }) : h('div', { html: `<svg viewBox="0 0 40 40">${GLYPHS[def.type] || ''}</svg>`, style: { display: 'contents' } })),
    h('div', { class: 'card-type' }, `${CARD_TYPES[def.type] || ''}・${fac?.name || ''}`),
    h('div', { class: 'card-text' }, h('div', { class: 'card-desc', html: richText(idx, describeCard(idx, def)) }), h('div', { class: 'card-flavor' }, opts.flavor !== false ? def.flavor || '' : '')),
    h('div', { class: 'card-rarity' }),
    def.publish === 'draft' ? h('div', { class: 'ribbon' }, '草稿') : null,
  );
  if (opts.tips !== false) {
    const kws = keywordsOf(idx, def);
    if (kws.length) el.append(h('div', { class: 'card-tips' }, kws.map((k) => h('div', { class: 'tip' }, h('b', {}, k.label), k.desc))));
  }
  return el;
}

const pct = (n) => `${n}%`;
const box = (b) => ({ left: pct(b.left), top: pct(b.top), width: pct(b.right - b.left), height: pct(b.bottom - b.top) });
const point = (c) => ({ left: pct(c.x), top: pct(c.y), width: pct(c.size) });
function artEl(def) {
  return def.image && imgUrl(def.image)
    ? h('img', { src: imgUrl(def.image), alt: '', style: def.imagePos ? { objectPosition: `${def.imagePos.x ?? 50}% ${def.imagePos.y ?? 50}%`, scale: String(def.imagePos.zoom ?? 1) } : {} })
    : h('div', { html: `<svg viewBox="0 0 40 40">${GLYPHS[def.type] || ''}</svg>`, style: { display: 'contents' } });
}
function tipsEl(idx, def) {
  const kws = keywordsOf(idx, def);
  return kws.length ? h('div', { class: 'card-tips' }, kws.map((k) => h('div', { class: 'tip' }, h('b', {}, k.label), k.desc))) : null;
}

// 有上傳卡框的陣營：卡圖 → 卡框 → 程式排上的文字
function framedCard(idx, def, fac, na, upgraded, opts) {
  const L = frameLayout(fac);
  const nb = L.name, chars = Math.max(1, [...def.name].length);
  // 名稱對齊中線（預設卡片正中）；太長會碰到範圍邊界時才往內讓開，再不夠就縮小字級。
  // 單位：卡片字級 em，卡片寬 = 13.5em。
  const boxW = ((nb.right - nb.left) / 100) * 13.5, boxH = ((nb.bottom - nb.top) / 100) * 13.5 * CARD_RATIO;
  const nameSize = Math.min(0.95, boxH * 0.84, (boxW * 0.92) / (chars * 1.12));
  const textW = (chars * 1.12 * nameSize / 13.5) * 100; // 名稱寬度（卡片寬度的 %）
  const center = Math.min(Math.max(nb.center ?? 50, nb.left + textW / 2), nb.right - textW / 2);
  const el = h('div', {
    class: `card framed r-${def.rarity} t-${def.type}${upgraded ? ' upgraded' : ''}${opts.class ? ' ' + opts.class : ''}`,
    style: { '--fc': fac.color || '#8c7a5e', ...(opts.width ? { '--cw': opts.width + 'px' } : {}) },
  },
    h('div', { class: 'fc-art', style: box(L.art) }, artEl(def)),
    h('img', { class: 'fc-frame', src: imgUrl(fac.frame.img), alt: '', draggable: false }),
    h('div', { class: 'fc-gem g-' + def.rarity, style: point(L.gem) }),
    h('div', { class: 'fc-cost' + (na ? ' na' : ''), style: point(L.cost) }, na ? '✕' : String(def.cost)),
    h('div', { class: 'fc-name', style: { left: pct(center), top: pct(nb.top), height: pct(nb.bottom - nb.top), translate: '-50% 0', fontSize: `${nameSize}em` } }, h('span', {}, def.name)),
    h('div', { class: 'fc-text', style: box(L.text) },
      h('div', { class: 'fc-type' }, `${CARD_TYPES[def.type] || ''}・${fac.name || ''}`),
      h('div', { class: 'card-desc', html: richText(idx, describeCard(idx, def)) }),
      h('div', { class: 'card-flavor' }, opts.flavor !== false ? def.flavor || '' : '')),
    def.publish === 'draft' ? h('div', { class: 'ribbon' }, '草稿') : null,
    opts.tips !== false ? tipsEl(idx, def) : null);
  return el;
}

// 卡背：陣營自己的卡背 → 共用卡背 → 素面
export function cardBackEl(idx, factionId, width = 60) {
  const ref = idx.factions.get(factionId)?.back?.img || idx.raw.meta?.cardBack?.img;
  const url = imgUrl(ref);
  return h('div', { class: 'card-back', style: { '--cw': width + 'px' } }, url ? h('img', { src: url, alt: '', draggable: false }) : null);
}

// 把規則裡的畫面明暗套到某個元素（遊戲是 body，Studio 沙盒是戰鬥區）
export function applyMood(el, rules) {
  const m = { ...MOOD, ...(rules?.mood || {}) };
  el.style.setProperty('--mood-bright', String(m.bright / 100));
  el.style.setProperty('--vignette', String(m.vignette / 100));
  el.style.setProperty('--cardb', String(m.cards / 100));
  el.classList.toggle('mood-flicker', m.flicker !== false);
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
    cards.length ? h('div', { class: 'card-pick' }, cards.map((c) => cardEl(idx, c, { width: 170 }))) : h('p', { class: 'dim', style: { textAlign: 'center' } }, '（空）')), { wide: true });
}
