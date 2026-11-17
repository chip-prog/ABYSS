// 引擎自動測試：node tests/engine.test.mjs
import fs from 'fs';
import assert from 'assert';
import { indexContent, createBattle, startBattle, playCard, endTurn, canPlay, cardDef, needsTarget, stacks } from '../js/engine/battle.js';
import { validate } from '../js/engine/validate.js';
import { describeCard } from '../js/engine/describe.js';
import { newRun, pickEncounter, rewardCards, applyBattleResult, addCardToRun, restHeal } from '../js/engine/run.js';

const raw = JSON.parse(fs.readFileSync(new URL('../content/content.json', import.meta.url)));
const idx = indexContent(raw);
const inst = (id, i = 0) => ({ uid: id + i, id });
const battle = async (deck, enemies, extra = {}) => {
  const s = createBattle(idx, { player: { hp: 70, maxHp: 70 }, deck: deck.map(inst), enemies, seed: 1, ...extra });
  await startBattle(s); return s;
};
const play = (s, id, t) => playCard(s, s.hand.find((c) => c.id === id).uid, t ?? s.enemies[0].uid);

// 1. 內容檢查不得有錯誤
const issues = validate(raw);
const errors = issues.filter((i) => i.level === 'error');
assert.deepEqual(errors, [], '內容檢查有錯誤');
for (const c of raw.cards) assert.ok(typeof describeCard(idx, c) === 'string');

// 2. 基本傷害與格擋
{ const s = await battle(['c_strike', 'c_guard'], ['knight']);
  const hp = s.enemies[0].hp; await play(s, 'c_strike'); assert.equal(s.enemies[0].hp, hp - 6);
  await play(s, 'c_guard'); assert.equal(s.player.block, 5); assert.equal(s.player.energy, 1); }
// 3. 流血每層 +1、狂怒每層 +1 且回合結束清除
{ const s = await battle(['c_rend', 'c_strike', 'c_boil'], ['knight']);
  const e = s.enemies[0]; let hp = e.hp;
  await play(s, 'c_rend'); assert.equal(e.hp, hp - 4); assert.equal(stacks(e, 'bleed'), 3);
  await play(s, 'c_boil'); assert.equal(s.player.hp, 68); assert.equal(stacks(s.player, 'fury'), 3);
  hp = e.hp; await play(s, 'c_strike'); assert.equal(e.hp, hp - (6 + 3 + 3));
  await endTurn(s); assert.equal(stacks(s.player, 'fury'), 0); assert.equal(stacks(e, 'bleed'), 2); }
// 4. 壁壘：格擋加進傷害
{ const s = await battle(['c_guard', 'c_bash'], ['knight']);
  const e = s.enemies[0], hp = e.hp; await play(s, 'c_guard'); await play(s, 'c_bash'); assert.equal(e.hp, hp - 8); }
// 5. 充能只影響帶充能的牌
{ const s = await battle(['a_focus', 'a_bolt', 'a_strike'], ['knight']);
  const e = s.enemies[0]; await play(s, 'a_focus'); let hp = e.hp;
  await play(s, 'a_strike'); assert.equal(e.hp, hp - 6); hp = e.hp;
  await play(s, 'a_bolt'); assert.equal(e.hp, hp - 6); assert.equal(stacks(s.player, 'charge'), 3); }
// 6. 蝕咒：回合結束扣血後減 1
{ const s = await battle(['a_hex'], ['knight']);
  const e = s.enemies[0], hp = e.hp; await play(s, 'a_hex'); await endTurn(s);
  assert.equal(e.hp, hp - 4); assert.equal(stacks(e, 'hex'), 3); }
// 7. 延遲：敵人跳過一次行動，且不能連續被延遲
{ const s = await battle(['a_bind', 'a_bind', 'a_bind'], ['hound']);
  s.player.energy = 9; const e = s.enemies[0];
  await play(s, 'a_bind'); assert.equal(stacks(e, 'delay'), 1);
  await endTurn(s); assert.equal(s.player.hp, 70, '被延遲的敵人不應攻擊'); assert.equal(e.intent.name, '撕咬');
  s.hand.push(inst('a_bind', 9)); s.player.energy = 9; await play(s, 'a_bind'); assert.equal(stacks(e, 'delay'), 0, '不能連續延遲');
  await endTurn(s); assert.equal(s.player.hp, 64); }
// 8. 獻祭：有生贄時永久移除並觸發額外效果；沒有時付替代代價
{ const s = await battle(['b_offering', 'b_prisoner', 'b_strike'], ['knight'], { choose: async (r) => r.type === 'sacrifice' ? r.tributes[0].uid : [] });
  await play(s, 'b_offering'); assert.equal(s.player.energy, 5); assert.equal(s.player.hp, 70);
  assert.deepEqual(s.deckRemoved, ['b_prisoner1']); assert.ok(!s.hand.some((c) => c.id === 'b_prisoner'));
  const s2 = await battle(['b_offering', 'b_strike'], ['knight']);
  await play(s2, 'b_offering'); assert.equal(s2.player.hp, 67); assert.equal(s2.player.energy, 5); }
// 9. 捕捉：生命夠低才成功，生成具名生贄並加入牌組；頭目不可捕捉
{ const s = await battle(['b_net', 'b_net'], ['swarm']);
  const e = s.enemies[0]; await play(s, 'b_net'); assert.ok(!e.dead); e.hp = 12;
  await play(s, 'b_net'); assert.ok(e.captured); assert.equal(s.phase, 'won');
  assert.equal(s.deckAdded[0].name, '生贄：蝕肉蟲群'); assert.equal(s.deckAdded[0].id, 'tribute_s');
  const b = await battle(['b_net'], ['bellkeeper']); b.enemies[0].hp = 5; await play(b, 'b_net'); assert.ok(!b.enemies[0].captured); }
// 10. 消耗、棄置觸發、觀想
{ const s = await battle(['n_spark', 'a_echo', 'a_cycle', 'a_strike', 'a_guard', 'a_scry', 'a_hex'], ['knight'], { choose: async (r) => r.cards.filter((c) => c.id === 'a_echo').map((c) => c.uid).concat(r.cards.map((c) => c.uid)).slice(0, Math.max(r.min, 1)) });
  s.hand.push(...s.draw.splice(0)); const e = s.enemies[0], hp = e.hp;
  await play(s, 'n_spark'); assert.equal(s.exhaust.length, 1);
  await play(s, 'a_cycle'); assert.equal(e.hp, hp - 6, '殘響咒被棄置時應造成傷害'); }
// 11. 完整跑完多輪冒險（自動出牌），確認不會卡死
let wins = 0, total = 0;
for (const ch of raw.characters) for (let seed = 1; seed <= 20; seed++) {
  const run = newRun(idx, ch.id, { seed });
  total++;
  while (run.stage < run.stages.length && run.hp > 0) {
    const stage = run.stages[run.stage];
    if (stage.type === 'rest') { restHeal(idx, run); run.stage++; continue; }
    const enc = pickEncounter(idx, run); assert.ok(enc, '找不到遭遇');
    const s = createBattle(idx, { player: { hp: run.hp, maxHp: run.maxHp }, deck: run.deck, relics: run.relics, enemies: enc.enemies, seed: seed * 31 + run.stage });
    await startBattle(s);
    let guard = 0;
    while (s.phase === 'player' || s.phase === 'enemy') {
      assert.ok(guard++ < 400, '戰鬥疑似卡死');
      const c = s.hand.find((x) => canPlay(s, x));
      if (c) { const t = s.enemies.find((e) => !e.dead); await playCard(s, c.uid, t?.uid); } else await endTurn(s);
    }
    applyBattleResult(idx, run, s);
    if (s.phase === 'lost') break;
    const rw = rewardCards(idx, run); assert.equal(rw.length, 3); addCardToRun(run, rw[0].id);
    run.stage++;
  }
  if (run.hp > 0) wins++;
}
console.log(`全部測試通過。自動出牌（完全不動腦）通關率：${wins}/${total}`);
console.log(`檢查提醒 ${issues.length} 則：`); for (const i of issues) console.log(' -', i.name, i.msg);
