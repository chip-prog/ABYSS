// 一輪冒險的流程（經典模式）：連續戰鬥 → 選牌獎勵 → 篝火 → 頭目。
import { makeRng, uid } from './rng.js';
import { REWARD_WEIGHTS } from './schema.js';

export const isLive = (item, includeDraft) => includeDraft || item.publish === 'official';

export function expandStages(rules) {
  const out = [];
  for (const s of rules.stages || []) {
    if (s.type === 'rest') out.push({ type: 'rest' });
    else for (let i = 0; i < (s.count || 1); i++) out.push({ type: 'battle', pool: s.pool });
  }
  return out;
}

export function newRun(idx, charId, { seed = Date.now(), includeDraft = false } = {}) {
  const ch = idx.characters.get(charId);
  return {
    charId, name: ch.name, faction: ch.faction, hp: ch.hp, maxHp: ch.hp,
    deck: ch.deck.filter((id) => idx.cards.has(id)).map((id) => ({ uid: uid(), id })),
    relics: ch.relic ? [ch.relic] : [],
    stages: expandStages(idx.rules), stage: 0, seed, includeDraft, lastEncounter: null,
  };
}

export function pickEncounter(idx, run) {
  const rng = makeRng(run.seed + run.stage * 7919);
  const pool = run.stages[run.stage].pool;
  let list = idx.raw.encounters.filter((e) => e.pool === pool && isLive(e, run.includeDraft) && e.enemies.every((id) => idx.enemies.has(id)));
  if (list.length > 1) list = list.filter((e) => e.id !== run.lastEncounter);
  const enc = list.length ? rng.pick(list) : null;
  if (enc) run.lastEncounter = enc.id;
  return enc;
}

export function rewardCards(idx, run, n = 3) {
  const rng = makeRng(run.seed + run.stage * 104729 + 13);
  const pool = idx.raw.cards.filter((c) => isLive(c, run.includeDraft) && REWARD_WEIGHTS[c.rarity] && (c.faction === run.faction || c.faction === 'nameless'));
  const out = [];
  while (out.length < n && out.length < pool.length) {
    const c = rng.weighted(pool.filter((x) => !out.includes(x)), (x) => REWARD_WEIGHTS[x.rarity]);
    out.push(c);
  }
  return out;
}

// 戰鬥結束後，把結果寫回這一輪冒險
export function applyBattleResult(idx, run, state) {
  run.hp = Math.max(0, state.player.hp);
  run.deck = run.deck.filter((c) => !state.deckRemoved.includes(c.uid));
  for (const c of state.deckAdded) run.deck.push({ ...c });
  if (state.phase === 'won') run.hp = Math.min(run.maxHp, run.hp + (idx.rules.healAfterBattle || 0));
}

export const addCardToRun = (run, cardId) => run.deck.push({ uid: uid(), id: cardId });
export const restHeal = (idx, run) => { run.hp = Math.min(run.maxHp, run.hp + Math.ceil(run.maxHp * (idx.rules.restHealPct || 30) / 100)); };
export const upgradable = (idx, run) => run.deck.filter((c) => !c.upgraded && idx.cards.get(c.id)?.upgrade);
