// 戰鬥引擎：純邏輯，不碰畫面。遊戲本體與 Studio 的試玩沙盒共用這一份。
import { makeRng, uid } from './rng.js';

const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));

export function indexContent(raw) {
  return {
    raw,
    rules: raw.rules,
    cards: byId(raw.cards), statuses: byId(raw.statuses), enemies: byId(raw.enemies),
    relics: byId(raw.relics), characters: byId(raw.characters), factions: byId(raw.factions),
    encounters: byId(raw.encounters),
  };
}

// 卡片實體 → 實際生效的定義（套用升級與自訂名稱，例如「生贄：腐沼獵犬」）
export function cardDef(idx, inst) {
  const base = idx.cards.get(inst.id);
  if (!base) return null;
  let d = base;
  if (inst.upgraded && base.upgrade) d = { ...base, ...base.upgrade, name: base.upgrade.name || base.name + '+' };
  if (inst.name) d = { ...d, name: inst.name };
  return d;
}

export const isUnplayable = (def) => def.cost < 0 || !!def.keywords?.unplayable;
export const needsTarget = (def) =>
  [...(def.effects || []), ...(def.sacrifice?.alt || [])].some(
    (e) => (e.type === 'capture') || ((e.type === 'damage' || e.type === 'applyStatus') && (e.target || 'enemy') === 'enemy')
      || e.if?.type === 'targetHasStatus' || e.if?.type === 'targetHpLte' || String(e.scale?.by || '').startsWith('targetStatus:'));

export const stacks = (actor, id) => actor.statuses[id] || 0;

const autoChoose = async (req) => {
  if (req.type === 'sacrifice') return req.tributes[0].uid;
  return req.cards.slice(0, req.min).map((c) => c.uid);
};

export function createBattle(idx, opts) {
  const rng = makeRng(opts.seed);
  const state = {
    idx, rng, rules: idx.rules,
    choose: opts.choose || autoChoose,
    tick: opts.tick || (async () => {}),
    phase: 'player', turn: 0, depth: 0,
    player: {
      isPlayer: true, uid: 'player', name: opts.player.name || '玩家',
      hp: opts.player.hp, maxHp: opts.player.maxHp, block: 0, energy: 0, statuses: {}, powers: [],
    },
    enemies: [], draw: [], hand: [], discard: [], exhaust: [],
    counters: { hpLost: 0, played: 0 },
    deckAdded: [], deckRemoved: [], captured: [],
    log: [], events: [],
  };
  for (const id of opts.relics || []) {
    const r = idx.relics.get(id);
    if (r) for (const p of r.powers || []) state.player.powers.push({ ...p, name: r.name, relic: true });
  }
  for (const id of opts.enemies) {
    const def = idx.enemies.get(id);
    if (!def) continue;
    const hp = rng.range(def.hp[0], def.hp[1]);
    const en = { uid: uid(), defId: id, name: def.name, boss: !!def.boss, hp, maxHp: hp, block: 0, statuses: {}, moveIndex: -1, intent: null, delayImmune: false, dead: false };
    advanceIntent(state, en);
    state.enemies.push(en);
  }
  state.draw = rng.shuffle(opts.deck.map((c) => ({ ...c })));
  // 試玩用：指定某些牌一定出現在起手
  if (opts.top?.length) state.draw = [...state.draw.filter((c) => !opts.top.includes(c.uid)), ...state.draw.filter((c) => opts.top.includes(c.uid))];
  return state;
}

export async function startBattle(state) {
  await fire(state, 'battleStart');
  await startPlayerTurn(state);
}

const log = (state, msg) => { state.log.push(msg); if (state.log.length > 200) state.log.shift(); };
const emit = (state, ev) => { state.events.push(ev); if (state.events.length > 400) state.events.splice(0, 200); };
const over = (state) => state.phase === 'won' || state.phase === 'lost';
const alive = (state) => state.enemies.filter((e) => !e.dead);

function advanceIntent(state, en) {
  const def = state.idx.enemies.get(en.defId);
  const n = def.moves.length;
  if (!n) { en.intent = { name: '發呆', effects: [] }; return; }
  if (def.pattern === 'random' && n > 1) {
    let i; do { i = state.rng.int(n); } while (i === en.moveIndex);
    en.moveIndex = i;
  } else en.moveIndex = (en.moveIndex + 1) % n;
  en.intent = def.moves[en.moveIndex];
}

// ───────── 數值計算 ─────────
function scaleValue(state, by, ctx) {
  const self = ctx.source;
  if (by.startsWith('status:')) return stacks(self, by.slice(7));
  if (by.startsWith('targetStatus:')) return ctx.target ? stacks(ctx.target, by.slice(13)) : 0;
  switch (by) {
    case 'block': return self.block;
    case 'discard': return state.discard.length;
    case 'draw': return state.draw.length;
    case 'exhaust': return state.exhaust.length;
    case 'hand': return state.hand.length;
    case 'hpLost': return state.counters.hpLost;
    case 'played': return state.counters.played;
    case 'tributes': return [...state.draw, ...state.hand, ...state.discard].filter((c) => state.idx.cards.get(c.id)?.type === 'tribute').length;
    default: return 0;
  }
}
export function amountOf(state, e, ctx) {
  let a = Number(e.amount) || 0;
  if (e.scale?.by) a += Math.floor((e.scale.per ?? 1) * scaleValue(state, e.scale.by, ctx));
  return a;
}
// 攻擊傷害 = (基礎 + 攻方每層加成 + 守方每層加成) × 百分比修正
export function calcAttack(state, src, tgt, base) {
  let d = base, pct = 1;
  for (const [id, n] of Object.entries(src.statuses)) {
    const s = state.idx.statuses.get(id); if (!s) continue;
    if (s.dealAdd) d += s.dealAdd * n;
    if (s.dealPct) pct *= 1 + s.dealPct / 100;
  }
  if (tgt) for (const [id, n] of Object.entries(tgt.statuses)) {
    const s = state.idx.statuses.get(id); if (!s) continue;
    if (s.takeAdd) d += s.takeAdd * n;
    if (s.takePct) pct *= 1 + s.takePct / 100;
  }
  return Math.max(0, Math.floor(d * pct));
}

// ───────── 基本動作 ─────────
function addStatus(state, actor, id, n) {
  const def = state.idx.statuses.get(id);
  if (!def || actor.dead || !n) return;
  if (def.special === 'delay' && n > 0) {
    if (actor.isPlayer) return;
    if (stacks(actor, id) > 0 || actor.delayImmune) { log(state, `${actor.name} 抵抗了「${def.name}」（不能連續被延遲）`); return; }
  }
  const v = stacks(actor, id) + n;
  if (v <= 0) delete actor.statuses[id]; else actor.statuses[id] = v;
  emit(state, { type: 'status', uid: actor.uid, text: `${def.name}${n > 0 ? '+' : ''}${n}` });
}

async function loseHp(state, actor, n) {
  n = Math.min(n, actor.hp);
  if (n <= 0 || actor.dead) return 0;
  actor.hp -= n;
  emit(state, { type: 'hp', uid: actor.uid, amount: -n });
  if (actor.hp <= 0) { await die(state, actor); return n; }
  if (actor.isPlayer) {
    if (state.phase === 'player') { state.counters.hpLost += n; await fire(state, 'selfHarm'); }
    await fire(state, 'loseHp');
  }
  return n;
}

async function dealDamage(state, src, tgt, base) {
  if (tgt.dead) return 0;
  const d = calcAttack(state, src, tgt, base);
  const blocked = Math.min(tgt.block, d);
  tgt.block -= blocked;
  if (blocked) emit(state, { type: 'block', uid: tgt.uid, amount: -blocked });
  log(state, `${src.name} 對 ${tgt.name} 造成 ${d} 點傷害${blocked ? `（${blocked} 點被格擋）` : ''}`);
  emit(state, { type: 'struck', uid: tgt.uid, blocked: d - blocked <= 0 });
  return loseHp(state, tgt, d - blocked);
}

async function die(state, actor, captured = false) {
  actor.dead = true; actor.hp = Math.max(0, actor.hp);
  emit(state, { type: 'die', uid: actor.uid, captured });
  if (actor.isPlayer) { state.phase = 'lost'; log(state, '你倒下了。'); return; }
  if (!captured) log(state, `${actor.name} 被擊倒`);
  await fire(state, 'enemyDeath');
  if (!alive(state).length && state.phase !== 'lost') { state.phase = 'won'; log(state, '戰鬥勝利。'); }
}

async function drawCards(state, n) {
  for (let i = 0; i < n; i++) {
    if (state.hand.length >= state.rules.handLimit) break;
    if (!state.draw.length) {
      if (!state.discard.length) break;
      state.draw = state.rng.shuffle(state.discard); state.discard = [];
      log(state, '棄牌堆洗回抽牌堆');
      await fire(state, 'shuffle');
    }
    const inst = state.draw.pop();
    if (!inst) break;
    state.hand.push(inst);
    await cardTrigger(state, inst, 'drawn');
    if (over(state)) return;
  }
}

async function cardTrigger(state, inst, name, extra = {}) {
  const def = cardDef(state.idx, inst);
  const fx = def?.triggers?.[name];
  if (fx?.length) await runEffects(state, fx, { source: state.player, card: inst, ...extra });
}

const removeFrom = (arr, inst) => { const i = arr.indexOf(inst); if (i >= 0) arr.splice(i, 1); return i >= 0; };

async function discardCard(state, inst, from) {
  if (!removeFrom(from, inst)) return;
  state.discard.push(inst);
  log(state, `棄置「${cardDef(state.idx, inst).name}」`);
  await cardTrigger(state, inst, 'discard');
  await fire(state, 'discardCard');
}
async function exhaustCard(state, inst, from) {
  if (from && !removeFrom(from, inst)) return;
  state.exhaust.push(inst);
  await cardTrigger(state, inst, 'exhaust');
  await fire(state, 'exhaustCard');
}

function makeCard(state, id, name) {
  const inst = { uid: uid(), id };
  if (name) inst.name = name;
  return inst;
}

async function pickCards(state, pool, n, random, title) {
  if (!pool.length || n <= 0) return [];
  if (random) return state.rng.shuffle([...pool]).slice(0, n);
  const k = Math.min(n, pool.length);
  const ids = await state.choose({ type: 'cards', title, cards: pool, min: k, max: k });
  return pool.filter((c) => ids.includes(c.uid)).slice(0, k);
}

// ───────── 觸發（祝福、遺物）─────────
async function fire(state, trigger) {
  if (state.depth > 12) return; // 防止無限連鎖
  state.depth++;
  try {
    for (const p of [...state.player.powers]) {
      if (p.trigger !== trigger || over(state)) continue;
      await runEffects(state, p.effects || [], { source: state.player });
    }
  } finally { state.depth--; }
}

// ───────── 條件 ─────────
function check(state, c, ctx) {
  const s = ctx.source, t = ctx.target;
  switch (c.type) {
    case 'targetHasStatus': return !!t && stacks(t, c.status) > 0;
    case 'selfHasStatus': return stacks(s, c.status) > 0;
    case 'lostHpThisTurn': return state.counters.hpLost > 0;
    case 'hasBlock': return s.block > 0;
    case 'discardGte': return state.discard.length >= c.n;
    case 'playedGte': return state.counters.played >= c.n;
    case 'hpBelowPct': return (s.hp / s.maxHp) * 100 <= c.n;
    case 'targetHpLte': return !!t && t.hp <= c.n;
    case 'tributePaid': return !!ctx.tributePaid;
    default: return true;
  }
}

function targetsOf(state, e, ctx) {
  const src = ctx.source, mode = e.target || 'enemy';
  if (mode === 'self') return [src];
  if (!src.isPlayer) return state.player.dead ? [] : [state.player];
  const al = alive(state);
  if (mode === 'allEnemies') return al;
  if (mode === 'randomEnemy' || !ctx.target) return al.length ? [state.rng.pick(al)] : [];
  return ctx.target.dead ? [] : [ctx.target];
}

// ───────── 效果積木的實作 ─────────
const EFFECTS = {
  async damage(state, e, ctx) {
    for (let i = 0; i < (e.times || 1); i++) {
      for (const t of targetsOf(state, e, ctx)) {
        const lost = await dealDamage(state, ctx.source, t, amountOf(state, e, { ...ctx, target: t }));
        if (e.lifesteal && lost > 0 && !ctx.source.dead) heal(state, ctx.source, lost);
        if (over(state)) return;
      }
    }
  },
  async block(state, e, ctx) {
    const n = Math.max(0, amountOf(state, e, ctx));
    ctx.source.block += n;
    emit(state, { type: 'block', uid: ctx.source.uid, amount: n });
    log(state, `${ctx.source.name} 獲得 ${n} 點格擋`);
  },
  async applyStatus(state, e, ctx) {
    for (const t of targetsOf(state, e, ctx)) addStatus(state, t, e.status, amountOf(state, e, { ...ctx, target: t }));
  },
  async heal(state, e, ctx) { heal(state, ctx.source, amountOf(state, e, ctx)); },
  async loseHp(state, e, ctx) {
    log(state, `${ctx.source.name} 失去 ${e.amount} 點生命`);
    await loseHp(state, ctx.source, amountOf(state, e, ctx));
  },
  async draw(state, e, ctx) { if (ctx.source.isPlayer) await drawCards(state, amountOf(state, e, ctx)); },
  async energy(state, e, ctx) { if (ctx.source.isPlayer) state.player.energy += amountOf(state, e, ctx); },
  async scry(state, e, ctx) {
    if (!ctx.source.isPlayer) return;
    const top = state.draw.slice(-amountOf(state, e, ctx)).reverse();
    if (!top.length) return;
    const ids = await state.choose({ type: 'cards', title: '觀想：選擇要棄置的牌（可不選）', cards: top, min: 0, max: top.length });
    for (const c of top) if (ids.includes(c.uid)) await discardCard(state, c, state.draw);
  },
  async discard(state, e, ctx) {
    if (!ctx.source.isPlayer) return;
    for (const c of await pickCards(state, state.hand, amountOf(state, e, ctx), e.random, '選擇要棄置的牌')) await discardCard(state, c, state.hand);
  },
  async exhaustCards(state, e, ctx) {
    if (!ctx.source.isPlayer) return;
    for (const c of await pickCards(state, state.hand, amountOf(state, e, ctx), e.random, '選擇要消耗的牌')) {
      log(state, `消耗「${cardDef(state.idx, c).name}」`);
      await exhaustCard(state, c, state.hand);
    }
  },
  async retrieve(state, e, ctx) {
    if (!ctx.source.isPlayer) return;
    const pile = state[e.from || 'discard'];
    for (const c of await pickCards(state, pile, amountOf(state, e, ctx), false, '選擇要取回手牌的牌')) {
      if (state.hand.length >= state.rules.handLimit) break;
      removeFrom(pile, c); state.hand.push(c);
    }
  },
  async addCard(state, e) {
    if (!state.idx.cards.get(e.card)) return;
    for (let i = 0; i < (e.count || 1); i++) {
      const inst = makeCard(state, e.card);
      const name = state.idx.cards.get(e.card).name;
      const zone = e.zone || 'discard';
      if (zone === 'hand' && state.hand.length < state.rules.handLimit) state.hand.push(inst);
      else if (zone === 'draw') state.draw.splice(state.rng.int(state.draw.length + 1), 0, inst);
      else state.discard.push(inst);
      if (zone === 'deck') { state.deckAdded.push({ ...inst }); log(state, `「${name}」永久加入了牌組`); }
      else log(state, `「${name}」加入了${{ hand: '手牌', draw: '抽牌堆', discard: '棄牌堆' }[zone]}`);
    }
  },
  async capture(state, e, ctx) {
    const t = ctx.target;
    if (!ctx.source.isPlayer || !t || t.dead) return;
    if (t.boss) { log(state, `${t.name} 無法被捕捉`); return; }
    if (t.hp > e.threshold) { log(state, `${t.name} 的生命還太高，捕捉失敗`); return; }
    const tier = (state.rules.captureTiers || []).find((x) => x.maxHp == null || t.maxHp <= x.maxHp);
    if (!tier || !state.idx.cards.get(tier.card)) return;
    const inst = makeCard(state, tier.card, `生贄：${t.name}`);
    state.discard.push(inst);
    state.deckAdded.push({ ...inst });
    state.captured.push(t.name);
    t.captured = true;
    log(state, `${t.name} 被捕捉，化為「${inst.name}」加入牌組`);
    emit(state, { type: 'status', uid: t.uid, text: '捕捉' });
    await die(state, t, true);
  },
};

function heal(state, actor, n) {
  const v = Math.min(n, actor.maxHp - actor.hp);
  if (v <= 0) return;
  actor.hp += v;
  emit(state, { type: 'hp', uid: actor.uid, amount: v });
  log(state, `${actor.name} 回復 ${v} 點生命`);
}

export async function runEffects(state, effects, ctx) {
  for (const e of effects) {
    if (over(state)) return;
    if (e.if?.type && !check(state, e.if, ctx)) continue;
    const fn = EFFECTS[e.type];
    if (fn) await fn(state, e, ctx);
  }
}

// ───────── 玩家行動 ─────────
export function canPlay(state, inst) {
  const def = cardDef(state.idx, inst);
  if (!def || state.phase !== 'player') return false;
  return !isUnplayable(def) && state.player.energy >= def.cost;
}

export async function playCard(state, cardUid, targetUid) {
  const inst = state.hand.find((c) => c.uid === cardUid);
  if (!inst || !canPlay(state, inst) || state.busy) return false;
  const def = cardDef(state.idx, inst);
  let target = state.enemies.find((e) => e.uid === targetUid && !e.dead);
  if (needsTarget(def) && !target) {
    if (alive(state).length === 1) target = alive(state)[0]; else return false;
  }
  const ctx = { source: state.player, target, card: inst, tributePaid: false };

  // 獻祭：先決定要獻祭哪張生贄，或改付替代代價
  let tribute = null;
  if (def.sacrifice) {
    const tributes = state.hand.filter((c) => c !== inst && state.idx.cards.get(c.id)?.type === 'tribute');
    if (tributes.length) {
      const ans = await state.choose({ type: 'sacrifice', card: inst, tributes, alt: def.sacrifice.alt || [] });
      if (ans === 'cancel') return false;
      tribute = tributes.find((c) => c.uid === ans) || null;
    }
  }

  state.busy = true;
  try {
    state.player.energy -= def.cost;
    removeFrom(state.hand, inst);
    log(state, `打出「${def.name}」`);
    // 給畫面用：這張牌要讓紙偶擺出哪個姿勢
    const pose = tribute ? 'sacrifice' : def.type === 'attack' ? 'attack' : def.type === 'blessing' ? 'blessing'
      : (def.effects || []).some((e) => e.type === 'block') ? 'block' : 'skill';
    emit(state, { type: 'act', uid: 'player', pose });

    if (def.sacrifice) {
      if (tribute) {
        removeFrom(state.hand, tribute);
        state.deckRemoved.push(tribute.uid);
        ctx.tributePaid = true;
        log(state, `獻祭了「${cardDef(state.idx, tribute).name}」`);
        await cardTrigger(state, tribute, 'sacrificed', { target });
      } else await runEffects(state, def.sacrifice.alt || [], ctx);
      await fire(state, 'sacrifice');
    }

    await runEffects(state, def.effects || [], ctx);

    if (def.type === 'blessing') {
      for (const p of def.powers || []) state.player.powers.push({ ...p, name: def.name });
    } else if (def.keywords?.exhaust) await exhaustCard(state, inst, null);
    else state.discard.push(inst);

    state.counters.played++;
    if (!over(state)) {
      await fire(state, 'playCard');
      if (def.type === 'attack') await fire(state, 'playAttack');
      if (def.type === 'skill') await fire(state, 'playSkill');
    }
  } finally { state.busy = false; }
  await state.tick();
  return true;
}

async function endOfTurnStatuses(state, actor) {
  for (const [id, n] of Object.entries(actor.statuses)) {
    const s = state.idx.statuses.get(id);
    if (!s || actor.dead) continue;
    if (s.tickDamage) {
      log(state, `${actor.name} 因「${s.name}」失去 ${s.tickDamage * n} 點生命`);
      await loseHp(state, actor, s.tickDamage * n);
    }
    if (s.decay === 'minus1') addStatus(state, actor, id, -1);
    else if (s.decay === 'clear') delete actor.statuses[id];
  }
}

async function startPlayerTurn(state) {
  state.turn++;
  state.phase = 'player';
  if (state.turn > 1) state.player.block = 0;
  state.player.energy = state.rules.energy;
  state.counters = { hpLost: 0, played: 0 };
  log(state, `── 第 ${state.turn} 回合 ──`);
  await fire(state, 'turnStart');
  if (!over(state)) await drawCards(state, state.rules.draw);
  await state.tick();
}

export async function endTurn(state) {
  if (state.phase !== 'player' || state.busy) return;
  state.busy = true;
  try {
    await fire(state, 'turnEnd');
    for (const inst of [...state.hand]) { if (over(state)) break; await cardTrigger(state, inst, 'turnEndInHand'); }
    if (over(state)) return;
    const keep = state.hand.filter((c) => cardDef(state.idx, c).keywords?.retain);
    state.discard.push(...state.hand.filter((c) => !keep.includes(c)));
    state.hand = keep;
    await endOfTurnStatuses(state, state.player);
    if (over(state)) return;

    state.phase = 'enemy';
    await state.tick();
    const delayId = [...state.idx.statuses.values()].find((s) => s.special === 'delay')?.id;
    for (const en of state.enemies) {
      if (en.dead) continue;
      en.block = 0;
      if (delayId && stacks(en, delayId) > 0) {
        addStatus(state, en, delayId, -1);
        if (!stacks(en, delayId)) en.delayImmune = true; // 延遲結束後，要先行動過一次才能再被延遲
        log(state, `${en.name} 的行動被延遲`);
      } else {
        log(state, `${en.name} 使出「${en.intent.name}」`);
        emit(state, { type: 'act', uid: en.uid, pose: (en.intent.effects || []).some((e) => e.type === 'damage') ? 'attack' : 'charge' });
        await runEffects(state, en.intent.effects || [], { source: en });
        en.delayImmune = false;
        advanceIntent(state, en);
        await state.tick();
      }
      if (over(state)) return;
      await endOfTurnStatuses(state, en);
      if (over(state)) return;
    }
    await startPlayerTurn(state);
  } finally { state.busy = false; await state.tick(); }
}

// 敵人意圖的摘要（給畫面顯示用）
export function intentSummary(state, en) {
  const out = [];
  const delayId = [...state.idx.statuses.values()].find((s) => s.special === 'delay')?.id;
  if (delayId && stacks(en, delayId) > 0) out.push({ kind: 'delay', text: `延遲 ${stacks(en, delayId)}` });
  for (const e of en.intent?.effects || []) {
    if (e.type === 'damage') {
      const d = calcAttack(state, en, state.player, amountOf(state, e, { source: en, target: state.player }));
      out.push({ kind: 'attack', text: (e.times || 1) > 1 ? `${d}×${e.times}` : `${d}` });
    } else if (e.type === 'block') out.push({ kind: 'block', text: '防禦' });
    else if (e.type === 'applyStatus') out.push({ kind: e.target === 'self' ? 'buff' : 'debuff', text: state.idx.statuses.get(e.status)?.name || '?' });
    else if (e.type === 'addCard') out.push({ kind: 'debuff', text: '塞牌' });
    else if (e.type === 'heal') out.push({ kind: 'buff', text: '回復' });
  }
  return out;
}
