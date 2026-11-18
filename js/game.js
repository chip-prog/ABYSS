// 遊戲本體（經典模式）。加上 ?preview=1 時改讀 Studio 的工作內容，含草稿。
import { contentVersion, h, applyMood, cardEl, modal, showCards, loadOfficial, loadWorking, confirmBox, KEY_RUN } from './ui/common.js';
import { indexContent, cardDef } from './engine/battle.js';
import { describePowers } from './engine/describe.js';
import { sceneFor, newRun, pickEncounter, rewardCards, applyBattleResult, addCardToRun, restHeal, upgradable, isLive } from './engine/run.js';
import { runBattle } from './ui/battle-view.js';
import { imgUrl } from './ui/store.js';

const preview = new URLSearchParams(location.search).has('preview');
const SAVE = KEY_RUN + (preview ? '.preview' : '');
const app = document.getElementById('app');
let raw, idx, run = null;

const save = () => { try { run ? localStorage.setItem(SAVE, JSON.stringify(run)) : localStorage.removeItem(SAVE); } catch {} };
const loadRun = () => { try { const r = JSON.parse(localStorage.getItem(SAVE)); return r && idx.characters.has(r.charId) ? r : null; } catch { return null; } };

function frame(...kids) {
  app.replaceChildren(...[
    preview ? h('div', { class: 'preview-bar' }, '測試環境：正在使用 Studio 的工作內容（包含草稿）。這裡的進度不會影響正式遊戲。') : null,
    ...kids].filter(Boolean));
}
const center = (...kids) => h('div', { class: 'screen' }, ...kids);

function hud() {
  const total = run.stages.length;
  return h('div', { class: 'hud' },
    h('b', {}, run.name),
    h('span', { class: 'hud-hp' }, `♥ ${run.hp} / ${run.maxHp}`),
    h('div', { class: 'pips' }, run.stages.map((s, i) => h('span', { class: `pip s-${s.type}${s.pool === 'boss' ? ' boss' : ''}${i < run.stage ? ' done' : i === run.stage ? ' now' : ''}`, title: s.type === 'rest' ? '篝火' : s.pool === 'boss' ? '頭目' : '戰鬥' }))),
    h('span', { class: 'dim small' }, `第 ${Math.min(run.stage + 1, total)} / ${total} 關`),
    h('span', { class: 'grow' }),
    // 遺物只顯示圖示，名稱和效果放在滑鼠提示裡（之後會移到專屬的狀態列）
    h('div', { class: 'relic-row' }, run.relics.map((id) => { const r = idx.relics.get(id); return r ? h('span', { class: 'relic-icon', title: `${r.name}\n${describePowers(idx, r.powers)}` }, imgUrl(r.image) ? h('img', { src: imgUrl(r.image), alt: r.name }) : '◈') : null; })),
    h('button', { class: 'btn sm', onclick: () => showCards(idx, `牌組（${run.deck.length} 張）`, [...run.deck].sort((a, b) => a.id.localeCompare(b.id))) }, `牌組 ${run.deck.length}`),
    h('button', { class: 'btn sm ghost', onclick: async () => { if (await confirmBox('要放棄這一輪冒險嗎？', '放棄', true)) { run = null; save(); title(); } } }, '放棄'));
}

function title() {
  const saved = loadRun();
  frame(center(
    h('div', { class: 'title-mark' }, raw.meta?.title || 'ABYSS'),
    h('div', { class: 'title-sub' }, raw.meta?.subtitle || ''),
    h('hr', { class: 'rule', style: { width: '320px' } }),
    h('div', { class: 'menu' },
      saved ? h('button', { class: 'btn primary', onclick: () => { run = saved; advance(); } }, `繼續冒險（${saved.name}）`) : null,
      h('button', { class: 'btn' + (saved ? '' : ' primary'), onclick: select }, '開始新冒險'),
      h('a', { class: 'btn ghost', href: 'studio.html' }, '進入 Studio')),
    contentVersion ? h('div', { class: 'ver' }, `版本：${contentVersion}`) : null));
}

// ───────── 選角：先選陣營（三本書），再看角色 ─────────
const liveChars = () => raw.characters.filter((c) => isLive(c, preview));
function bookEl(f) {
  const img = imgUrl(f.book?.img);
  if (img) return h('img', { class: 'book-img', src: img, alt: f.name, draggable: false });
  // 暫代的書：陣營色封面＋書脊＋徽記
  const emb = imgUrl(f.image);
  return h('div', { class: 'book-ph', style: { '--fc': f.color } },
    h('div', { class: 'book-spine' }), h('div', { class: 'book-pages' }),
    h('div', { class: 'book-cover' }, emb ? h('img', { src: emb, alt: '' }) : h('span', {}, [...f.name][0])));
}
function select() {
  const chars = liveChars();
  const facs = raw.factions.filter((f) => chars.some((c) => c.faction === f.id));
  const bg = imgUrl(raw.meta?.select?.bg?.img);
  frame(h('div', { class: 'fsel' + (bg ? ' has-bg' : ''), style: bg ? { backgroundImage: `url("${bg}")` } : {} },
    h('div', { class: 'fsel-beam' }), h('div', { class: 'fsel-dust' }),
    h('div', { class: 'fsel-head' }, h('h1', {}, '選擇陣營'), h('p', { class: 'dim' }, '三本書靜靜躺在光裡。')),
    h('div', { class: 'books' }, facs.map((f) => h('button', { class: 'book', style: { '--fc': f.color }, onclick: (e) => {
      e.currentTarget.classList.add('opening');
      setTimeout(() => character(f.id, 0), 520);
    } },
      bookEl(f),
      h('div', { class: 'book-label' }, h('b', {}, f.name), h('span', {}, f.desc || ''))))),
    h('button', { class: 'btn ghost fsel-back', onclick: title }, '返回')));
}
function character(fid, i) {
  const list = liveChars().filter((c) => c.faction === fid);
  if (!list.length) return select();
  i = (i + list.length) % list.length;
  const c = list[i], fac = idx.factions.get(c.faction), relic = idx.relics.get(c.relic);
  const portrait = imgUrl(c.image) || imgUrl(c.poses?.idle?.img);
  const deck = c.deck.filter((id) => idx.cards.has(id)).map((id, k) => ({ uid: 'd' + k, id }));
  const counts = new Map(); for (const d of deck) counts.set(d.id, (counts.get(d.id) || 0) + 1);
  frame(h('div', { class: 'csel', style: { '--fc': fac?.color } },
    h('div', { class: 'csel-beam' }),
    h('div', { class: 'csel-portrait' + (portrait ? '' : ' ph') },
      portrait ? h('img', { src: portrait, alt: c.name }) : h('span', {}, [...c.name][0]),
      list.length > 1 ? [h('button', { class: 'csel-arrow l', onclick: () => character(fid, i - 1) }, '‹'), h('button', { class: 'csel-arrow r', onclick: () => character(fid, i + 1) }, '›')] : null),
    h('div', { class: 'csel-page' },
      h('div', { class: 'csel-faction' }, imgUrl(fac?.image) ? h('img', { src: imgUrl(fac.image), alt: '' }) : null, fac?.name || ''),
      h('h1', {}, c.name, c.publish === 'draft' ? h('span', { class: 'badge draft', style: { marginLeft: '10px', fontSize: '13px' } }, '草稿') : null),
      h('div', { class: 'csel-title' }, c.title || ''),
      h('p', { class: 'csel-desc' }, c.desc || ''),
      h('div', { class: 'csel-stats' },
        h('div', {}, h('span', { class: 'faint' }, '生命'), h('b', { class: 'hp' }, `♥ ${c.hp}`)),
        relic ? h('div', { class: 'csel-relic' }, h('span', { class: 'faint' }, '初始遺物'),
          h('div', { class: 'row' }, h('span', { class: 'relic-icon big' }, imgUrl(relic.image) ? h('img', { src: imgUrl(relic.image), alt: '' }) : '◈'),
            h('div', {}, h('b', {}, relic.name), h('div', { class: 'small dim' }, describePowers(idx, relic.powers))))) : null),
      h('div', { class: 'csel-deck' },
        h('div', { class: 'row' }, h('span', { class: 'faint' }, `初始牌組（${deck.length} 張）`), h('span', { class: 'grow' }),
          h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, `${c.name} 的初始牌組`, deck) }, '展開檢視')),
        h('div', { class: 'csel-cards' }, [...counts].map(([id, n]) => h('div', { class: 'csel-card', onclick: () => showCards(idx, `${c.name} 的初始牌組`, deck) },
          cardEl(idx, { id }, { width: 96, tips: false, flavor: false }), n > 1 ? h('b', { class: 'csel-n' }, `×${n}`) : null)))),
      h('div', { class: 'row csel-actions' },
        h('button', { class: 'btn ghost', onclick: select }, '‹ 換個陣營'),
        h('span', { class: 'grow' }),
        list.length > 1 ? h('span', { class: 'faint small' }, `${i + 1} / ${list.length}`) : null,
        h('button', { class: 'btn primary seal-btn', onclick: () => { run = newRun(idx, c.id, { includeDraft: preview }); save(); advance(); } }, '上場')))));
}

async function advance() {
  save();
  if (run.stage >= run.stages.length) return ending(true);
  const stage = run.stages[run.stage];
  if (stage.type === 'rest') return rest();
  const enc = pickEncounter(idx, run);
  if (!enc) { frame(hud(), center(h('h2', {}, '找不到可用的遭遇'), h('p', { class: 'dim' }, '請到 Studio 確認這個階段至少有一場「正式」的遭遇。'))); return; }
  const ch = idx.characters.get(run.charId);
  const stageEl = h('div', { class: 'battle-wrap' });
  frame(hud(), h('div', { class: 'enc-name' }, enc.name), stageEl);
  const state = await runBattle(stageEl, idx, {
    player: { hp: run.hp, maxHp: run.maxHp, name: run.name, poses: ch.poses, color: idx.factions.get(ch.faction)?.color, faction: ch.faction },
    deck: run.deck, relics: run.relics, enemies: enc.enemies, scene: sceneFor(idx, enc), seed: run.seed + run.stage * 31,
  });
  applyBattleResult(idx, run, state);
  if (state.phase === 'lost') return ending(false);
  run.stage++;
  if (run.stage >= run.stages.length) return ending(true);
  save();
  reward(state);
}

function reward(state) {
  run.stage--; const options = rewardCards(idx, run); run.stage++;
  const next = () => advance();
  frame(hud(), center(
    h('h1', {}, '戰鬥勝利'),
    state.captured.length ? h('p', { class: 'gold' }, `捕獲生贄：${state.captured.join('、')}`) : null,
    h('p', { class: 'dim' }, '選一張牌加入牌組'),
    h('div', { class: 'card-pick' }, options.map((c) => {
      const el = cardEl(idx, c, { width: 200 });
      el.onclick = () => { addCardToRun(run, c.id); next(); };
      return el;
    })),
    h('button', { class: 'btn ghost', onclick: next }, '跳過，不拿牌')));
}

function rest() {
  const done = () => { run.stage++; advance(); };
  const heal = Math.ceil(run.maxHp * (idx.rules.restHealPct || 30) / 100);
  const ups = upgradable(idx, run);
  frame(hud(), center(
    h('div', { class: 'fire' }, '🜂'),
    h('h1', {}, '篝火'),
    h('p', { class: 'dim' }, '火光之外，鐘聲仍在迴盪。'),
    h('div', { class: 'menu' },
      h('button', { class: 'btn primary', onclick: () => { restHeal(idx, run); done(); } }, `休息：回復 ${heal} 點生命`),
      h('button', { class: 'btn', disabled: !ups.length, onclick: () => {
        const m = modal('選擇一張牌升級', h('div', { class: 'card-pick' }, ups.map((c) => {
          const el = h('div', { class: 'up-pair' }, cardEl(idx, c, { width: 170 }), h('span', {}, '→'), cardEl(idx, { ...c, upgraded: true }, { width: 170 }));
          el.onclick = () => { c.upgraded = true; m.close(); done(); };
          return el;
        })), { wide: true });
      } }, ups.length ? '鍛造：升級一張牌' : '沒有可升級的牌'))));
}

function ending(win) {
  const stage = run.stage, total = run.stages.length, name = run.name;
  run = null; save();
  frame(center(
    h('div', { class: 'title-mark', style: { fontSize: '64px', color: win ? 'var(--gold)' : 'var(--blood)' } }, win ? '第一章　完' : '你倒下了'),
    h('p', { class: 'dim' }, win ? `${name} 登上了鐘樓之頂。鐘聲停了。` : `${name} 倒在第 ${stage + 1} / ${total} 關。`),
    h('div', { class: 'menu' }, h('button', { class: 'btn primary', onclick: select }, '再來一輪'), h('button', { class: 'btn ghost', onclick: title }, '回到標題'))));
}

(async () => {
  try {
    const off = await loadOfficial();
    raw = (preview && await loadWorking()) || off;
    idx = indexContent(raw);
    applyMood(document.body, raw.rules);
    document.title = raw.meta?.title || 'ABYSS';
    title();
  } catch (e) {
    app.replaceChildren(center(h('h2', {}, '載入失敗'), h('p', { class: 'dim' }, String(e.message || e))));
  }
})();
