// 防呆檢查：找出缺漏、壞掉的引用與可疑的數值。error = 一定要修；warn = 建議再看一眼。
import { EFFECTS, CONDITIONS, TRIGGERS, REWARD_WEIGHTS } from './schema.js';

export function validate(raw) {
  const out = [];
  const add = (level, kind, id, name, msg) => out.push({ level, kind, id, name, msg });
  const ids = (arr) => new Set((arr || []).map((x) => x.id));
  const cards = ids(raw.cards), statuses = ids(raw.statuses), enemies = ids(raw.enemies), relics = ids(raw.relics), factions = ids(raw.factions);
  const official = (arr) => new Set((arr || []).filter((x) => x.publish === 'official').map((x) => x.id));
  const offCards = official(raw.cards), offEnemies = official(raw.enemies);

  for (const [kind, arr] of Object.entries({ card: raw.cards, character: raw.characters, enemy: raw.enemies, status: raw.statuses, relic: raw.relics, encounter: raw.encounters })) {
    const seen = new Set();
    for (const x of arr || []) {
      if (seen.has(x.id)) add('error', kind, x.id, x.name, '代號重複');
      seen.add(x.id);
      if (!x.name?.trim()) add('error', kind, x.id, x.name, '沒有名稱');
    }
  }

  const checkEffects = (kind, x, list, label) => {
    for (const e of list || []) {
      if (!EFFECTS[e.type]) { add('error', kind, x.id, x.name, `${label}：有無法辨識的效果`); continue; }
      if (e.type === 'applyStatus' && !statuses.has(e.status)) add('error', kind, x.id, x.name, `${label}：「施加狀態」沒有選擇狀態，或狀態已被刪除`);
      if (e.type === 'addCard' && !cards.has(e.card)) add('error', kind, x.id, x.name, `${label}：「生成卡片」沒有選擇卡片，或卡片已被刪除`);
      if (e.type === 'addCard' && x.publish === 'official' && cards.has(e.card) && !offCards.has(e.card)) add('warn', kind, x.id, x.name, `${label}：正式內容生成了一張草稿卡片`);
      if (e.if?.type && !CONDITIONS[e.if.type]) add('error', kind, x.id, x.name, `${label}：有無法辨識的條件`);
      if (e.if?.status !== undefined && !statuses.has(e.if.status)) add('error', kind, x.id, x.name, `${label}：條件裡的狀態不存在`);
      const by = e.scale?.by || '';
      if (by.includes(':') && !statuses.has(by.split(':')[1])) add('error', kind, x.id, x.name, `${label}：加成來源的狀態不存在`);
      for (const k of ['amount', 'times', 'count', 'threshold']) if (e[k] !== undefined && !Number.isFinite(Number(e[k]))) add('error', kind, x.id, x.name, `${label}：數值不是數字`);
    }
  };

  for (const c of raw.cards || []) {
    if (!factions.has(c.faction)) add('error', 'card', c.id, c.name, '陣營不存在');
    const variants = [['', c], ...(c.upgrade ? [['升級版', { ...c, ...c.upgrade }]] : [])];
    for (const [tag, v] of variants) {
      const L = (s) => (tag ? `${tag}・${s}` : s);
      checkEffects('card', c, v.effects, L('打出效果'));
      checkEffects('card', c, v.sacrifice?.alt, L('獻祭的代價'));
      for (const p of v.powers || []) {
        if (!TRIGGERS[p.trigger]) add('error', 'card', c.id, c.name, L('祝福效果沒有選擇時機'));
        checkEffects('card', c, p.effects, L('祝福效果'));
      }
      for (const fx of Object.values(v.triggers || {})) checkEffects('card', c, fx, L('特殊時機'));
      const unplayable = v.cost < 0 || v.keywords?.unplayable;
      const fx = v.effects || [];
      if (unplayable && fx.length) add('warn', 'card', c.id, c.name, L('不可打出的牌設定了打出效果，永遠不會生效'));
      if (!unplayable && !fx.length && !(v.powers || []).length && !v.sacrifice && ['attack', 'skill', 'blessing'].includes(c.type)) add('warn', 'card', c.id, c.name, L('這張牌打出後沒有任何效果'));
      if (c.type === 'blessing' && !(v.powers || []).length && !fx.length) add('error', 'card', c.id, c.name, L('祝福牌沒有設定持續效果'));
      if (v.sacrifice && !(v.sacrifice.alt || []).length) add('warn', 'card', c.id, c.name, L('獻祭沒有設定代價，手上沒有生贄時等於免費'));
      const sum = (t) => fx.filter((e) => e.type === t && !e.if?.type).reduce((s, e) => s + (Number(e.amount) || 0) * (e.times || 1), 0);
      const cost = Math.max(0, v.cost);
      if (!unplayable && !v.keywords?.exhaust && sum('energy') > cost && !v.sacrifice && !sum('loseHp')) add('warn', 'card', c.id, c.name, L('淨賺能量且不會消耗，可能造成無限循環'));
      if (!unplayable && cost === 0 && sum('draw') >= 2 && !v.keywords?.exhaust && !v.sacrifice && !sum('loseHp')) add('warn', 'card', c.id, c.name, L('0 費抽 2 張以上且沒有代價，可能造成無限循環'));
      if (sum('damage') > 14 * (cost + 1)) add('warn', 'card', c.id, c.name, L(`傷害（${sum('damage')}）相對費用偏高`));
      if (sum('block') > 12 * (cost + 1)) add('warn', 'card', c.id, c.name, L(`格擋（${sum('block')}）相對費用偏高`));
    }
    if (REWARD_WEIGHTS[c.rarity] && ['status', 'curse', 'tribute'].includes(c.type)) add('warn', 'card', c.id, c.name, '狀態／詛咒／生贄牌的稀有度建議設為「特殊」，否則會出現在戰鬥獎勵裡');
  }

  for (const ch of raw.characters || []) {
    if (!factions.has(ch.faction)) add('error', 'character', ch.id, ch.name, '陣營不存在');
    if (!(ch.hp > 0)) add('error', 'character', ch.id, ch.name, '初始生命必須大於 0');
    const size = raw.rules?.deckSize || 10;
    if ((ch.deck || []).length !== size) add('warn', 'character', ch.id, ch.name, `初始牌組是 ${(ch.deck || []).length} 張（規則設定為 ${size} 張）`);
    for (const id of ch.deck || []) {
      if (!cards.has(id)) add('error', 'character', ch.id, ch.name, `初始牌組裡有不存在的卡片（${id}）`);
      else if (ch.publish === 'official' && !offCards.has(id)) add('warn', 'character', ch.id, ch.name, '正式角色的初始牌組裡有草稿卡片');
    }
    if (ch.relic && !relics.has(ch.relic)) add('error', 'character', ch.id, ch.name, '初始遺物不存在');
  }

  for (const en of raw.enemies || []) {
    if (!(en.hp?.[0] > 0) || en.hp[1] < en.hp[0]) add('error', 'enemy', en.id, en.name, '生命範圍不正確');
    if (!(en.moves || []).length) add('error', 'enemy', en.id, en.name, '沒有任何招式');
    for (const m of en.moves || []) checkEffects('enemy', en, m.effects, `招式「${m.name}」`);
  }

  for (const r of raw.relics || []) for (const p of r.powers || []) {
    if (!TRIGGERS[p.trigger]) add('error', 'relic', r.id, r.name, '沒有選擇觸發時機');
    checkEffects('relic', r, p.effects, '效果');
  }

  for (const enc of raw.encounters || []) {
    if (!(enc.enemies || []).length) add('error', 'encounter', enc.id, enc.name, '沒有敵人');
    for (const id of enc.enemies || []) {
      if (!enemies.has(id)) add('error', 'encounter', enc.id, enc.name, `有不存在的敵人（${id}）`);
      else if (enc.publish === 'official' && !offEnemies.has(id)) add('warn', 'encounter', enc.id, enc.name, '正式遭遇裡有草稿敵人，遊戲中不會出現這場遭遇');
    }
  }
  const scenes = ids(raw.scenes);
  for (const enc of raw.encounters || []) if (enc.scene && !scenes.has(enc.scene)) add('error', 'encounter', enc.id, enc.name, '指定的場景不存在');
  for (const [pool, id] of Object.entries(raw.rules?.sceneByPool || {})) if (id && !scenes.has(id)) add('error', 'rules', 'rules', '規則', '戰鬥場景的階段預設指向不存在的場景');
  for (const s of raw.rules?.stages || []) {
    if (s.type !== 'battle') continue;
    if (!(raw.encounters || []).some((e) => e.pool === s.pool && e.publish === 'official')) add('error', 'rules', 'rules', '規則', `關卡流程需要「${s.pool}」的遭遇，但沒有任何正式遭遇`);
  }
  for (const t of raw.rules?.captureTiers || []) if (!cards.has(t.card)) add('error', 'rules', 'rules', '規則', '捕捉分級指定的生贄卡不存在');
  return out;
}
