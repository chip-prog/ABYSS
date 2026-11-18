// Studio：不用寫程式就能編輯遊戲內容的工作台。
// 所有修改只存在這台電腦的瀏覽器裡（測試環境），匯出後才會交給別人或套用到遊戲。
import { h, fill, applyMood, cardEl, cardBackEl, modal, toast, confirmBox, clone, sleep, loadOfficial, KEY_WORK } from './ui/common.js';
import { kvGet, kvSet, initImages, imgUrl, isLocal, localKey, hasImage, imageSize, imageKeys, getBlob, addImage, delImage, walkRefs, fileToBlob } from './ui/store.js';
import { zipFiles, unzip } from './ui/zip.js';
import { makePuppet, poseTransform } from './ui/puppet.js';
import { makeScene } from './ui/scene.js';
import { sceneFor } from './engine/run.js';
import { indexContent } from './engine/battle.js';
import { uid } from './engine/rng.js';
import * as SC from './engine/schema.js';
import { frameLayout } from './engine/schema.js';
import { effectText, describePowers, keywordsOf, scaleLabel, describeCard } from './engine/describe.js';
import { validate } from './engine/validate.js';
import { runBattle } from './ui/battle-view.js';

let C, idx, official, issues = [];
const ui = { section: 'home', sel: null, f: { q: '', faction: '', type: '', publish: '' }, sandbox: { char: '', enc: '', extra: [], only: false } };
const $nav = document.getElementById('nav'), $main = document.getElementById('main'), $save = document.getElementById('save-state');
let previewFn = null, saveTimer = null;

const SECTIONS = [
  ['home', '總覽', '◈'], ['cards', '卡片', '🂠'], ['characters', '角色', '♛'], ['enemies', '敵人', '☠'], ['encounters', '遭遇', '⚔'], ['scenes', '場景', '⛪'],
  ['relics', '遺物', '✧'], ['statuses', '狀態', '❖'], ['factions', '陣營', '⚑'], ['rules', '規則', '⚙'],
  null, ['sandbox', '試玩沙盒', '▶'], ['check', '檢查', '✓'], ['io', '匯入／匯出', '⇄'],
];
const KIND_SECTION = { scene: 'scenes', faction: 'factions', card: 'cards', character: 'characters', enemy: 'enemies', encounter: 'encounters', relic: 'relics', status: 'statuses', rules: 'rules' };
const KIND_LABEL = { scene: '場景', faction: '陣營', card: '卡片', character: '角色', enemy: '敵人', encounter: '遭遇', relic: '遺物', status: '狀態', rules: '規則' };

// ───────── 儲存 ─────────
function commit(structural = false) {
  idx = indexContent(C);
  issues = validate(C).concat(imageIssues(), textIssues());
  clearTimeout(saveTimer);
  $save.textContent = '儲存中…';
  saveTimer = setTimeout(() => {
    kvSet('content', C).then(() => {
      localStorage.removeItem(KEY_WORK); // 舊版的儲存位置，搬完就清掉
      $save.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    }).catch(() => { $save.textContent = '⚠ 儲存失敗，請先匯出備份'; });
  }, 300);
  if (structural) render(); else { previewFn?.(); drawNav(); }
}
function go(section, sel = null) { ui.section = section; ui.sel = sel; render(); $main.scrollTop = 0; }
function render() {
  const st = $main.scrollTop;
  previewFn = null;
  drawNav();
  fill($main, VIEWS[ui.section]());
  $main.scrollTop = st;
}
function drawNav() {
  const err = issues.filter((i) => i.level === 'error').length, warn = issues.length - err;
  fill($nav, ...SECTIONS.map((s) => {
    if (!s) return h('hr', { class: 'rule' });
    const [id, label, icon] = s;
    const count = { scenes: C.scenes, cards: C.cards, characters: C.characters, enemies: C.enemies, encounters: C.encounters, relics: C.relics, statuses: C.statuses, factions: C.factions }[id]?.length;
    return h('button', { class: 'nav-item' + (ui.section === id ? ' on' : ''), onclick: () => go(id) },
      h('span', { class: 'nav-icon' }, icon), h('span', { class: 'grow' }, label),
      count != null ? h('span', { class: 'nav-count' }, count) : null,
      id === 'check' && err ? h('span', { class: 'nav-count err' }, err) : null,
      id === 'check' && warn ? h('span', { class: 'nav-count warn' }, warn) : null);
  }));
}

// ───────── 表單小零件 ─────────
const field = (label, control, hint) => h('div', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
const inText = (o, k, ph) => h('input', { type: 'text', value: o[k] ?? '', placeholder: ph, oninput: (e) => { o[k] = e.target.value; commit(); } });
const inArea = (o, k, ph) => h('textarea', { value: o[k] ?? '', placeholder: ph, oninput: (e) => { o[k] = e.target.value; commit(); } });
const inNum = (o, k, opt = {}) => h('input', {
  type: 'number', value: o[k] ?? opt.def ?? 0, min: opt.min, max: opt.max,
  oninput: (e) => { o[k] = e.target.value === '' ? (opt.def ?? 0) : Number(e.target.value); commit(opt.structural); opt.after?.(); },
});
const inSel = (o, k, options, opt = {}) => h('select', { onchange: (e) => { o[k] = e.target.value; commit(opt.structural); opt.after?.(); } },
  opt.empty ? h('option', { value: '' }, opt.empty) : null,
  options.map(([v, l]) => h('option', { value: v, selected: o[k] === v }, l)));
const inCheck = (o, k, label, opt = {}) => h('label', { class: 'check' },
  h('input', { type: 'checkbox', checked: !!o[k], onchange: (e) => { if (e.target.checked) o[k] = true; else delete o[k]; opt.before?.(); commit(opt.structural); opt.after?.(); } }), label);
const ents = (arr) => arr.map((x) => [x.id, x.name + (x.publish === 'draft' ? '（草稿）' : '')]);
const dict = (d) => Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? v : v.label]);
const section = (title, ...kids) => h('section', { class: 'box panel' }, title ? h('h3', {}, title) : null, ...kids);

function cardSelect(o, k, opt = {}) {
  return h('select', { onchange: (e) => { o[k] = e.target.value; commit(); opt.after?.(); } },
    h('option', { value: '' }, '（選擇卡片）'),
    C.factions.map((f) => h('optgroup', { label: f.name }, C.cards.filter((c) => c.faction === f.id).map((c) => h('option', { value: c.id, selected: o[k] === c.id }, `${c.name}${c.publish === 'draft' ? '（草稿）' : ''}`)))));
}
function publishToggle(o) {
  const wrap = h('div', { class: 'pub' });
  const draw = () => fill(wrap, 
    h('button', { class: 'pub-btn draft' + (o.publish !== 'official' ? ' on' : ''), onclick: () => { o.publish = 'draft'; commit(); draw(); } }, '草稿', h('small', {}, '只在測試環境出現')),
    h('button', { class: 'pub-btn official' + (o.publish === 'official' ? ' on' : ''), onclick: () => { o.publish = 'official'; commit(); draw(); } }, '正式', h('small', {}, '會出現在遊戲裡')));
  draw();
  return wrap;
}
const pubBadge = (o) => h('span', { class: 'badge ' + (o.publish === 'official' ? 'official' : 'draft') }, o.publish === 'official' ? '正式' : '草稿');

function imageField(o, { max = 600, onChange, key = false, trim = false } = {}) {
  const wrap = h('div', { class: 'row' });
  const draw = () => fill(wrap,
    o.image ? h('img', { src: imgUrl(o.image), class: 'thumb', alt: '' }) : h('span', { class: 'faint small' }, '尚未上傳，會使用預設圖樣'),
    h('label', { class: 'btn sm' }, o.image ? '更換圖片' : '上傳圖片', h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const b = await fileToBlob(file, max, { key, trim }); o.image = await addImage(b); if (b.keyed) toast('已自動去除綠色背景'); } catch { return toast('這張圖片無法讀取'); }
      commit(); draw(); onChange?.();
    } })),
    o.image ? h('button', { class: 'btn sm ghost', onclick: () => { o.image = ''; delete o.imagePos; commit(); draw(); onChange?.(); } }, '移除') : null);
  draw();
  return wrap;
}
const slider = (label, value, min, max, oninput, unit = '') => {
  const out = h('span', { class: 'slider-val' }, value + unit);
  return h('label', { class: 'slider' }, h('span', {}, label), h('input', { type: 'range', min, max, value, oninput: (e) => { out.textContent = e.target.value + unit; oninput(Number(e.target.value)); } }), out);
};
const inBool = (o, k, label) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o[k] !== false, onchange: (e) => { o[k] = e.target.checked; commit(); } }), label);

// 圖片相關的檢查：遺失或檔案過大
function imageIssues() {
  const out = [];
  const scan = (kind, x) => {
    const refs = []; (function walk(n) { if (!n || typeof n !== 'object') return; for (const [k, v] of Object.entries(n)) { if ((k === 'image' || k === 'img') && typeof v === 'string' && v) refs.push(v); else walk(v); } })(x);
    for (const r of refs) {
      if (!isLocal(r)) continue;
      if (!hasImage(localKey(r))) out.push({ level: 'error', kind, id: x.id, name: x.name, msg: '有一張圖片遺失了，請重新上傳' });
      else if (imageSize(localKey(r)) > 1500000) out.push({ level: 'warn', kind, id: x.id, name: x.name, msg: `有一張圖片檔案偏大（${(imageSize(localKey(r)) / 1e6).toFixed(1)} MB），會拖慢載入` });
    }
  };
  for (const [kind, list] of [['scene', C.scenes], ['status', C.statuses], ['faction', C.factions], ['card', C.cards], ['character', C.characters], ['enemy', C.enemies], ['relic', C.relics]]) for (const x of list || []) scan(kind, x);
  scan('rules', { id: 'rules', name: '共用卡背', ...C.meta });
  return out;
}

// 卡面文字是否超出版面：說明最多四行、風味文字最多兩行。實際排版一次來量，結果依文字快取。
const fitCache = new Map();
let measurer;
function textIssues() {
  const out = [];
  if (!document.fonts || !document.body) return out;
  measurer ||= document.body.appendChild(h('div', { style: { position: 'fixed', left: '-9999px', top: '0', visibility: 'hidden' } }));
  for (const c of C.cards) {
    const key = describeCard(idx, c) + '\u0000' + (c.flavor || '');
    let r = fitCache.get(key);
    if (!r) {
      const el = cardEl(idx, c, { width: 170, tips: false });
      measurer.append(el);
      const over = (x) => x && x.scrollHeight > x.clientHeight + 1;
      r = { desc: over(el.querySelector('.card-desc')), flavor: over(el.querySelector('.card-flavor')) };
      el.remove();
      fitCache.set(key, r);
    }
    if (r.desc) out.push({ level: 'warn', kind: 'card', id: c.id, name: c.name, msg: '卡片說明超過四行，卡面會被截斷。請精簡效果，或在「說明文字」手寫較短的版本' });
    if (r.flavor) out.push({ level: 'warn', kind: 'card', id: c.id, name: c.name, msg: '風味文字超過兩行，卡面會被截斷' });
  }
  return out;
}

// 上傳一張圖到 o[key]（卡框、卡背用；保留透明背景）
function imgUpload(o, key, { max = 1210, label = '上傳圖片', onChange, green = false, trim = false } = {}) {
  const wrap = h('div', { class: 'row' });
  const draw = () => fill(wrap,
    o[key] ? h('img', { src: imgUrl(o[key]), class: 'thumb tall', alt: '' }) : h('span', { class: 'faint small' }, '尚未上傳'),
    h('label', { class: 'btn sm' }, o[key] ? '更換' : label, h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const b = await fileToBlob(file, max, { key: green, trim }); o[key] = await addImage(b); if (b.keyed) toast('已自動去除綠色背景'); } catch { return toast('這張圖片無法讀取'); }
      commit(); draw(); onChange?.();
    } })),
    o[key] ? h('button', { class: 'btn sm ghost', onclick: () => { delete o[key]; commit(); draw(); onChange?.(); } }, '移除') : null);
  draw();
  return wrap;
}

// ───────── 卡框與卡背 ─────────
function frameEditor(f) {
  f.frame ||= {}; f.back ||= {};
  const preview = h('div', { class: 'frame-preview' });
  const sample = () => {
    const mine = C.cards.filter((c) => c.faction === f.id);
    const pick = (fn) => mine.find(fn) || mine[0];
    const longest = [...mine].sort((a, b) => [...b.name].length - [...a.name].length)[0];
    return [pick((c) => c.sacrifice) || pick((c) => c.flavor), longest].filter(Boolean)
      .map((c, i) => ({ ...c, faction: f.id, rarity: ['rare', 'epic'][i] }));
  };
  const drawPreview = () => fill(preview,
    ...(f.frame.img ? sample().map((c) => cardEl(idx, c, { width: 250, tips: false })) : [h('div', { class: 'empty small' }, '上傳卡框後，這裡會顯示套用後的卡片。')]),
    h('div', { class: 'frame-back' }, cardBackEl(idx, f.id, 160), h('div', { class: 'faint small' }, f.back.img ? '卡背' : '卡背（未上傳，使用共用卡背）')));
  const prev = previewFn; previewFn = () => { prev?.(); drawPreview(); };
  const tune = h('div', {});
  const drawTune = () => {
    const L = frameLayout(f);
    const set = (part, k, v) => { ((f.frame.layout ||= {})[part] ||= {})[k] = v; commit(); };
    fill(tune, Object.entries(SC.FRAME_PARTS).map(([part, d]) => h('div', { class: 'tune-row' },
      h('b', {}, d.label),
      d.kind === 'box'
        ? [part === 'name' ? slider('中線', L[part].center ?? 50, 0, 100, (v) => set(part, 'center', v), '%') : null,
           slider(part === 'name' ? '最左' : '左', L[part].left, 0, 100, (v) => set(part, 'left', v), '%'), slider(part === 'name' ? '最右' : '右', L[part].right, 0, 100, (v) => set(part, 'right', v), '%'),
           slider('上', L[part].top, 0, 100, (v) => set(part, 'top', v), '%'), slider('下', L[part].bottom, 0, 100, (v) => set(part, 'bottom', v), '%')]
        : [slider('左右', L[part].x, 0, 100, (v) => set(part, 'x', v), '%'), slider('上下', L[part].y, 0, 100, (v) => set(part, 'y', v), '%'), slider('大小', L[part].size, 2, 30, (v) => set(part, 'size', v), '%')])),
      h('button', { class: 'btn sm ghost', onclick: () => { delete f.frame.layout; commit(); drawTune(); } }, '全部恢復預設位置'));
  };
  drawTune(); drawPreview();
  return section('卡框與卡背',
    h('p', { class: 'dim small' }, '卡框：去背 PNG，比例 1：1.5（例如 800 × 1200），卡圖窗挖空透明，不要畫任何文字。沒有上傳卡框的陣營，會使用預設的簡易卡面。'),
    h('div', { class: 'frame-wrap' },
      h('div', { class: 'frame-side' },
        field('卡框', imgUpload(f.frame, 'img', { label: '上傳卡框', onChange: drawPreview, green: true })),
        field('卡背', imgUpload(f.back, 'img', { label: '上傳卡背', onChange: drawPreview }), '沒上傳時使用「規則」頁的共用卡背'),
        h('div', { class: 'sub-title' }, '位置微調'),
        h('p', { class: 'faint small' }, '卡框和預設位置有落差時再調整。數值是卡片寬度、高度的百分比。名稱會對齊「中線」，太長時才往內讓開，不會超出「最左／最右」。'),
        tune),
      preview));
}

// ───────── 場景編輯器 ─────────
function scenePreview(sc) {
  const box = h('div', { class: 'scene-preview' });
  let view;
  const draw = (animate = true) => {
    view = makeScene(idx, sc);
    box.classList.toggle('instant', !animate);
    const pad = view.sidePad;
    // 暫代紙偶：讓你判斷零件和三聯畫跟角色的前後關係
    const dummy = (side) => h('div', { class: 'pv-dummy ' + side, style: { [side]: `calc(${pad}% + 4%)`, top: `calc(${({ ...SC.STAGE_LAYOUT, ...(C.rules.stage || {}) }).floorTop}% - 30%)` } });
    fill(box, view.el, h('div', { class: 'pv-actors' }, dummy('left'), dummy('right')), view.fore);
    requestAnimationFrame(() => view.open());
  };
  draw();
  return { box, draw, open: () => view.open(), close: () => view.close() };
}
function sceneEditor(sc) {
  for (const k of ['center', 'left', 'right', 'leftBack', 'rightBack']) sc[k] ||= {};
  sc.parts ||= [];
  const pv = scenePreview(sc);
  let redrawTimer;
  const redraw = () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => pv.draw(false), 60); };
  const prev = previewFn; previewFn = () => { prev?.(); redraw(); };

  // 三聯畫版面
  const T = () => ({ ...SC.TRI_LAYOUT, ...(sc.layout || {}) });
  const setT = (k, v) => { (sc.layout ||= {})[k] = v; commit(); };
  const triTune = h('div', {});
  const drawTri = () => fill(triTune, h('div', { class: 'pose-sliders' },
    slider('左右', T().x, 0, 100, (v) => setT('x', v), '%'), slider('上下', T().y, -40, 60, (v) => setT('y', v), '%'),
    slider('寬度', T().width, 30, 140, (v) => setT('width', v), '%'), slider('高度上限', T().height, 20, 120, (v) => setT('height', v), '%'),
    slider('兩翼角度', T().wing, 0, 80, (v) => setT('wing', v), '°'), slider('亮度', T().bright, 20, 120, (v) => setT('bright', v), '%')),
    h('button', { class: 'btn sm ghost', onclick: () => { delete sc.layout; commit(); drawTri(); } }, '恢復預設'));
  drawTri();

  // 畫板：上傳＋裁切
  const panel = (k, label, hint) => {
    const box = h('div', { class: 'panel-slot' });
    const draw = () => {
      const o = sc[k];
      const P = { x: 50, y: 50, zoom: 1, ...(o.pos || {}) };
      const setP = (kk, v) => { (o.pos ||= { x: 50, y: 50, zoom: 1 })[kk] = v; commit(); };
      fill(box, h('b', {}, label), hint ? h('div', { class: 'faint small' }, hint) : null,
        imgUpload(o, 'img', { max: 1100, onChange: () => { draw(); redraw(); } }),
        o.img ? h('div', { class: 'pose-sliders' },
          slider('左右', P.x, 0, 100, (v) => setP('x', v), '%'), slider('上下', P.y, 0, 100, (v) => setP('y', v), '%'),
          slider('放大', Math.round(P.zoom * 100), 100, 250, (v) => setP('zoom', v / 100), '%')) : null);
    };
    draw();
    return box;
  };

  // 零件
  const partsBox = h('div', { class: 'parts-list' });
  const drawParts = () => fill(partsBox,
    sc.parts.length ? null : h('p', { class: 'faint small' }, '還沒有零件。零件是一片片去背的剪紙（柱子、眼睛、翅膀、燭台…），可以擺在三聯畫後面、前面，或紙偶前面，各自晃動。'),
    sc.parts.map((p, i) => {
      const set = (k, v) => { p[k] = v; commit(); };
      return h('div', { class: 'part-row' },
        h('div', { class: 'pose-thumb' }, p.img ? h('img', { src: imgUrl(p.img), alt: '' }) : h('span', {}, '無圖')),
        h('div', { class: 'grow' },
          h('div', { class: 'row' },
            h('b', {}, `零件 ${i + 1}`),
            imgUpload(p, 'img', { max: 1024, green: true, trim: true, label: '上傳', onChange: () => { drawParts(); redraw(); } }),
            inSel(p, 'layer', dict(SC.PART_LAYERS)),
            inSel(p, 'motion', dict(SC.PART_MOTIONS)),
            h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: !!p.flip, onchange: (e) => set('flip', e.target.checked) }), '左右翻轉'),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn sm ghost', title: '複製一份，方便排成一列', onclick: () => { sc.parts.splice(i + 1, 0, { ...clone(p), x: Math.min(100, p.x + 6) }); commit(); drawParts(); } }, '複製'),
            h('button', { class: 'btn sm ghost', onclick: () => { sc.parts.splice(i, 1); commit(); drawParts(); } }, '刪除')),
          h('div', { class: 'pose-sliders' },
            slider('左右', p.x, -10, 110, (v) => set('x', v), '%'), slider('上下', p.y, -10, 110, (v) => set('y', v), '%'),
            slider('大小', p.size, 2, 80, (v) => set('size', v), '%'), slider('角度', p.rot || 0, -180, 180, (v) => set('rot', v), '°'),
            slider('不透明', p.opacity ?? 100, 10, 100, (v) => set('opacity', v), '%'),
            slider('幅度', p.amp ?? 6, 0, 30, (v) => set('amp', v)), slider('速度', p.speed ?? 3, 1, 20, (v) => set('speed', v), '秒'))));
    }),
    h('button', { class: 'btn sm', onclick: () => { sc.parts.push(SC.newPart()); commit(); drawParts(); } }, '＋ 新增零件'));
  drawParts();

  return h('div', {},
    section('基本資料', field('名稱', inText(sc, 'name'))),
    h('div', { class: 'scene-sticky' }, section('預覽', pv.box, h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn sm', onclick: () => { pv.draw(); } }, '重播開場'), h('button', { class: 'btn sm', onclick: () => pv.close() }, '闔上兩翼'),
      h('span', { class: 'faint small' }, '兩個灰色剪影代表角色站的位置。教堂底紋、地板、前景、三聯畫外框和角色站位在「規則」頁調整，所有場景共用。')))),
    section('三聯畫版面', h('p', { class: 'faint small' }, '位置、寬高是戰鬥畫面的百分比。'), triTune),
    section('三聯畫畫面',
      h('p', { class: 'dim small' }, '中央板比例約 8：7，兩翼各是中央板一半寬（約 4：7）。比例不合也沒關係，用滑桿調整裁切位置。'),
      h('div', { class: 'grid2' },
        panel('center', '中央板'),
        panel('left', '左翼（正面）', '位於主角身後'),
        panel('right', '右翼（正面）', '位於敵人身後'),
        panel('leftBack', '左翼（背面）', '兩翼闔上時看到的一面'),
        panel('rightBack', '右翼（背面）'))),
    section('場景零件', h('p', { class: 'faint small' }, '綠色背景的圖片上傳時會自動去背並裁掉多餘空白。'), partsBox));
}

// ───────── 紙偶姿勢編輯器 ─────────
const POSE_MOVE = { attack: 'lunge', hit: 'recoil', hitBlocked: 'nudge', block: 'nudge', skill: 'nudge', blessing: 'raise', sacrifice: 'raise', charge: 'raise', down: 'fall' };
function posesEditor(ent, defs, side, color) {
  ent.poses ||= {};
  const opt = { ghost: false };
  const ghost = h('img', { class: 'pose-ghost', alt: '' });
  const stageBox = h('div', { class: 'pose-stage' });
  let puppet;
  const syncGhost = () => {
    const p = ent.poses.idle;
    ghost.hidden = !(opt.ghost && p?.img);
    if (!ghost.hidden) { ghost.src = imgUrl(p.img); ghost.style.transform = poseTransform(p); }
  };
  const build = (pose = 'idle') => {
    puppet = makePuppet({ name: ent.name, poses: ent.poses, defs, side, color, paperEdge: C.rules.fx?.paperEdge !== false });
    fill(stageBox, h('div', { class: 'pose-box' }, ghost, puppet.el), h('div', { class: 'pose-ground' }, '地面'));
    puppet.setPose(pose, true); syncGhost();
  };
  const preview = async (name) => {
    build(); await sleep(30);
    await puppet.setPose(name);
    await puppet.play(POSE_MOVE[name]);
    if (name !== 'idle') { await sleep(name === 'down' ? 500 : 350); build(); }
  };
  const slots = h('div', { class: 'pose-slots' });
  const drawSlots = () => fill(slots, Object.entries(defs).map(([name, d]) => {
    const p = ent.poses[name];
    const has = !!p?.img;
    return h('div', { class: 'pose-slot' + (has ? ' has' : '') },
      h('div', { class: 'pose-thumb' }, has ? h('img', { src: imgUrl(p.img), alt: '' }) : h('span', {}, '無圖')),
      h('div', { class: 'grow' },
        h('div', {}, h('b', {}, d.label), h('span', { class: 'faint small' }, `　${d.when}`)),
        h('div', { class: 'row', style: { marginTop: '4px' } },
          h('label', { class: 'btn sm' }, has ? '更換' : '上傳', h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
            const file = e.target.files[0]; if (!file) return;
            try { const b = await fileToBlob(file, 900, { key: true }); if (b.keyed) toast('已自動去除綠色背景'); const img = await addImage(b); ent.poses[name] = { scale: 1, x: 0, y: 0, ...(ent.poses[name] || {}), img }; } catch { return toast('這張圖片無法讀取'); }
            commit(); drawSlots(); build(name);
          } })),
          has ? h('button', { class: 'btn sm ghost', onclick: () => { delete ent.poses[name]; commit(); drawSlots(); build(); } }, '移除') : null,
          h('button', { class: 'btn sm ghost', onclick: () => preview(name) }, '▶ 預覽')),
        has ? h('div', { class: 'pose-sliders' },
          slider('大小', Math.round((p.scale || 1) * 100), 30, 250, (v) => { p.scale = v / 100; commit(); build(name); }, '%'),
          slider('左右', p.x || 0, -200, 200, (v) => { p.x = v; commit(); build(name); }),
          slider('上下', p.y || 0, -200, 200, (v) => { p.y = v; commit(); build(name); })) : null));
  }));
  drawSlots(); build();
  return section('紙偶姿勢',
    h('p', { class: 'dim small' }, `上傳去背的圖片（${side === 'left' ? '面向右' : '面向左'}）。缺少的姿勢會自動改用待機圖；全部沒有時，會顯示暫代的紙牌。`),
    h('div', { class: 'pose-wrap' },
      h('div', { class: 'pose-preview' }, stageBox,
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', onchange: (e) => { opt.ghost = e.target.checked; syncGhost(); } }), '疊上半透明的待機圖來比對位置')),
      slots));
}

// ───────── 效果積木編輯器 ─────────
function fxControl(e, f, side, after) {
  switch (f.type) {
    case 'number': return inNum(e, f.key, { def: f.def ?? 0, min: f.min, after });
    case 'target': return inSel(e, f.key, dict(side === 'enemy' ? SC.TARGETS_ENEMY_SIDE : SC.TARGETS), { after });
    case 'status': return inSel(e, f.key, ents(C.statuses), { empty: '（選擇狀態）', after });
    case 'card': return cardSelect(e, f.key, { after });
    case 'zone': return inSel(e, f.key, dict(SC.ZONES), { after });
    case 'pile': return inSel(e, f.key, dict(SC.PILES), { after });
    case 'bool': return inCheck(e, f.key, f.label, { after });
    case 'scale': {
      const wrap = h('span', { class: 'fx-scale' });
      const opts = [...dict(SC.SCALE_SOURCES), ...C.statuses.map((s) => ['status:' + s.id, scaleLabel(idx, 'status:' + s.id)]), ...(side === 'enemy' ? [] : C.statuses.map((s) => ['targetStatus:' + s.id, scaleLabel(idx, 'targetStatus:' + s.id)]))];
      const draw = () => fill(wrap, 
        h('select', { onchange: (ev) => { if (ev.target.value) e.scale = { by: ev.target.value, per: e.scale?.per ?? 1 }; else delete e.scale; commit(); after?.(); draw(); } },
          h('option', { value: '' }, '無'), opts.map(([v, l]) => h('option', { value: v, selected: e.scale?.by === v }, '每 1 點' + l))),
        e.scale ? h('span', {}, ' 額外 +') : null, e.scale ? inNum(e.scale, 'per', { def: 1, after }) : null);
      draw();
      return wrap;
    }
  }
}

function effectsEditor(list, side = 'player', emptyNote = '還沒有效果') {
  const wrap = h('div', { class: 'fx-list' });
  const groups = {};
  for (const [k, v] of Object.entries(SC.EFFECTS)) (groups[v.group] ||= []).push([k, v.label]);
  const enemyTypes = ['damage', 'block', 'applyStatus', 'heal', 'addCard'];
  const typeOptions = (cur) => Object.entries(groups).map(([g, items]) => {
    const its = items.filter(([k]) => side !== 'enemy' || enemyTypes.includes(k));
    return its.length ? h('optgroup', { label: g }, its.map(([k, l]) => h('option', { value: k, selected: cur === k }, l))) : null;
  });
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; commit(); draw(); };
  const draw = () => {
    fill(wrap, 
      ...(list.length ? [] : [h('div', { class: 'faint small' }, emptyNote)]),
      ...list.map((e, i) => {
        const def = SC.EFFECTS[e.type];
        const txt = h('div', { class: 'fx-text' });
        const sync = () => { txt.textContent = '→ ' + effectText(idx, e, side) + '。'; };
        const cond = h('div', { class: 'fx-cond' });
        const drawCond = () => {
          const cdef = e.if?.type ? SC.CONDITIONS[e.if.type] : null;
          fill(cond, h('span', { class: 'faint' }, '條件'),
            h('select', { onchange: (ev) => {
              const t = ev.target.value;
              if (!t) delete e.if; else { e.if = { type: t }; for (const f of SC.CONDITIONS[t].fields) if (f.def !== undefined) e.if[f.key] = f.def; }
              commit(); drawCond(); sync();
            } }, h('option', { value: '' }, '無條件，一定發動'), dict(SC.CONDITIONS).filter(([k]) => side !== 'enemy' || ['selfHasStatus', 'hasBlock', 'hpBelowPct'].includes(k)).map(([k, l]) => h('option', { value: k, selected: e.if?.type === k }, '若' + l))),
            ...(cdef ? cdef.fields.map((f) => fxControl(e.if, f, side, sync)) : []));
        };
        drawCond(); sync();
        return h('div', { class: 'fx' },
          h('div', { class: 'fx-head' },
            h('select', { class: 'fx-type', onchange: (ev) => { const keep = e.if; for (const k of Object.keys(e)) delete e[k]; Object.assign(e, SC.newEffect(ev.target.value)); if (side === 'enemy' && 'target' in e && e.type !== 'damage') e.target = e.type === 'applyStatus' ? 'enemy' : e.target; if (keep) e.if = keep; commit(); draw(); } }, typeOptions(e.type)),
            ...(def ? def.fields.map((f) => f.type === 'bool' ? fxControl(e, f, side, sync) : h('label', { class: 'fx-f' }, h('span', {}, f.label), fxControl(e, f, side, sync))) : [h('span', { class: 'faint' }, '（無法辨識的效果）')]),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn icon sm ghost', title: '上移', onclick: () => move(i, -1) }, '↑'),
            h('button', { class: 'btn icon sm ghost', title: '下移', onclick: () => move(i, 1) }, '↓'),
            h('button', { class: 'btn icon sm ghost', title: '刪除這個效果', onclick: () => { list.splice(i, 1); commit(); draw(); } }, '✕')),
          cond, txt);
      }),
      h('select', { class: 'fx-add', onchange: (ev) => { if (!ev.target.value) return; list.push(SC.newEffect(ev.target.value)); commit(); draw(); } },
        h('option', { value: '' }, '＋ 加入效果…'), typeOptions(null)));
  };
  draw();
  return wrap;
}

function powersEditor(list, note) {
  const wrap = h('div', { class: 'pw-list' });
  const draw = () => fill(wrap, 
    note ? h('div', { class: 'faint small' }, note) : null,
    ...list.map((p, i) => h('div', { class: 'pw' },
      h('div', { class: 'row' }, h('span', { class: 'dim' }, '時機'), inSel(p, 'trigger', dict(SC.TRIGGERS)), h('span', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', onclick: () => { list.splice(i, 1); commit(); draw(); } }, '刪除這組')),
      effectsEditor(p.effects ||= []))),
    h('button', { class: 'btn sm', onclick: () => { list.push({ trigger: 'turnStart', effects: [] }); commit(); draw(); } }, '＋ 新增一組持續效果'));
  draw();
  return wrap;
}

function triggersEditor(trig) {
  const wrap = h('div', { class: 'pw-list' });
  const draw = () => fill(wrap, 
    ...Object.keys(trig).map((k) => h('div', { class: 'pw' },
      h('div', { class: 'row' }, h('b', {}, SC.CARD_TRIGGERS[k] || k), h('span', { class: 'grow' }), h('button', { class: 'btn sm ghost', onclick: () => { delete trig[k]; commit(); draw(); } }, '刪除')),
      effectsEditor(trig[k]))),
    h('select', { class: 'fx-add', onchange: (e) => { if (!e.target.value) return; trig[e.target.value] = []; commit(); draw(); } },
      h('option', { value: '' }, '＋ 加入特殊時機…'), dict(SC.CARD_TRIGGERS).filter(([k]) => !(k in trig)).map(([k, l]) => h('option', { value: k }, l))));
  draw();
  return wrap;
}

// ───────── 共用：左清單 + 右編輯 ─────────
function listEditor({ items, title, intro, newItem, row, editor, canDelete = true, kind }) {
  const sel = items.find((x) => x.id === ui.sel) || null;
  const iss = (x) => issues.filter((i) => i.kind === kind && i.id === x.id);
  return h('div', { class: 'split' },
    h('div', { class: 'split-list' },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, title), newItem ? h('button', { class: 'btn primary sm', onclick: () => { const x = newItem(); items.push(x); ui.sel = x.id; commit(true); } }, '＋ 新增') : null),
      intro ? h('p', { class: 'dim small' }, intro) : null,
      items.map((x) => h('button', { class: 'list-item' + (sel === x ? ' on' : ''), onclick: () => { ui.sel = x.id; render(); } },
        h('span', { class: 'grow' }, row ? row(x) : x.name || '（未命名）'),
        iss(x).some((i) => i.level === 'error') ? h('span', { class: 'dot err', title: '有錯誤' }) : iss(x).length ? h('span', { class: 'dot warn', title: '有提醒' }) : null,
        'publish' in x ? pubBadge(x) : null))),
    h('div', { class: 'split-edit' }, sel ? [
      editor(sel),
      issueBox(kind, sel.id),
      h('div', { class: 'row', style: { marginTop: '14px' } },
        h('button', { class: 'btn sm', onclick: () => { const c = clone(sel); c.id = sel.id.split('_')[0] + '_' + uid(); c.name = sel.name + '（複製）'; if ('publish' in c) c.publish = 'draft'; items.push(c); ui.sel = c.id; commit(true); } }, '複製'),
        canDelete ? h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmBox(`確定要刪除「${sel.name}」嗎？\n這個動作無法復原。`, '刪除', true)) { items.splice(items.indexOf(sel), 1); ui.sel = null; commit(true); } } }, '刪除') : null,
        h('span', { class: 'faint small' }, `代號：${sel.id}`)),
    ] : h('div', { class: 'empty' }, '從左邊選一個項目，或按「＋ 新增」。')));
}
function issueBox(kind, id) {
  const box = h('div', {});
  const draw = () => {
    const list = issues.filter((i) => i.kind === kind && i.id === id);
    fill(box, ...list.map((i) => h('div', { class: 'issue ' + i.level }, i.level === 'error' ? '✕ ' : '△ ', i.msg)));
  };
  draw();
  const prev = previewFn; previewFn = () => { prev?.(); draw(); };
  return box;
}

// ───────── 各頁面 ─────────
const VIEWS = {
  home() {
    const drafts = (a) => a.filter((x) => x.publish === 'draft').length;
    const err = issues.filter((i) => i.level === 'error').length;
    const rar = ['starter', 'common', 'rare', 'epic', 'special'];
    return h('div', { class: 'page' },
      h('h1', {}, C.meta?.title || 'ABYSS', h('span', { class: 'dim', style: { fontSize: '15px', marginLeft: '14px', letterSpacing: '.2em' } }, 'STUDIO')),
      h('p', { class: 'dim' }, '這裡是測試環境。你做的修改只存在這台電腦的瀏覽器裡，不會影響正式遊戲；確認沒問題後，到「匯入／匯出」把內容檔交出去。'),
      h('div', { class: 'stat-row' },
        [['卡片', C.cards, 'cards'], ['角色', C.characters, 'characters'], ['敵人', C.enemies, 'enemies'], ['遭遇', C.encounters, 'encounters'], ['遺物', C.relics, 'relics']].map(([l, a, s]) =>
          h('button', { class: 'stat panel', onclick: () => go(s) }, h('div', { class: 'stat-n' }, a.length), h('div', {}, l), h('div', { class: 'small ' + (drafts(a) ? 'gold' : 'faint') }, drafts(a) ? `其中 ${drafts(a)} 個草稿` : '全部為正式')))),
      section('各陣營卡片數',
        h('table', { class: 'tbl' },
          h('tr', {}, h('th', {}, '陣營'), rar.map((r) => h('th', {}, SC.RARITIES[r])), h('th', {}, '合計')),
          C.factions.map((f) => { const cs = C.cards.filter((c) => c.faction === f.id); return h('tr', {}, h('td', {}, h('span', { class: 'swatch', style: { background: f.color } }), f.name), rar.map((r) => h('td', {}, cs.filter((c) => c.rarity === r).length || '·')), h('td', {}, h('b', {}, cs.length))); }))),
      section('內容檢查',
        h('p', { class: issues.length ? '' : 'dim' }, err ? `有 ${err} 個錯誤需要修正` : '沒有錯誤', issues.length - err ? `，另有 ${issues.length - err} 則提醒` : '', '。'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => go('check') }, '查看檢查結果'),
          h('button', { class: 'btn', onclick: () => go('sandbox') }, '開啟試玩沙盒'),
          h('a', { class: 'btn', href: 'game.html?preview=1', target: '_blank' }, '用目前內容完整試玩一輪 ↗'))));
  },

  cards() {
    if (ui.sel) { const c = C.cards.find((x) => x.id === ui.sel); if (c) return cardEditor(c); ui.sel = null; }
    const f = ui.f;
    const grid = h('div', { class: 'card-grid' });
    const count = h('span', { class: 'dim small' });
    const draw = () => {
      const list = C.cards.filter((c) => (!f.q || c.name.includes(f.q)) && (!f.faction || c.faction === f.faction) && (!f.type || c.type === f.type) && (!f.publish || c.publish === f.publish));
      count.textContent = `顯示 ${list.length} / ${C.cards.length} 張`;
      fill(grid, ...list.map((c) => { const el = cardEl(idx, c, { width: 170, flavor: false }); el.onclick = () => go('cards', c.id); return el; }),
        ...(list.length ? [] : [h('div', { class: 'empty' }, '沒有符合條件的卡片。')]));
    };
    const chip = (key, val, label, color) => h('button', { class: 'fchip' + (f[key] === val ? ' on' : ''), style: color ? { '--fc': color } : {}, onclick: () => { f[key] = f[key] === val ? '' : val; render(); } }, label);
    draw();
    return h('div', { class: 'page' },
      h('div', { class: 'row' }, h('h1', { class: 'grow' }, '卡片'),
        h('button', { class: 'btn primary', onclick: () => { const c = SC.blankCard('card_' + uid()); if (f.faction) c.faction = f.faction; C.cards.push(c); commit(); go('cards', c.id); } }, '＋ 新增卡片')),
      h('div', { class: 'filters panel' },
        h('input', { type: 'search', placeholder: '搜尋卡片名稱…', value: f.q, oninput: (e) => { f.q = e.target.value; draw(); } }),
        h('div', { class: 'row' }, h('span', { class: 'faint small' }, '陣營'), C.factions.map((x) => chip('faction', x.id, x.name, x.color))),
        h('div', { class: 'row' }, h('span', { class: 'faint small' }, '類型'), dict(SC.CARD_TYPES).map(([k, l]) => chip('type', k, l))),
        h('div', { class: 'row' }, h('span', { class: 'faint small' }, '狀態'), chip('publish', 'draft', '只看草稿'), chip('publish', 'official', '只看正式'), h('span', { class: 'grow' }), count)),
      grid);
  },

  characters: () => listEditor({
    kind: 'character', items: C.characters, title: '角色', intro: '每位角色綁定一個陣營，卡牌獎勵只會出現該陣營與無名牌。',
    newItem: () => ({ id: 'char_' + uid(), name: '新角色', title: '', faction: C.factions[0].id, hp: 70, relic: '', deck: [], desc: '', image: '', publish: 'draft' }),
    editor(ch) {
      const deckBox = h('div', {});
      const drawDeck = () => {
        const counts = new Map(); for (const id of ch.deck) counts.set(id, (counts.get(id) || 0) + 1);
        const size = C.rules.deckSize || 10;
        const pick = { id: '' };
        fill(deckBox, 
          h('div', { class: ch.deck.length === size ? 'dim' : 'gold' }, `目前 ${ch.deck.length} 張（規則設定為 ${size} 張）`),
          h('div', { class: 'deck-rows' }, [...counts].map(([id, n]) => { const c = idx.cards.get(id); return h('div', { class: 'deck-row' },
            h('span', { class: 'swatch', style: { background: idx.factions.get(c?.faction)?.color || '#555' } }), h('span', { class: 'grow' }, c?.name || `（已刪除：${id}）`),
            h('button', { class: 'btn icon sm ghost', onclick: () => { ch.deck.splice(ch.deck.indexOf(id), 1); commit(); drawDeck(); } }, '−'), h('b', {}, `× ${n}`),
            h('button', { class: 'btn icon sm ghost', onclick: () => { ch.deck.push(id); commit(); drawDeck(); } }, '＋')); })),
          h('div', { class: 'row' }, cardSelect(pick, 'id', { after: () => { if (pick.id) { ch.deck.push(pick.id); commit(); drawDeck(); } } }), h('span', { class: 'faint small' }, '選一張牌加入初始牌組')));
      };
      drawDeck();
      return h('div', {},
        section('基本資料',
          h('div', { class: 'grid2' }, field('名字', inText(ch, 'name')), field('稱號', inText(ch, 'title')), field('陣營', inSel(ch, 'faction', ents(C.factions))), field('初始生命', inNum(ch, 'hp', { min: 1 })),
            field('初始遺物', inSel(ch, 'relic', ents(C.relics), { empty: '（無）' }))),
          field('介紹', inArea(ch, 'desc')), field('肖像（選角畫面用，可留空）', imageField(ch)), field('狀態', publishToggle(ch))),
        posesEditor(ch, SC.HERO_POSES, 'left', idx.factions.get(ch.faction)?.color),
        section('初始牌組', deckBox));
    },
  }),

  enemies: () => listEditor({
    kind: 'enemy', items: C.enemies, title: '敵人', intro: '敵人會依序（或隨機）使出下面的招式。',
    row: (e) => `${e.boss ? '👑 ' : ''}${e.name}`,
    newItem: () => ({ id: 'enemy_' + uid(), name: '新敵人', hp: [20, 24], boss: false, pattern: 'cycle', moves: [{ name: '攻擊', effects: [{ type: 'damage', amount: 6, target: 'enemy', times: 1 }] }], image: '', publish: 'draft' }),
    editor(en) {
      const hp = { lo: en.hp[0], hi: en.hp[1] };
      const setHp = () => { en.hp = [hp.lo, Math.max(hp.lo, hp.hi)]; commit(); };
      const moves = h('div', { class: 'pw-list' });
      const drawMoves = () => fill(moves, 
        ...en.moves.map((m, i) => h('div', { class: 'pw' },
          h('div', { class: 'row' }, h('span', { class: 'dim' }, `招式 ${i + 1}`), inText(m, 'name', '招式名稱'), h('span', { class: 'grow' }),
            h('button', { class: 'btn icon sm ghost', onclick: () => { if (i) { [en.moves[i - 1], en.moves[i]] = [en.moves[i], en.moves[i - 1]]; commit(); drawMoves(); } } }, '↑'),
            h('button', { class: 'btn sm ghost', onclick: () => { en.moves.splice(i, 1); commit(); drawMoves(); } }, '刪除')),
          effectsEditor(m.effects, 'enemy'))),
        h('button', { class: 'btn sm', onclick: () => { en.moves.push({ name: '新招式', effects: [] }); commit(); drawMoves(); } }, '＋ 新增招式'));
      drawMoves();
      return h('div', {},
        section('基本資料',
          h('div', { class: 'grid2' }, field('名稱', inText(en, 'name')),
            field('生命（最低～最高）', h('span', { class: 'row' }, inNum(hp, 'lo', { min: 1, after: setHp }), '～', inNum(hp, 'hi', { min: 1, after: setHp })), '每場戰鬥會在範圍內隨機'),
            field('出招方式', inSel(en, 'pattern', [['cycle', '依序循環'], ['random', '隨機（不連續重複）']])),
            field('類別', inCheck(en, 'boss', '這是頭目（無法被捕捉）'))),
          field('狀態', publishToggle(en))),
        posesEditor(en, SC.ENEMY_POSES, 'right', '#7a3a34'),
        section('招式', moves));
    },
  }),

  encounters: () => listEditor({
    kind: 'encounter', items: C.encounters, title: '遭遇', intro: '一場戰鬥裡會出現哪些敵人。遊戲會依「規則」裡的關卡流程，從對應階段隨機抽一場。',
    row: (e) => `【${SC.ENCOUNTER_POOLS[e.pool] || '？'}】${e.name}`,
    newItem: () => ({ id: 'enc_' + uid(), name: '新遭遇', pool: 'easy', enemies: [], publish: 'draft' }),
    editor(enc) {
      const box = h('div', {});
      const draw = () => { const pick = { id: '' }; fill(box, 
        h('div', { class: 'deck-rows' }, enc.enemies.map((id, i) => h('div', { class: 'deck-row' }, h('span', { class: 'grow' }, idx.enemies.get(id)?.name || `（已刪除：${id}）`),
          h('button', { class: 'btn icon sm ghost', onclick: () => { enc.enemies.splice(i, 1); commit(); draw(); } }, '✕')))),
        inSel(pick, 'id', ents(C.enemies), { empty: '＋ 加入敵人…', after: () => { if (pick.id) { enc.enemies.push(pick.id); commit(); draw(); } } })); };
      draw();
      return h('div', {},
        section('基本資料', h('div', { class: 'grid2' }, field('名稱', inText(enc, 'name')), field('出現階段', inSel(enc, 'pool', dict(SC.ENCOUNTER_POOLS))),
          field('場景（三聯畫）', inSel(enc, 'scene', ents(C.scenes), { empty: '依階段預設' }), '留「依階段預設」就用規則頁設定的場景')), field('狀態', publishToggle(enc))),
        section('敵人（由左到右）', box));
    },
  }),

  scenes: () => listEditor({
    kind: 'scene', items: C.scenes, title: '場景', intro: '戰鬥時教堂後牆上的祭壇三聯畫，以及漂浮在舞台上的剪紙零件。戰鬥開始時兩翼打開、零件一片片貼上來，勝利時兩翼闔上。',
    newItem: () => ({ id: 'scene_' + uid(), name: '新場景' }),
    editor: sceneEditor,
  }),

  relics: () => listEditor({
    kind: 'relic', items: C.relics, title: '遺物', intro: '遺物在整輪冒險中持續生效。目前每位角色有一個初始遺物。',
    newItem: () => ({ id: 'relic_' + uid(), name: '新遺物', flavor: '', powers: [{ trigger: 'battleStart', effects: [] }], image: '', publish: 'draft' }),
    editor(r) {
      const txt = h('div', { class: 'auto-text' });
      const prev = previewFn; previewFn = () => { prev?.(); txt.textContent = describePowers(idx, r.powers) || '（還沒有效果）'; };
      previewFn();
      return h('div', {},
        section('基本資料', h('div', { class: 'grid2' }, field('名稱', inText(r, 'name')), field('風味文字', inText(r, 'flavor'))), field('圖示', imageField(r, { max: 512, key: true, trim: true }), '去背 PNG，正方形，建議 256 × 256'), field('狀態', publishToggle(r))),
        section('效果', powersEditor(r.powers), h('div', { class: 'faint small', style: { marginTop: '10px' } }, '自動產生的說明：'), txt));
    },
  }),

  statuses: () => listEditor({
    kind: 'status', items: C.statuses, title: '狀態', intro: '掛在角色或敵人身上的增益與減益。調整下面的數字就能改變它的作用。',
    row: (s) => `${s.kind === 'buff' ? '▲' : '▼'} ${s.name}`,
    newItem: () => ({ id: 'status_' + uid(), name: '新狀態', kind: 'debuff', faction: 'nameless', desc: '', decay: 'none' }),
    editor(s) {
      const n = (k, label, hint) => field(label, inNum(s, k, { def: 0 }), hint);
      return h('div', {},
        section('基本資料', h('div', { class: 'grid2' }, field('名稱', inText(s, 'name')), field('類別', inSel(s, 'kind', dict(SC.STATUS_KINDS))), field('回合結束時', inSel(s, 'decay', dict(SC.STATUS_DECAY)))),
          field('說明（玩家看到的文字）', inArea(s, 'desc')),
          field('圖示', imageField(s, { max: 256, key: true, trim: true }), '去背 PNG，正方形，建議 128 × 128。有圖示時，戰鬥中只顯示圖示和層數')),
        section('作用（不需要的留 0）',
          s.special === 'delay' ? h('p', { class: 'gold' }, '這是內建的「延遲」：推遲敵人的下一個行動。它的規則由引擎處理，下面的數字不適用。') : null,
          h('div', { class: 'grid2' },
            n('dealAdd', '每層：造成的攻擊傷害 +', '例：狂怒、力量'), n('takeAdd', '每層：受到的攻擊傷害 +', '例：流血'),
            n('dealPct', '造成的攻擊傷害 %', '不隨層數變化。例：虛弱填 -25'), n('takePct', '受到的攻擊傷害 %', '不隨層數變化。填 50 代表多受 50%'),
            n('tickDamage', '每層：回合結束時失去生命', '無視格擋。例：蝕咒填 1'))));
    },
  }),

  factions: () => listEditor({
    kind: 'faction', items: C.factions, title: '陣營', intro: '陣營決定卡片的顏色，以及角色能拿到哪些牌。',
    row: (f) => h('span', {}, h('span', { class: 'swatch', style: { background: f.color } }), f.name),
    newItem: () => ({ id: 'faction_' + uid(), name: '新陣營', color: '#7a6a8a', desc: '' }),
    editor: (f) => h('div', {},
      section('基本資料',
        h('div', { class: 'grid2' }, field('名稱', inText(f, 'name')), field('代表色', h('input', { type: 'color', value: f.color, oninput: (e) => { f.color = e.target.value; commit(); } }), '卡名文字會用這個顏色；建議和卡框的主色一致')),
        field('說明', inArea(f, 'desc')),
        field('徽記', imageField(f, { max: 512, key: true, trim: true }), '去背 PNG，正方形，建議 256 × 256；顯示在選角畫面'),
        f.id === 'nameless' ? h('p', { class: 'gold small' }, '「無名」是通用陣營：所有角色的獎勵都會出現它的牌。請不要刪除。') : null),
      frameEditor(f)),
  }),

  rules() {
    const R = C.rules;
    const stages = h('div', {});
    const drawStages = () => fill(stages, 
      h('div', { class: 'deck-rows' }, R.stages.map((s, i) => h('div', { class: 'deck-row' },
        h('span', { class: 'dim' }, `${i + 1}.`),
        inSel(s, 'type', [['battle', '戰鬥'], ['rest', '篝火（休息或升級）']], { after: () => { if (s.type === 'battle') { s.pool ||= 'easy'; s.count ||= 1; } else { delete s.pool; delete s.count; } drawStages(); } }),
        s.type === 'battle' ? [inSel(s, 'pool', dict(SC.ENCOUNTER_POOLS)), h('span', {}, '連打'), inNum(s, 'count', { min: 1, def: 1 }), h('span', {}, '場')] : null,
        h('span', { class: 'grow' }),
        h('button', { class: 'btn icon sm ghost', onclick: () => { if (i) { [R.stages[i - 1], R.stages[i]] = [R.stages[i], R.stages[i - 1]]; commit(); drawStages(); } } }, '↑'),
        h('button', { class: 'btn icon sm ghost', onclick: () => { R.stages.splice(i, 1); commit(); drawStages(); } }, '✕')))),
      h('button', { class: 'btn sm', onclick: () => { R.stages.push({ type: 'battle', pool: 'easy', count: 1 }); commit(); drawStages(); } }, '＋ 新增階段'));
    drawStages();
    return h('div', { class: 'page narrow' },
      h('h1', {}, '規則'),
      section('遊戲名稱', h('div', { class: 'grid2' }, field('標題', inText(C.meta, 'title')), field('副標題', inText(C.meta, 'subtitle')))),
      section('共用卡背', h('p', { class: 'dim small' }, '沒有上傳自己卡背的陣營會使用這張。比例 1：1.5。'), imgUpload(C.meta.cardBack ||= {}, 'img', { label: '上傳卡背' })),
      section('戰鬥基本規則', h('div', { class: 'grid2' },
        field('每回合能量', inNum(R, 'energy', { min: 0 })), field('每回合抽牌數', inNum(R, 'draw', { min: 0 })),
        field('手牌上限', inNum(R, 'handLimit', { min: 1 })), field('初始牌組張數', inNum(R, 'deckSize', { min: 1 }), '只用來提醒，不會強制'),
        field('每場戰鬥勝利後回復生命', inNum(R, 'healAfterBattle', { min: 0 })), field('篝火休息回復（最大生命的 %）', inNum(R, 'restHealPct', { min: 0 })))),
      section('捕捉：生贄分級',
        h('p', { class: 'dim small' }, '被捕捉的敵人會依「最大生命」變成不同等級的生贄卡。由上往下比對，最後一列是「其餘全部」。'),
        h('div', { class: 'deck-rows' }, R.captureTiers.map((t, i) => h('div', { class: 'deck-row' },
          i < R.captureTiers.length - 1 ? [h('span', {}, '最大生命不高於'), inNum(t, 'maxHp', { min: 1 })] : h('span', {}, '其餘（更高的）'),
          h('span', {}, '→ 變成'), cardSelect(t, 'card'))))),
      section('視覺效果',
        inBool(R.fx ||= {}, 'closeup', '出手特寫：出招時背景壓暗、角色放大、背後放射光'), h('br'),
        inBool(R.fx, 'paperEdge', '紙片白邊：自動替紙偶加上剪紙的白邊與陰影')),
      section('畫面明暗',
        h('p', { class: 'dim small' }, '遊戲整體的明暗。暗一點、四周再壓暗，比較有詭異不安的感覺。Studio 的試玩沙盒也會套用。'),
        (() => { const M = () => ({ ...SC.MOOD, ...(R.mood || {}) }); const set = (k, v) => { (R.mood ||= {})[k] = v; commit(); };
          return h('div', {},
            h('div', { class: 'pose-sliders' },
              slider('整體亮度', M().bright, 30, 110, (v) => set('bright', v), '%'),
              slider('四周暗角', M().vignette, 0, 100, (v) => set('vignette', v), '%'),
              slider('卡片亮度', M().cards, 50, 110, (v) => set('cards', v), '%')),
            h('label', { class: 'check', style: { marginTop: '8px' } }, h('input', { type: 'checkbox', checked: M().flicker !== false, onchange: (e) => set('flicker', e.target.checked) }), '燭光閃爍：暗角隨燭火微微明滅'),
            h('div', { style: { marginTop: '6px' } }, h('button', { class: 'btn sm ghost', onclick: () => { delete R.mood; commit(true); } }, '恢復預設'))); })()),
      section('戰鬥場景',
        h('p', { class: 'dim small' }, '各階段預設使用的三聯畫（遭遇可以另外指定）。'),
        h('div', { class: 'grid2' }, Object.entries(SC.ENCOUNTER_POOLS).map(([pool, label]) => field(label, inSel(R.sceneByPool ||= {}, pool, ents(C.scenes), { empty: '（第一組場景）' })))),
        h('hr', { class: 'rule' }),
        h('p', { class: 'dim small' }, '所有場景共用的版面。'),
        (() => { const L = () => ({ ...SC.STAGE_LAYOUT, ...(R.stage || {}) }); const set = (k, v) => { (R.stage ||= {})[k] = v; commit(); };
          return h('div', { class: 'pose-sliders' },
            slider('角色離畫面邊緣', L().sidePad, 2, 35, (v) => set('sidePad', v), '%'),
            slider('地板高度', L().floorTop, 25, 75, (v) => set('floorTop', v), '%'),
            slider('教堂亮度', L().churchBright, 10, 120, (v) => set('churchBright', v), '%')); })(),
        h('hr', { class: 'rule' }),
        h('p', { class: 'dim small' }, '所有場景共用的固定素材。沒有上傳時會顯示暗色的暫代圖樣。'),
        h('div', { class: 'grid2' },
          field('教堂遠景', imgUpload((C.meta.stage ||= {}).church ||= {}, 'img', { max: 2560 }), '2560 × 1080，左右各多留一些給寬螢幕；整體要暗'),
          field('舞台地板', imgUpload(C.meta.stage.floor ||= {}, 'img', { max: 1920, green: true }), '去背 PNG，1920 × 1080，上半部透明'),
          field('三聯畫外框', imgUpload(C.meta.stage.frame ||= {}, 'img', { max: 1100, green: true }), '去背 PNG，套在中央板外圍，比例同中央板'),
          field('前景', imgUpload(C.meta.stage.fore ||= {}, 'img', { max: 2560, green: true }), '去背 PNG，1920 × 1080；畫面兩側的柱子或帷幕，會蓋在紙偶前面，中間要透空'))),
      section('關卡流程（經典模式・第一章）', stages),
      issueBox('rules', 'rules'));
  },

  sandbox() {
    const S = ui.sandbox;
    if (!idx.characters.has(S.char)) S.char = C.characters[0]?.id || '';
    if (!idx.encounters.has(S.enc)) S.enc = C.encounters[0]?.id || '';
    const stage = h('div', { class: 'sandbox-stage panel' }, h('div', { class: 'empty' }, '設定好後按「開始試玩」。'));
    applyMood(stage, C.rules);
    const extra = h('div', {});
    const drawExtra = () => { const pick = { id: '' }; fill(extra, 
      h('div', { class: 'row' }, S.extra.map((id, i) => h('button', { class: 'fchip on', title: '點一下移除', onclick: () => { S.extra.splice(i, 1); drawExtra(); } }, (idx.cards.get(id)?.name || '？') + ' ✕')),
        cardSelect(pick, 'id', { after: () => { if (pick.id) { S.extra.push(pick.id); drawExtra(); } } }))); };
    drawExtra();
    const start = async () => {
      const ch = idx.characters.get(S.char), enc = idx.encounters.get(S.enc);
      if (!ch || !enc) return toast('請先選擇角色與遭遇');
      const ids = [...(S.only ? [] : ch.deck), ...S.extra].filter((id) => idx.cards.has(id));
      if (!ids.length) return toast('牌組是空的');
      const deck = ids.map((id) => ({ uid: uid(), id }));
      const top = S.only ? [] : deck.slice(-S.extra.length).slice(0, 3).map((c) => c.uid);
      const state = await runBattle(stage, idx, { player: { hp: ch.hp, maxHp: ch.hp, name: ch.name, poses: ch.poses, color: idx.factions.get(ch.faction)?.color, faction: ch.faction }, scene: sceneFor(idx, enc), deck, top, relics: ch.relic ? [ch.relic] : [], enemies: enc.enemies.filter((id) => idx.enemies.has(id)), seed: Date.now() });
      fill(stage, h('div', { class: 'empty' },
        h('h2', {}, state.phase === 'won' ? '勝利' : '落敗'),
        h('p', { class: 'dim' }, `用了 ${state.turn} 回合，剩餘生命 ${state.player.hp}。`, state.captured.length ? `捕獲：${state.captured.join('、')}。` : ''),
        h('button', { class: 'btn primary', onclick: start }, '再試一次')));
    };
    if (S.autostart) { S.autostart = false; setTimeout(start, 0); }
    return h('div', { class: 'page' },
      h('h1', {}, '試玩沙盒'),
      h('p', { class: 'dim' }, '用目前的工作內容（包含草稿）立刻打一場，不用離開 Studio。'),
      h('div', { class: 'filters panel' },
        h('div', { class: 'row' },
          field('角色', inSel(S, 'char', ents(C.characters))), field('遭遇', inSel(S, 'enc', C.encounters.map((e) => [e.id, `【${SC.ENCOUNTER_POOLS[e.pool]}】${e.name}`]))),
          h('span', { class: 'grow' }),
          h('a', { class: 'btn', href: 'game.html?preview=1', target: '_blank' }, '完整試玩一輪 ↗'),
          h('button', { class: 'btn primary', onclick: start }, '▶ 開始試玩')),
        field('額外加入牌組的牌', extra, '前 3 張一定會出現在起手，方便馬上測試'),
        inCheck(S, 'only', '只使用上面額外加入的牌（不含角色的初始牌組）')),
      stage);
  },

  check() {
    const group = (level, title) => { const list = issues.filter((i) => i.level === level); return section(`${title}（${list.length}）`,
      list.length ? list.map((i) => h('button', { class: 'list-item issue-row', onclick: () => go(KIND_SECTION[i.kind] || 'home', i.id) },
        h('span', { class: 'badge ' + (level === 'error' ? 'draft' : 'official'), style: { minWidth: '52px', textAlign: 'center' } }, KIND_LABEL[i.kind] || ''), h('b', {}, i.name || ''), h('span', { class: 'grow dim' }, i.msg), h('span', { class: 'faint' }, '前往 →')))
        : h('p', { class: 'dim' }, '沒有。')); };
    return h('div', { class: 'page narrow' }, h('h1', {}, '檢查'),
      h('p', { class: 'dim' }, '每次修改都會自動重新檢查。「錯誤」會讓遊戲出問題，請務必修正；「提醒」是可能失衡或疏漏的地方，確認過就可以忽略。'),
      group('error', '錯誤'), group('warn', '提醒'));
  },

  io() {
    const d = diff(official, C);
    return h('div', { class: 'page narrow' }, h('h1', {}, '匯入／匯出'),
      section('目前的工作內容 vs 正式遊戲',
        d.total ? h('p', {}, `和正式遊戲相比：新增 ${d.added.length} 項、修改 ${d.changed.length} 項、刪除 ${d.removed.length} 項`, d.other ? '，另有規則或陣營設定的變更' : '', '。') : h('p', { class: 'dim' }, '和正式遊戲完全相同。'),
        d.total ? h('details', {}, h('summary', {}, '查看清單'), h('div', { class: 'small dim', style: { whiteSpace: 'pre-line', marginTop: '6px' } }, [...d.added.map((x) => '＋ ' + x), ...d.changed.map((x) => '～ ' + x), ...d.removed.map((x) => '－ ' + x)].join('\n'))) : null),
      section('匯出',
        h('p', { class: 'dim' }, '把目前的全部內容和你上傳的圖片打包成一個壓縮檔。可以當備份、交給負責審核的人，也用來套用到正式遊戲。'),
        h('button', { class: 'btn primary', onclick: exportZip }, '匯出內容包（.zip）')),
      section('匯入',
        h('p', { class: 'dim' }, '讀入別人交來的內容包。合併時，同代號的項目以匯入的為準，其餘保留。舊版的 .json 檔也可以匯入。'),
        h('label', { class: 'btn' }, '選擇內容包…', h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', class: 'hidden', onchange: (e) => importFile(e.target.files[0]) }))),
      section('套用到正式遊戲',
        h('ol', { class: 'dim' },
          h('li', {}, '在「檢查」確認沒有錯誤，並把要上線的項目切換成「正式」。'),
          h('li', {}, '按上面的「匯出內容包」，把下載的 zip 解壓縮。裡面有 content 和 assets 兩個資料夾。'),
          h('li', {}, '打開 GitHub 上的儲存庫首頁，按 Add file → Upload files，把這兩個資料夾一起拖進去，再按 Commit changes。'),
          h('li', {}, '一兩分鐘後重新整理遊戲，就會使用新內容。標成「草稿」的項目不會出現。'))),
      section('還原',
        h('p', { class: 'dim' }, '放棄這台電腦上所有尚未匯出的修改，回到正式遊戲目前的內容。'),
        h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('確定要放棄所有修改，還原成正式內容嗎？\n建議先匯出一份備份。', '還原', true)) { C = clone(official); commit(true); toast('已還原成正式內容'); } } }, '還原成正式內容')));
  },
};

// ───────── 卡片編輯器 ─────────
function cardEditor(c) {
  c.keywords ||= {}; c.triggers ||= {}; c.powers ||= []; c.effects ||= [];
  const preview = h('div', { class: 'preview' });
  previewFn = () => {
    const kws = keywordsOf(idx, c);
    fill(preview, 
      h('div', { class: 'row', style: { justifyContent: 'center' } }, cardEl(idx, c, { width: 230, tips: false }), c.upgrade ? cardEl(idx, { ...c, ...c.upgrade, name: c.upgrade.name || c.name + '+' }, { width: 230, tips: false, upgraded: true }) : null),
      c.upgrade ? h('div', { class: 'faint small', style: { textAlign: 'center' } }, '左：原版　右：升級版') : null,
      kws.length ? h('div', { class: 'kw-list' }, kws.map((k) => h('div', { class: 'tip' }, h('b', {}, k.label), k.desc))) : null);
  };
  previewFn();
  const playable = !c.keywords.unplayable;
  const upBox = h('div', {});
  const drawUp = () => fill(upBox, 
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.upgrade, onchange: (e) => {
      c.upgrade = e.target.checked ? { cost: c.cost, effects: clone(c.effects), ...(c.powers.length ? { powers: clone(c.powers) } : {}) } : null; commit(); drawUp();
    } }), '這張牌可以在篝火升級'),
    ...(c.upgrade ? [
      h('p', { class: 'dim small' }, '升級版一開始是原版的複製，請直接修改成升級後的數值。'),
      h('div', { class: 'grid2' }, field('升級後的名稱', inText(c.upgrade, 'name', c.name + '+'), '留空會自動加上「+」'), field('升級後的費用', inNum(c.upgrade, 'cost', { min: 0 }))),
      h('div', { class: 'sub-title' }, '升級後的打出效果'), effectsEditor(c.upgrade.effects ||= clone(c.effects)),
      ...(c.type === 'blessing' ? [h('div', { class: 'sub-title' }, '升級後的持續效果'), powersEditor(c.upgrade.powers ||= clone(c.powers))] : []),
    ] : []));
  drawUp();
  const sacBox = h('div', {});
  const drawSac = () => fill(sacBox, 
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.sacrifice, onchange: (e) => { c.sacrifice = e.target.checked ? { alt: [{ type: 'loseHp', amount: 3 }] } : null; commit(); drawSac(); } }), h('b', {}, '獻祭'), '：打出時要獻上手牌中的一張生贄；無法獻祭時，必須支付下面的代價'),
    ...(c.sacrifice ? [h('div', { class: 'sub-title' }, '代價（無法獻祭生贄時支付）'), effectsEditor(c.sacrifice.alt ||= [], 'player', '沒有代價（等於免費）')] : []));
  drawSac();

  const form = h('div', { class: 'edit-form' },
    section('基本資料',
      h('div', { class: 'grid2' },
        field('名稱', inText(c, 'name')),
        field('陣營', inSel(c, 'faction', ents(C.factions))),
        field('類型', inSel(c, 'type', dict(SC.CARD_TYPES), { structural: true }), { blessing: '打出後整場戰鬥持續生效', status: '戰鬥中臨時出現的牌', curse: '會留在牌組裡的負面牌', tribute: '可被獻祭的牌' }[c.type]),
        field('稀有度', inSel(c, 'rarity', dict(SC.RARITIES)), '「初始」與「特殊」不會出現在戰鬥獎勵'),
        playable ? field('費用', inNum(c, 'cost', { min: 0 })) : null),
      field('狀態', publishToggle(c))),
    section('關鍵字',
      h('div', { class: 'row' }, Object.entries(SC.KEYWORDS).map(([k, v]) => h('span', { title: v.desc }, inCheck(c.keywords, k, v.label, { structural: k === 'unplayable', before: () => { if (k === 'unplayable') c.cost = c.keywords.unplayable ? -1 : Math.max(0, c.cost); } })))),
      h('div', { class: 'faint small' }, '消耗：使用後在本場戰鬥中移除。保留：回合結束不會被棄掉。不可打出：只能留在手上或被其他效果處理。'),
      h('hr', { class: 'rule' }), sacBox),
    playable ? section(c.sacrifice ? '恩寵（打出時的效果）' : '打出時的效果', effectsEditor(c.effects, 'player', '還沒有效果，從下面加入。')) : null,
    c.type === 'blessing' ? section('祝福的持續效果', powersEditor(c.powers, '打出後，在指定的時機反覆發動，直到戰鬥結束。')) : null,
    h('details', { class: 'box panel', open: Object.keys(c.triggers).length > 0 }, h('summary', {}, h('h3', { style: { display: 'inline' } }, '進階：特殊時機'), h('span', { class: 'faint small' }, '　這張牌被棄置、被消耗、被獻祭時發動的效果')), triggersEditor(c.triggers)),
    section('文字與圖片',
      field('說明文字', inArea(c, 'text', '留空就會依效果自動產生（建議留空）'), '只有自動產生的文字不夠清楚時才需要手寫。最多四行；某行開頭加「§」會變成置中粗體的標題行；用「」包住卡名、〈〉包住狀態名會自動上色。'),
      field('風味文字', inText(c, 'flavor', '可留空'), '顯示在卡片最下方，最多兩行'),
      field('卡圖', (() => {
        const box = h('div', {});
        const draw = () => fill(box, imageField(c, { max: 600, onChange: draw }),
          c.image ? h('div', { class: 'pose-sliders', style: { marginTop: '8px' } },
            slider('左右', c.imagePos?.x ?? 50, 0, 100, (v) => { (c.imagePos ||= { x: 50, y: 50, zoom: 1 }).x = v; commit(); }, '%'),
            slider('上下', c.imagePos?.y ?? 50, 0, 100, (v) => { (c.imagePos ||= { x: 50, y: 50, zoom: 1 }).y = v; commit(); }, '%'),
            slider('放大', Math.round((c.imagePos?.zoom ?? 1) * 100), 100, 300, (v) => { (c.imagePos ||= { x: 50, y: 50, zoom: 1 }).zoom = v / 100; commit(); }, '%')) : null);
        draw(); return box;
      })())),
    section('升級版', upBox));

  return h('div', { class: 'page' },
    h('div', { class: 'row' },
      h('button', { class: 'btn ghost', onclick: () => go('cards') }, '← 回到卡片列表'), h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => {
        const ch = C.characters.find((x) => x.faction === c.faction) || C.characters[0];
        Object.assign(ui.sandbox, { char: ch?.id, extra: [c.id, c.id, c.id], only: false, autostart: true }); go('sandbox');
      } }, '▶ 試玩這張牌'),
      h('button', { class: 'btn', onclick: () => { const n = clone(c); n.id = 'card_' + uid(); n.name += '（複製）'; n.publish = 'draft'; C.cards.push(n); commit(); go('cards', n.id); } }, '複製'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox(`確定要刪除「${c.name}」嗎？\n這個動作無法復原。`, '刪除', true)) { C.cards.splice(C.cards.indexOf(c), 1); commit(); go('cards'); } } }, '刪除')),
    h('div', { class: 'edit-split' }, form, h('div', { class: 'edit-side' }, preview, issueBox('card', c.id), h('div', { class: 'faint small', style: { textAlign: 'center', marginTop: '8px' } }, `代號：${c.id}`))));
}

// ───────── 匯入匯出 ─────────
const LISTS = ['cards', 'characters', 'enemies', 'encounters', 'relics', 'statuses', 'factions', 'scenes'];
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
function saveFile(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
}
// 匯出：內容檔放在 content/，你上傳的圖片放在 assets/，結構和儲存庫一致
async function exportZip() {
  const out = clone(C), keys = new Set();
  await walkRefs(out, (v) => { if (isLocal(v)) { keys.add(localKey(v)); return 'assets/' + localKey(v); } });
  const files = [{ name: 'content/content.json', data: new TextEncoder().encode(JSON.stringify(out, null, 1)) }];
  for (const k of keys) { const b = await getBlob(k); if (b) files.push({ name: 'assets/' + k, data: new Uint8Array(await b.arrayBuffer()) }); }
  const name = `abyss-pack-${stamp()}.zip`;
  saveFile(zipFiles(files), name);
  toast(`已匯出 ${name}（${files.length - 1} 張圖片）`);
}
// 舊格式（圖片直接寫在內容裡）→ 轉成獨立圖片
async function convertDataUrls(content) {
  await walkRefs(content, async (v) => { if (v.startsWith('data:')) return addImage(await (await fetch(v)).blob()); });
}
function diff(a, b) {
  const out = { added: [], changed: [], removed: [], other: false };
  for (const k of LISTS) {
    const A = new Map((a[k] || []).map((x) => [x.id, x])), B = new Map((b[k] || []).map((x) => [x.id, x]));
    for (const [id, x] of B) { if (!A.has(id)) out.added.push(x.name); else if (JSON.stringify(A.get(id)) !== JSON.stringify(x)) out.changed.push(x.name); }
    for (const [id, x] of A) if (!B.has(id)) out.removed.push(x.name);
  }
  out.other = JSON.stringify([a.rules, a.meta]) !== JSON.stringify([b.rules, b.meta]);
  out.total = out.added.length + out.changed.length + out.removed.length + (out.other ? 1 : 0);
  return out;
}
async function importFile(file) {
  if (!file) return;
  let data;
  try {
    if (/\.zip$/i.test(file.name)) {
      const files = await unzip(await file.arrayBuffer());
      const main = [...files.keys()].find((n) => n.endsWith('content.json'));
      if (!main) throw 0;
      data = JSON.parse(new TextDecoder().decode(files.get(main)));
      const prefix = main.slice(0, main.length - 'content/content.json'.length);
      // 內容包裡附的圖片存進這台電腦的 Studio
      await walkRefs(data, async (v) => {
        if (!v.startsWith('assets/')) return;
        const bytes = files.get(prefix + v) || files.get(v);
        if (!bytes) return;
        const key = v.slice(7), ext = key.split('.').pop();
        if (!hasImage(key)) await addImage(new Blob([bytes], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }), key);
        return 'local:' + key;
      });
    } else data = JSON.parse(await file.text());
    if (!Array.isArray(data.cards) || !data.rules) throw 0;
    await convertDataUrls(data);
  } catch { return toast('這不是有效的內容包'); }
  const d = diff(C, data);
  const opt = { draft: true };
  const m = modal('匯入內容', h('div', {},
    h('p', {}, `「${file.name}」和你目前的內容相比：`),
    h('p', {}, `新增 ${d.added.length} 項、內容不同 ${d.changed.length} 項`, d.removed.length ? `、對方沒有 ${d.removed.length} 項` : '', '。'),
    d.added.length + d.changed.length ? h('div', { class: 'small dim', style: { whiteSpace: 'pre-line', maxHeight: '180px', overflow: 'auto' } }, [...d.added.map((x) => '＋ ' + x), ...d.changed.map((x) => '～ ' + x)].join('\n')) : null,
    h('hr', { class: 'rule' }),
    inCheck(opt, 'draft', '把新增與變更的項目標成「草稿」，等我審核後再轉正式'),
    h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '14px' } },
      h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'),
      h('button', { class: 'btn', onclick: async () => { if (await confirmBox('整份取代會丟掉你目前的所有內容。確定嗎？', '整份取代', true)) { C = data; m.close(); commit(true); toast('已整份取代'); } } }, '整份取代'),
      h('button', { class: 'btn primary', onclick: () => {
        for (const k of LISTS) {
          const mine = new Map((C[k] ||= []).map((x) => [x.id, x]));
          for (const x of data[k] || []) {
            const old = mine.get(x.id);
            if (old && JSON.stringify(old) === JSON.stringify(x)) continue;
            if (opt.draft && 'publish' in x) x.publish = 'draft';
            if (old) C[k][C[k].indexOf(old)] = x; else C[k].push(x);
          }
        }
        m.close(); commit(true); toast('已合併匯入');
      } }, '合併匯入'))));
}

// ───────── 啟動 ─────────
(async () => {
  try {
    official = await loadOfficial();
    await initImages();
    C = await kvGet('content');
    if (!C) { const old = localStorage.getItem(KEY_WORK); if (old) C = JSON.parse(old); } // 從舊版搬過來
    const fresh = !C;
    C ||= clone(official);
    // 正式內容新增的卡框、卡背：工作內容裡還沒有的就補上（不覆蓋自己上傳的）
    const offFac = new Map((official.factions || []).map((x) => [x.id, x]));
    for (const f of C.factions || []) {
      const o = offFac.get(f.id); if (!o) continue;
      for (const k of ['frame', 'back']) if (o[k]?.img && !f[k]?.img) f[k] = clone(o[k]);
    }
    if (official.meta?.cardBack?.img && !C.meta?.cardBack?.img) (C.meta ||= {}).cardBack = clone(official.meta.cardBack);
    // 正式內容的場景：工作內容沒有的整組補上；已有的只補上空著的畫板（不覆蓋自己上傳的）
    C.scenes ||= [];
    for (const o of official.scenes || []) {
      const mine = C.scenes.find((x) => x.id === o.id);
      if (!mine) { C.scenes.push(clone(o)); continue; }
      for (const k of ['center', 'left', 'right', 'leftBack', 'rightBack']) if (o[k]?.img && !mine[k]?.img) mine[k] = clone(o[k]);
    }
    if (official.rules?.sceneByPool) { C.rules.sceneByPool ||= {}; for (const [k, v] of Object.entries(official.rules.sceneByPool)) if (!C.rules.sceneByPool[k] || !C.scenes.some((x) => x.id === C.rules.sceneByPool[k])) C.rules.sceneByPool[k] = v; }
    C.meta ||= {}; for (const k of LISTS) C[k] ||= [];
    await convertDataUrls(C);
    // 已經放進儲存庫的圖片，改用儲存庫裡的檔案
    const off = JSON.stringify(official);
    await walkRefs(C, (v) => (isLocal(v) && off.includes(`"assets/${localKey(v)}"`) ? 'assets/' + localKey(v) : undefined));
    // 清掉已經沒有任何內容在用的圖片
    if (!fresh) { const used = new Set(); await walkRefs(C, (v) => { if (isLocal(v)) used.add(localKey(v)); }); for (const k of imageKeys()) if (!used.has(k)) await delImage(k); }
    commit(true);
    document.fonts?.ready.then(() => { fitCache.clear(); commit(true); });
  } catch (e) {
    fill($main, h('div', { class: 'empty' }, '載入失敗：' + (e.message || e)));
  }
})();
