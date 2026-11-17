// 由積木自動產生卡片說明文字，確保敘述永遠和實際效果一致。
import { TRIGGERS, CARD_TRIGGERS, SCALE_SOURCES, KEYWORDS, DERIVED_KEYWORDS, CONDITIONS } from './schema.js';

const sName = (idx, id) => `〈${idx.statuses.get(id)?.name || '？'}〉`;
const cName = (idx, id) => `「${idx.cards.get(id)?.name || '？'}」`;

export function scaleLabel(idx, by) {
  if (!by) return '';
  if (by.startsWith('status:')) return `自身${sName(idx, by.slice(7))}層數`;
  if (by.startsWith('targetStatus:')) return `目標${sName(idx, by.slice(13))}層數`;
  return SCALE_SOURCES[by] || by;
}
const scaleText = (idx, sc) => (sc?.by ? `（每 1 點${scaleLabel(idx, sc.by)}額外 +${sc.per ?? 1}）` : '');

function condText(idx, c) {
  switch (c.type) {
    case 'targetHasStatus': return `若目標有${sName(idx, c.status)}`;
    case 'selfHasStatus': return `若你有${sName(idx, c.status)}`;
    case 'lostHpThisTurn': return '若本回合曾失去生命';
    case 'hasBlock': return '若你有格擋';
    case 'discardGte': return `若棄牌堆至少有 ${c.n} 張牌`;
    case 'playedGte': return `若本回合已打出至少 ${c.n} 張牌`;
    case 'hpBelowPct': return `若生命不高於 ${c.n}%`;
    case 'targetHpLte': return `若目標生命不高於 ${c.n}`;
    case 'tributePaid': return '若獻祭了生贄';
    default: return CONDITIONS[c.type]?.label || '';
  }
}

// side: 'player'（卡片、遺物）或 'enemy'（敵人招式）
export function effectText(idx, e, side = 'player') {
  const tgt = e.target || 'enemy';
  const foe = side === 'enemy' ? '玩家' : '';
  const to = tgt === 'allEnemies' ? '對所有敵人' : tgt === 'randomEnemy' ? '對隨機敵人' : tgt === 'self' ? '對自己' : foe ? `對${foe}` : '';
  let t = '';
  switch (e.type) {
    case 'damage':
      t = `${to}造成 ${e.amount ?? 0} 點傷害${(e.times || 1) > 1 ? ` ${e.times} 次` : ''}${scaleText(idx, e.scale)}${e.lifesteal ? '，並回復等同未被格擋傷害的生命' : ''}`; break;
    case 'block': t = `獲得 ${e.amount ?? 0} 點格擋${scaleText(idx, e.scale)}`; break;
    case 'applyStatus': {
      const n = e.amount ?? 1;
      if (tgt === 'self') t = n < 0 ? `失去 ${-n} 層${sName(idx, e.status)}` : `獲得 ${n} 層${sName(idx, e.status)}`;
      else t = `${to}施加 ${n} 層${sName(idx, e.status)}`;
      break;
    }
    case 'heal': t = `回復 ${e.amount} 點生命`; break;
    case 'loseHp': t = `失去 ${e.amount} 點生命`; break;
    case 'draw': t = `抽 ${e.amount} 張牌`; break;
    case 'energy': t = `獲得 ${e.amount} 點能量`; break;
    case 'scry': t = `觀想 ${e.amount}`; break;
    case 'discard': t = `${e.random ? '隨機' : ''}棄置 ${e.amount} 張手牌`; break;
    case 'exhaustCards': t = `${e.random ? '隨機' : ''}消耗 ${e.amount} 張手牌`; break;
    case 'retrieve': t = `從${{ discard: '棄牌堆', draw: '抽牌堆', exhaust: '消耗區' }[e.from || 'discard']}選 ${e.amount} 張牌加入手牌`; break;
    case 'addCard': {
      const z = { hand: '手牌', draw: '抽牌堆', discard: '棄牌堆', deck: '牌組（永久）' }[e.zone || 'discard'];
      t = `將 ${e.count || 1} 張${cName(idx, e.card)}加入${side === 'enemy' ? '玩家的' : ''}${z}`; break;
    }
    case 'capture': t = `捕捉生命不高於 ${e.threshold} 的敵人`; break;
    default: t = '（未知效果）';
  }
  return e.if?.type ? `${condText(idx, e.if)}，${t}` : t;
}

export const effectsText = (idx, list, side) => (list || []).map((e) => effectText(idx, e, side)).join('，');

export function describeCard(idx, def) {
  if (def.text) return def.text;
  const lines = [];
  const kw = def.keywords || {};
  const head = ['unplayable', 'retain'].filter((k) => kw[k]).map((k) => KEYWORDS[k].label + '。').join('');
  if (head) lines.push(head);
  if (def.sacrifice) {
    const alt = effectsText(idx, def.sacrifice.alt);
    lines.push(`獻祭${alt ? `（或改為：${alt}）` : ''}。`);
  }
  if (def.effects?.length) for (const e of def.effects) lines.push(effectText(idx, e) + '。');
  for (const p of def.powers || []) lines.push(`${TRIGGERS[p.trigger] || '？'}，${effectsText(idx, p.effects)}。`);
  for (const [k, fx] of Object.entries(def.triggers || {})) if (fx?.length) lines.push(`${CARD_TRIGGERS[k]}：${effectsText(idx, fx)}。`);
  if (kw.exhaust) lines.push('消耗。');
  return lines.join('\n');
}

export function describePowers(idx, powers) {
  return (powers || []).map((p) => `${TRIGGERS[p.trigger] || '？'}，${effectsText(idx, p.effects)}。`).join('\n');
}

// 卡片上出現的關鍵字（給說明浮窗用）
export function keywordsOf(idx, def) {
  const out = [];
  const all = [...(def.effects || []), ...(def.sacrifice?.alt || []), ...(def.powers || []).flatMap((p) => p.effects || []), ...Object.values(def.triggers || {}).flat()];
  if (def.sacrifice) out.push(DERIVED_KEYWORDS.sacrifice);
  if (all.some((e) => e.scale?.by === 'status:charge')) out.push(DERIVED_KEYWORDS.charge);
  if (all.some((e) => e.type === 'damage' && e.scale?.by === 'block')) out.push(DERIVED_KEYWORDS.bulwark);
  if (all.some((e) => e.type === 'capture')) out.push(DERIVED_KEYWORDS.capture);
  if (all.some((e) => e.type === 'scry')) out.push(DERIVED_KEYWORDS.scry);
  for (const k of Object.keys(KEYWORDS)) if (def.keywords?.[k]) out.push(KEYWORDS[k]);
  const seen = new Set();
  for (const e of all) {
    const ids = [e.status, e.if?.status, e.scale?.by?.split(':')[1]].filter(Boolean);
    for (const id of ids) {
      const s = idx.statuses.get(id);
      if (s && !seen.has(id)) { seen.add(id); out.push({ label: s.name, desc: s.desc || '' }); }
    }
  }
  return out;
}
