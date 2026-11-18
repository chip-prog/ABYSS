// 戰鬥場景：教堂遠景 → 祭壇三聯畫（兩翼可開闔）→ 舞台前景 → 光效。
// 教堂、舞台、三聯畫外框是固定素材（規則頁），三聯畫的畫面依場景更換（場景頁）。
// 沒有素材的層會用暗色的暫代圖樣。
import { h } from './common.js';
import { imgUrl } from './store.js';

const url = (o) => imgUrl(o?.img);
const layer = (cls, src) => h('div', { class: cls + (src ? ' has' : '') }, src ? h('img', { src, alt: '', draggable: false }) : null);

export function makeScene(idx, scene) {
  const st = idx.raw.meta?.stage || {};
  const sc = scene || {};
  const wing = (side) => h('div', { class: `tri-wing ${side}` },
    layer('tri-face front', url(sc[side])),
    layer('tri-face back', url(sc[side + 'Back'])));
  const tri = h('div', { class: 'tri closed' },
    layer('tri-center', url(sc.center)),
    st.frame?.img ? h('img', { class: 'tri-frame', src: url(st.frame), alt: '', draggable: false }) : h('div', { class: 'tri-frame ph' }),
    wing('left'), wing('right'));
  const el = h('div', { class: 'scene' },
    layer('scene-church', url(st.church)),
    h('div', { class: 'scene-light' }, h('i'), h('i'), h('i')),
    tri,
    layer('scene-floor', url(st.floor)),
    h('div', { class: 'scene-motes' }));
  // 前景層要蓋在紙偶前面，由戰鬥畫面另外放
  const fore = layer('scene-fore', url(st.fore));
  return {
    el, fore,
    open: () => tri.classList.remove('closed'),
    close: () => tri.classList.add('closed'),
  };
}
