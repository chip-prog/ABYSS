// 戰鬥場景，由後往前：
//   教堂底紋 → 零件（最後方）→ 三聯畫 → 舞台地板 → 零件（中間）→【紙偶】→ 零件（最前方）→ 前景
// 教堂、地板、前景、三聯畫外框是所有場景共用的素材（規則頁）；三聯畫畫面、版面與零件跟著場景走（場景頁）。
// 沒有素材的層會用暗色的暫代圖樣。所有位置都以戰鬥畫面的寬高百分比計算。
import { h } from './common.js';
import { imgUrl } from './store.js';
import { TRI_LAYOUT, STAGE_LAYOUT } from '../engine/schema.js';

const url = (o) => imgUrl(o?.img);
const pos = (o) => (o?.pos ? { objectPosition: `${o.pos.x ?? 50}% ${o.pos.y ?? 50}%`, scale: String(o.pos.zoom ?? 1) } : {});
const layer = (cls, o, style) => {
  const src = url(o);
  return h('div', { class: cls + (src ? ' has' : ''), style }, src ? h('img', { src, alt: '', draggable: false, style: pos(o) }) : null);
};

function partEl(p, i) {
  const src = imgUrl(p.img);
  if (!src) return null;
  return h('div', { class: 'part', style: { left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}cqw`, rotate: `${p.rot || 0}deg`, '--op': String((p.opacity ?? 100) / 100), '--i': String(i) } },
    h('img', { src, alt: '', draggable: false, class: `mv-${p.motion || 'none'}`, style: {
      '--spd': `${p.speed || 3}s`, '--amp': String(p.amp ?? 6), animationDelay: `${-((i * 0.37) % 1) * (p.speed || 3)}s`, scale: p.flip ? '-1 1' : null,
    } }));
}
const partsOf = (sc, lyr) => (sc.parts || []).map((p, i) => (p.layer || 'mid') === lyr ? partEl(p, i) : null);

export function makeScene(idx, scene) {
  const st = idx.raw.meta?.stage || {};
  const S = { ...STAGE_LAYOUT, ...(idx.rules.stage || {}) };
  const sc = scene || {};
  const T = { ...TRI_LAYOUT, ...(sc.layout || {}) };
  const wing = (side) => h('div', { class: `tri-wing ${side}` },
    layer('tri-face front', sc[side]),
    layer('tri-face back', sc[side + 'Back']));
  const tri = h('div', { class: 'tri closed', style: {
    left: `${T.x}%`, top: `${T.y}%`, width: `min(${T.width}cqw, ${T.height}cqh * 2.2857)`, '--wing': `${T.wing}deg`, filter: `brightness(${T.bright / 100}) saturate(.85)`,
  } },
    layer('tri-center', sc.center),
    st.frame?.img ? h('img', { class: 'tri-frame', src: url(st.frame), alt: '', draggable: false }) : h('div', { class: 'tri-frame ph' }),
    wing('left'), wing('right'));
  const el = h('div', { class: 'scene' },
    layer('scene-church', st.church, { '--bright': String(S.churchBright / 100) }),
    h('div', { class: 'scene-light' }, h('i'), h('i'), h('i')),
    h('div', { class: 'parts back' }, partsOf(sc, 'back')),
    tri,
    layer('scene-floor', st.floor, { '--floor': `${S.floorTop}%` }),
    h('div', { class: 'parts mid' }, partsOf(sc, 'mid')),
    h('div', { class: 'scene-motes' }));
  // 最前方的零件和前景要蓋在紙偶前面，由戰鬥畫面另外放
  const fore = h('div', { class: 'scene-front' }, h('div', { class: 'parts front' }, partsOf(sc, 'front')), layer('scene-fore', st.fore));
  const all = [el, fore];
  return {
    el, fore, sidePad: S.sidePad,
    open: () => { tri.classList.remove('closed'); all.forEach((x) => x.classList.add('entered')); },
    close: () => tri.classList.add('closed'),
  };
}
