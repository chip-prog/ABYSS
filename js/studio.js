// Studio：不用寫程式就能編輯遊戲內容的工作台。
// 所有修改只存在這台電腦的瀏覽器裡（測試環境），匯出後才會交給別人或套用到遊戲。
import { h, fill, cardEl, modal, toast, confirmBox, clone, loadOfficial, loadWorking, KEY_WORK } from './ui/common.js';
import { indexContent } from './engine/battle.js';
import { uid } from './engine/rng.js';
import * as SC from './engine/schema.js';
import { effectText, describePowers, keywordsOf, scaleLabel } from './engine/describe.js';
import { validate } from './engine/validate.js';
import { runBattle } from './ui/battle-view.js';

let C, idx, official, issues = [];
const ui = { section: 'home', sel: null, f: { q: '', faction: '', type: '', publish: '' }, sandbox: { char: '', enc: '', extra: [], only: false } };
const $nav = document.getElementById('nav'), $main = document.getElementById('main'), $save = document.getElementById('save-state');
let previewFn = null, saveTimer = null;

const SECTIONS = [
  ['home', '總覽', '◈'], ['cards', '卡片', '🂠'], ['characters', '角色', '♛'], ['enemies', '敵人', '☠'], ['encounters', '遭遇', '⚔'],
  ['relics', '遺物', '✧'], ['statuses', '狀態', '❖'], ['factions', '陣營', '⚑'], ['rules', '規則', '⚙'],
  null, ['sandbox', '試玩沙盒', '▶'], ['check', '檢查', '✓'], ['io', '匯入／匯出', '⇄'],
];
const KIND_SECTION = { card: 'cards', character: 'characters', enemy: 'enemies', encounter: 'encounters', relic: 'relics', status: 'statuses', rules: 'rules' };
const KIND_LABEL = { card: '卡片', character: '角色', enemy: '敵人', encounter: '遭遇', relic: '遺物', status: '狀態', rules: '規則' };

// ───────── 儲存 ─────────
function commit(structural = false) {
  idx = indexContent(C);
  issues = validate(C);
  clearTimeout(saveTimer);
  $save.textContent = '儲存中…';
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY_WORK, JSON.stringify(C));
      $save.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
    } catch { $save.textContent = '⚠ 儲存空間已滿（圖片太多），請先匯出備份'; }
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
    const count = { cards: C.cards, characters: C.characters, enemies: C.enemies, encounters: C.encounters, relics: C.relics, statuses: C.statuses, factions: C.factions }[id]?.length;
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

function imageField(o) {
  const wrap = h('div', { class: 'row' });
  const draw = () => fill(wrap, 
    o.image ? h('img', { src: o.image, class: 'thumb', alt: '' }) : h('span', { class: 'faint small' }, '尚未上傳，會使用預設圖樣'),
    h('label', { class: 'btn sm' }, o.image ? '更換圖片' : '上傳圖片', h('input', { type: 'file', accept: 'image/*', class: 'hidden', onchange: async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
      const k = Math.min(1, 360 / Math.max(img.width, img.height));
      const cv = h('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      o.image = cv.toDataURL('image/jpeg', 0.78); commit(); draw();
    } })),
    o.image ? h('button', { class: 'btn sm ghost', onclick: () => { o.image = ''; commit(); draw(); } }, '移除') : null);
  draw();
  return wrap;
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
      fill(grid, ...list.map((c) => { const el = cardEl(idx, c, { width: 150, flavor: false }); el.onclick = () => go('cards', c.id); return el; }),
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
          field('介紹', inArea(ch, 'desc')), field('肖像', imageField(ch)), field('狀態', publishToggle(ch))),
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
          field('圖像', imageField(en)), field('狀態', publishToggle(en))),
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
        section('基本資料', h('div', { class: 'grid2' }, field('名稱', inText(enc, 'name')), field('出現階段', inSel(enc, 'pool', dict(SC.ENCOUNTER_POOLS)))), field('狀態', publishToggle(enc))),
        section('敵人（由左到右）', box));
    },
  }),

  relics: () => listEditor({
    kind: 'relic', items: C.relics, title: '遺物', intro: '遺物在整輪冒險中持續生效。目前每位角色有一個初始遺物。',
    newItem: () => ({ id: 'relic_' + uid(), name: '新遺物', flavor: '', powers: [{ trigger: 'battleStart', effects: [] }], image: '', publish: 'draft' }),
    editor(r) {
      const txt = h('div', { class: 'auto-text' });
      const prev = previewFn; previewFn = () => { prev?.(); txt.textContent = describePowers(idx, r.powers) || '（還沒有效果）'; };
      previewFn();
      return h('div', {},
        section('基本資料', h('div', { class: 'grid2' }, field('名稱', inText(r, 'name')), field('風味文字', inText(r, 'flavor'))), field('狀態', publishToggle(r))),
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
          field('說明（玩家看到的文字）', inArea(s, 'desc'))),
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
    editor: (f) => section('基本資料',
      h('div', { class: 'grid2' }, field('名稱', inText(f, 'name')), field('代表色', h('input', { type: 'color', value: f.color, oninput: (e) => { f.color = e.target.value; commit(); } }))),
      field('說明', inArea(f, 'desc')),
      f.id === 'nameless' ? h('p', { class: 'gold small' }, '「無名」是通用陣營：所有角色的獎勵都會出現它的牌。請不要刪除。') : null),
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
      section('戰鬥基本規則', h('div', { class: 'grid2' },
        field('每回合能量', inNum(R, 'energy', { min: 0 })), field('每回合抽牌數', inNum(R, 'draw', { min: 0 })),
        field('手牌上限', inNum(R, 'handLimit', { min: 1 })), field('初始牌組張數', inNum(R, 'deckSize', { min: 1 }), '只用來提醒，不會強制'),
        field('每場戰鬥勝利後回復生命', inNum(R, 'healAfterBattle', { min: 0 })), field('篝火休息回復（最大生命的 %）', inNum(R, 'restHealPct', { min: 0 })))),
      section('捕捉：生贄分級',
        h('p', { class: 'dim small' }, '被捕捉的敵人會依「最大生命」變成不同等級的生贄卡。由上往下比對，最後一列是「其餘全部」。'),
        h('div', { class: 'deck-rows' }, R.captureTiers.map((t, i) => h('div', { class: 'deck-row' },
          i < R.captureTiers.length - 1 ? [h('span', {}, '最大生命不高於'), inNum(t, 'maxHp', { min: 1 })] : h('span', {}, '其餘（更高的）'),
          h('span', {}, '→ 變成'), cardSelect(t, 'card'))))),
      section('關卡流程（經典模式・第一章）', stages),
      issueBox('rules', 'rules'));
  },

  sandbox() {
    const S = ui.sandbox;
    if (!idx.characters.has(S.char)) S.char = C.characters[0]?.id || '';
    if (!idx.encounters.has(S.enc)) S.enc = C.encounters[0]?.id || '';
    const stage = h('div', { class: 'sandbox-stage panel' }, h('div', { class: 'empty' }, '設定好後按「開始試玩」。'));
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
      const state = await runBattle(stage, idx, { player: { hp: ch.hp, maxHp: ch.hp, name: ch.name, image: ch.image }, deck, top, relics: ch.relic ? [ch.relic] : [], enemies: enc.enemies.filter((id) => idx.enemies.has(id)), seed: Date.now() });
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
        h('p', { class: 'dim' }, '把目前的全部內容存成一個檔案。可以當備份，也可以交給負責審核的人。'),
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: () => download(`abyss-內容-${stamp()}.json`) }, '匯出內容檔'),
          h('button', { class: 'btn', onclick: () => download('content.json') }, '匯出為 content.json（套用到遊戲用）'))),
      section('匯入',
        h('p', { class: 'dim' }, '讀入別人交來的內容檔。合併時，同代號的項目以匯入的為準，其餘保留。'),
        h('label', { class: 'btn' }, '選擇內容檔…', h('input', { type: 'file', accept: '.json,application/json', class: 'hidden', onchange: (e) => importFile(e.target.files[0]) }))),
      section('套用到正式遊戲',
        h('ol', { class: 'dim' },
          h('li', {}, '在「檢查」確認沒有錯誤，並把要上線的項目切換成「正式」。'),
          h('li', {}, '按上面的「匯出為 content.json」。'),
          h('li', {}, '用這個檔案取代儲存庫裡的 content/content.json。在 GitHub 網頁上進入 content 資料夾，按 Add file → Upload files，把檔案拖進去再按 Commit 即可。'),
          h('li', {}, '遊戲重新整理後就會使用新內容。標成「草稿」的項目不會出現。'))),
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
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!c.sacrifice, onchange: (e) => { c.sacrifice = e.target.checked ? { alt: [{ type: 'loseHp', amount: 3 }] } : null; commit(); drawSac(); } }), h('b', {}, '獻祭'), '：打出時要獻祭一張生贄，或改付下面的替代代價'),
    ...(c.sacrifice ? [h('div', { class: 'sub-title' }, '替代代價（沒有生贄、或不想獻祭時付出）'), effectsEditor(c.sacrifice.alt ||= [], 'player', '沒有替代代價（等於免費）')] : []));
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
    playable ? section('打出時的效果', effectsEditor(c.effects, 'player', '還沒有效果，從下面加入。')) : null,
    c.type === 'blessing' ? section('祝福的持續效果', powersEditor(c.powers, '打出後，在指定的時機反覆發動，直到戰鬥結束。')) : null,
    h('details', { class: 'box panel', open: Object.keys(c.triggers).length > 0 }, h('summary', {}, h('h3', { style: { display: 'inline' } }, '進階：特殊時機'), h('span', { class: 'faint small' }, '　這張牌被棄置、被消耗、被獻祭時發動的效果')), triggersEditor(c.triggers)),
    section('文字與圖片',
      field('說明文字', inArea(c, 'text', '留空就會依效果自動產生（建議留空）'), '只有自動產生的文字不夠清楚時才需要手寫'),
      field('風味文字', inText(c, 'flavor', '可留空')),
      field('卡圖', imageField(c))),
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
const LISTS = ['cards', 'characters', 'enemies', 'encounters', 'relics', 'statuses', 'factions'];
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
function download(name) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(C, null, 1)], { type: 'application/json' })), download: name });
  document.body.append(a); a.click(); a.remove();
  toast(`已匯出 ${name}`);
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
  try { data = JSON.parse(await file.text()); if (!Array.isArray(data.cards) || !data.rules) throw 0; } catch { return toast('這不是有效的內容檔'); }
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
    C = loadWorking() || clone(official);
    C.meta ||= {}; for (const k of LISTS) C[k] ||= [];
    commit(true);
  } catch (e) {
    fill($main, h('div', { class: 'empty' }, '載入失敗：' + (e.message || e)));
  }
})();
