// 遊戲本體（經典模式）。加上 ?preview=1 時改讀 Studio 的工作內容，含草稿。
import { h, cardEl, modal, showCards, loadOfficial, loadWorking, confirmBox, KEY_RUN } from './ui/common.js';
import { indexContent, cardDef } from './engine/battle.js';
import { describePowers } from './engine/describe.js';
import { newRun, pickEncounter, rewardCards, applyBattleResult, addCardToRun, restHeal, upgradable, isLive } from './engine/run.js';
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
    run.relics.map((id) => { const r = idx.relics.get(id); return r ? h('span', { class: 'chip relic', title: describePowers(idx, r.powers) }, '◈ ' + r.name) : null; }),
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
      h('a', { class: 'btn ghost', href: 'studio.html' }, '進入 Studio'))));
}

function select() {
  const chars = raw.characters.filter((c) => isLive(c, preview));
  frame(center(
    h('h1', {}, '選擇你的角色'),
    h('div', { class: 'char-row' }, chars.map((c) => {
      const fac = idx.factions.get(c.faction), relic = idx.relics.get(c.relic);
      return h('div', { class: 'char panel', style: { '--fc': fac?.color } },
        (() => { const idle = imgUrl(c.poses?.idle?.img), port = imgUrl(c.image); return h('div', { class: 'medal' + (!port && idle ? ' cutout' : '') }, port || idle ? h('img', { src: port || idle, alt: '' }) : h('span', {}, [...c.name][0])); })(),
        h('h2', {}, c.name, c.publish === 'draft' ? h('span', { class: 'badge draft', style: { marginLeft: '8px' } }, '草稿') : null),
        h('div', { class: 'char-title' }, `${c.title || ''}・${fac?.name || ''}`),
        h('p', { class: 'dim' }, c.desc || ''),
        h('div', { class: 'small' }, `生命 ${c.hp}`),
        relic ? h('div', { class: 'small relic-line' }, h('b', {}, '◈ ' + relic.name), '　', describePowers(idx, relic.powers)) : null,
        h('div', { class: 'row', style: { justifyContent: 'center', marginTop: '12px' } },
          h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, `${c.name} 的初始牌組`, c.deck.map((id) => ({ id })).filter((x) => idx.cards.has(x.id))) }, '查看牌組'),
          h('button', { class: 'btn primary', onclick: () => { run = newRun(idx, c.id, { includeDraft: preview }); save(); advance(); } }, '選擇')));
    })),
    h('button', { class: 'btn ghost', onclick: title }, '返回')));
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
    deck: run.deck, relics: run.relics, enemies: enc.enemies, seed: run.seed + run.stage * 31,
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
    raw = (preview && await loadWorking()) || await loadOfficial();
    idx = indexContent(raw);
    document.title = raw.meta?.title || 'ABYSS';
    title();
  } catch (e) {
    app.replaceChildren(center(h('h2', {}, '載入失敗'), h('p', { class: 'dim' }, String(e.message || e))));
  }
})();
