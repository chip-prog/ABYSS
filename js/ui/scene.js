// 戰鬥場景，由後往前：
//   教堂底紋 → 零件（最後方）→ 三聯畫 → 舞台地板 → 零件（中間）→【紙偶】→ 零件（最前方）→ 前景
// 三聯畫是三片各自有框的畫板，中間留縫，兩翼繞著靠中央那一側的鉸鏈開闔。
// 畫板會依外框開口的形狀裁切（外框的 mask）。沒有素材的層會用暗色的暫代圖樣。
// 教堂、地板、前景、外框是所有場景共用（規則頁）；畫板、版面與零件跟著場景走（場景頁）。
import { h } from './common.js';
import { imgUrl } from './store.js';
import { TRI_LAYOUT, STAGE_LAYOUT } from '../engine/schema.js';

const url = (o) => imgUrl(o?.img);
const pos = (o) => (o?.pos ? { objectPosition: `${o.pos.x ?? 50}% ${o.pos.y ?? 50}%`, scale: String(o.pos.zoom ?? 1) } : {});
const pct = (n) => `${n}%`;
const layer = (cls, o, style) => {
  const src = url(o);
  return h('div', { class: cls + (src ? ' has' : ''), style }, src ? h('img', { src, alt: '', draggable: false, style: pos(o) }) : null);
};

// 沒有外框時的預設形狀：開口就是整片
const NO_FRAME = { center: { ratio: 7 / 8, open: { left: 0, right: 100, top: 0, bottom: 100 } }, wing: { ratio: 7 / 4, open: { left: 0, right: 100, top: 0, bottom: 100 } } };

function partEl(p, i) {
  const src = imgUrl(p.img);
  if (!src) return null;
  return h('div', { class: 'part', style: { left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}cqw`, rotate: `${p.rot || 0}deg`, '--op': String((p.opacity ?? 100) / 100), '--i': String(i) } },
    h('img', { src, alt: '', draggable: false, class: `mv-${p.motion || 'none'}`, style: {
      '--spd': `${p.speed || 3}s`, '--amp': String(p.amp ?? 6), animationDelay: `${-((i * 0.37) % 1) * (p.speed || 3)}s`, scale: p.flip ? '-1 1' : null,
    } }));
}
const partsOf = (sc, lyr) => (sc.parts || []).map((p, i) => (p.layer || 'mid') === lyr ? partEl(p, i) : null);

// 一片畫板：畫面（依開口裁切）＋外框。flip：整片左右翻轉（右翼用同一張翼板外框）
function panelFace(frame, fallback, panel, { flip = false, back = false, kind }) {
  const F = frame?.img ? frame : null;
  const open = (F || fallback).open;
  const mask = imgUrl(F?.mask);
  const src = url(panel);
  const pic = h('div', { class: 'pf-pic' + (src ? ' has' : ' ph'), style: { left: pct(open.left), top: pct(open.top), width: pct(open.right - open.left), height: pct(open.bottom - open.top) } },
    src ? h('img', { src, alt: '', draggable: false, style: pos(panel) }) : null);
  const clip = h('div', { class: 'pf-clip', style: mask ? { maskImage: `url("${mask}")`, webkitMaskImage: `url("${mask}")` } : {} }, pic);
  return h('div', { class: `pf ${kind}${back ? ' back' : ' front'}${flip ? ' flip' : ''}` },
    clip,
    F ? h('img', { class: 'pf-frame', src: imgUrl(F.img), alt: '', draggable: false }) : h('div', { class: 'pf-frame ph' }));
}

// 依兩種外框的比例與開口，算出三片的位置：兩翼縮放到開口高度和中央一樣，開口下緣對齊
function geometry(cf, wf, gap) {
  const C = cf?.img ? cf : NO_FRAME.center, W = wf?.img ? wf : NO_FRAME.wing;
  const cw = 1, ch = C.ratio;
  const openH = ((C.open.bottom - C.open.top) / 100) * ch;
  const ww = openH / (((W.open.bottom - W.open.top) / 100) * W.ratio), wh = ww * W.ratio;
  const cBottom = (C.open.bottom / 100) * ch;
  const wTop = cBottom - (W.open.bottom / 100) * wh;
  const top = Math.min(0, wTop), bottom = Math.max(ch, wTop + wh);
  const totalW = cw + 2 * ww + 2 * gap, totalH = bottom - top;
  const box = (x, y, w, hh) => ({ left: pct((x / totalW) * 100), top: pct(((y - top) / totalH) * 100), width: pct((w / totalW) * 100), height: pct((hh / totalH) * 100) });
  return {
    aspect: totalW / totalH,
    center: box(ww + gap, 0, cw, ch),
    left: box(0, wTop, ww, wh),
    right: box(ww + 2 * gap + cw, wTop, ww, wh),
  };
}

export function makeScene(idx, scene) {
  const st = idx.raw.meta?.stage || {};
  const S = { ...STAGE_LAYOUT, ...(idx.rules.stage || {}) };
  const sc = scene || {};
  const T = { ...TRI_LAYOUT, ...(sc.layout || {}) };
  const G = geometry(st.frame, st.wingFrame, (T.gap ?? 2) / 100);
  const wing = (side) => h('div', { class: `tri-wing ${side}`, style: G[side] },
    panelFace(st.wingFrame, NO_FRAME.wing, sc[side], { flip: side === 'right', kind: 'wing' }),
    panelFace(st.wingFrame, NO_FRAME.wing, sc[side + 'Back'], { flip: side === 'left', back: true, kind: 'wing' }));
  const tri = h('div', { class: 'tri closed', style: {
    left: `${T.x}%`, top: `${T.y}%`, width: `min(${T.width}cqw, ${T.height}cqh * ${G.aspect.toFixed(4)})`, aspectRatio: G.aspect.toFixed(4),
    '--wing': `${T.wing}deg`, filter: `brightness(${T.bright / 100}) saturate(.85)`,
  } },
    h('div', { class: 'tri-center', style: G.center }, panelFace(st.frame, NO_FRAME.center, sc.center, { kind: 'center' })),
    wing('left'), wing('right'));
  const church = url(st.church);
  const floor = url(st.floor);
  const el = h('div', { class: 'scene' },
    h('div', { class: 'scene-church' + (church ? ' has' : ''), style: { '--bright': String(S.churchBright / 100), backgroundImage: church ? `url("${church}")` : null } }),
    h('div', { class: 'scene-light' }, h('i'), h('i'), h('i')),
    h('div', { class: 'parts back' }, partsOf(sc, 'back')),
    tri,
    h('div', { class: 'scene-floor' + (floor ? ' has' : ''), style: { '--floor': `${S.floorTop}%`, '--horizon': String((st.floor?.horizon ?? 50) / 100) } },
      floor ? h('img', { src: floor, alt: '', draggable: false }) : null),
    h('div', { class: 'parts mid' }, partsOf(sc, 'mid')),
    h('div', { class: 'scene-motes' }));
  // 最前方的零件和前景要蓋在紙偶前面，由戰鬥畫面另外放
  const fore = h('div', { class: 'scene-front' }, h('div', { class: 'parts front' }, partsOf(sc, 'front')), layer('scene-fore', st.fore));
  return {
    el, fore, sidePad: S.sidePad,
    open: () => { tri.classList.remove('closed'); [el, fore].forEach((x) => x.classList.add('entered')); },
    close: () => tri.classList.add('closed'),
  };
}
