// 積木定義：這個檔案描述引擎認得的所有「積木」。
// Studio 的表單、卡片說明文字、防呆檢查都由這裡自動產生。
// 要新增一種全新的效果時：在這裡加定義，並在 battle.js 的 EFFECTS 加上實作。

export const CARD_TYPES = { attack: '攻擊', skill: '技能', blessing: '祝福', status: '狀態', curse: '詛咒', tribute: '生贄' };
export const RARITIES = { starter: '初始', common: '普通', rare: '稀有', epic: '史詩', special: '特殊' };
export const REWARD_WEIGHTS = { common: 60, rare: 30, epic: 10 };
export const PUBLISH = { draft: '草稿', official: '正式' };

export const TARGETS = { enemy: '敵方單體', allEnemies: '所有敵人', randomEnemy: '隨機敵人', self: '自己' };
// 敵人使用同一套積木時，「敵方」指的就是玩家。
export const TARGETS_ENEMY_SIDE = { enemy: '玩家', self: '自己' };

export const ZONES = { hand: '手牌', draw: '抽牌堆', discard: '棄牌堆', deck: '牌組（永久）' };
export const PILES = { discard: '棄牌堆', draw: '抽牌堆', exhaust: '消耗區' };

// 數值加成來源（「每 1 點 X，額外 +N」）
export const SCALE_SOURCES = {
  block: '自身格擋',
  discard: '棄牌堆張數',
  draw: '抽牌堆張數',
  exhaust: '消耗區張數',
  hand: '手牌張數',
  hpLost: '本回合失去的生命',
  played: '本回合已打出的牌數',
  tributes: '牌組中的生贄數',
  // 另外還有 status:<狀態id>（自身層數）與 targetStatus:<狀態id>（目標層數），由 Studio 動態列出
};

// 欄位種類：number / target / status / card / scale / bool / zone / pile
export const EFFECTS = {
  damage: {
    label: '造成傷害', group: '戰鬥',
    fields: [
      { key: 'amount', type: 'number', label: '傷害', def: 6 },
      { key: 'target', type: 'target', label: '對象', def: 'enemy' },
      { key: 'times', type: 'number', label: '次數', def: 1, min: 1 },
      { key: 'scale', type: 'scale', label: '額外加成' },
      { key: 'lifesteal', type: 'bool', label: '吸血（回復等同未被格擋的傷害）' },
    ],
  },
  block: {
    label: '獲得格擋', group: '戰鬥',
    fields: [
      { key: 'amount', type: 'number', label: '格擋', def: 5 },
      { key: 'scale', type: 'scale', label: '額外加成' },
    ],
  },
  applyStatus: {
    label: '施加狀態', group: '戰鬥',
    fields: [
      { key: 'status', type: 'status', label: '狀態' },
      { key: 'amount', type: 'number', label: '層數', def: 1 },
      { key: 'target', type: 'target', label: '對象', def: 'enemy' },
    ],
  },
  heal: { label: '回復生命', group: '戰鬥', fields: [{ key: 'amount', type: 'number', label: '生命', def: 4 }] },
  loseHp: { label: '失去生命（無視格擋）', group: '戰鬥', fields: [{ key: 'amount', type: 'number', label: '生命', def: 3 }] },
  draw: { label: '抽牌', group: '資源', fields: [{ key: 'amount', type: 'number', label: '張數', def: 1 }] },
  energy: { label: '獲得能量', group: '資源', fields: [{ key: 'amount', type: 'number', label: '能量', def: 1 }] },
  scry: { label: '觀想（看抽牌堆頂，可棄置）', group: '牌堆', fields: [{ key: 'amount', type: 'number', label: '張數', def: 3 }] },
  discard: {
    label: '棄置手牌', group: '牌堆',
    fields: [{ key: 'amount', type: 'number', label: '張數', def: 1 }, { key: 'random', type: 'bool', label: '隨機' }],
  },
  exhaustCards: {
    label: '消耗手牌', group: '牌堆',
    fields: [{ key: 'amount', type: 'number', label: '張數', def: 1 }, { key: 'random', type: 'bool', label: '隨機' }],
  },
  retrieve: {
    label: '從牌堆取回手牌', group: '牌堆',
    fields: [{ key: 'amount', type: 'number', label: '張數', def: 1 }, { key: 'from', type: 'pile', label: '來源', def: 'discard' }],
  },
  addCard: {
    label: '生成卡片', group: '牌堆',
    fields: [
      { key: 'card', type: 'card', label: '卡片' },
      { key: 'count', type: 'number', label: '張數', def: 1, min: 1 },
      { key: 'zone', type: 'zone', label: '放到', def: 'discard' },
    ],
  },
  capture: {
    label: '捕捉（將敵人化為生贄）', group: '深淵',
    fields: [{ key: 'threshold', type: 'number', label: '敵人生命不高於', def: 10 }],
  },
};

export const CONDITIONS = {
  targetHasStatus: { label: '目標有狀態', fields: [{ key: 'status', type: 'status', label: '狀態' }] },
  selfHasStatus: { label: '自己有狀態', fields: [{ key: 'status', type: 'status', label: '狀態' }] },
  lostHpThisTurn: { label: '本回合曾失去生命', fields: [] },
  hasBlock: { label: '自己有格擋', fields: [] },
  discardGte: { label: '棄牌堆張數至少', fields: [{ key: 'n', type: 'number', label: '張數', def: 5 }] },
  playedGte: { label: '本回合已打出的牌數至少', fields: [{ key: 'n', type: 'number', label: '張數', def: 2 }] },
  hpBelowPct: { label: '自己生命不高於（%）', fields: [{ key: 'n', type: 'number', label: '%', def: 50 }] },
  targetHpLte: { label: '目標生命不高於', fields: [{ key: 'n', type: 'number', label: '生命', def: 10 }] },
  tributePaid: { label: '本次獻上了生贄', fields: [] },
};

// 祝福牌與遺物的觸發時機
export const TRIGGERS = {
  battleStart: '戰鬥開始時',
  turnStart: '每回合開始時',
  turnEnd: '每回合結束時',
  playCard: '每打出一張牌',
  playAttack: '每打出一張攻擊牌',
  playSkill: '每打出一張技能牌',
  selfHarm: '每當在自己回合失去生命',
  loseHp: '每當失去生命（任何時候）',
  sacrifice: '每當進行獻祭',
  exhaustCard: '每當有牌被消耗',
  discardCard: '每當有牌被棄置（回合結束除外）',
  shuffle: '每當洗牌',
  enemyDeath: '每當敵人死亡或被捕捉',
};

// 卡片自身的特殊時機
export const CARD_TRIGGERS = {
  sacrificed: '被獻祭時',
  discard: '被棄置時（回合結束除外）',
  exhaust: '被消耗時',
  drawn: '被抽到時',
  turnEndInHand: '回合結束時仍在手牌',
};

export const KEYWORDS = {
  exhaust: { label: '消耗', desc: '使用後在本場戰鬥中移除，不進棄牌堆。' },
  unplayable: { label: '不可打出', desc: '這張牌不能被打出。' },
  retain: { label: '保留', desc: '回合結束時不會被棄置。' },
};
export const DERIVED_KEYWORDS = {
  sacrifice: { label: '獻祭', desc: '打出時，永久失去手牌中的一張生贄；若無法獻祭時，必須支付代價。' },
  charge: { label: '充能', desc: '這張牌的傷害隨你的充能層數提高。' },
  bulwark: { label: '壁壘', desc: '這張牌的傷害隨你當前的格擋提高。' },
  capture: { label: '捕捉', desc: '把生命夠低的敵人化為「生贄」卡加入牌組。頭目無法捕捉。' },
  scry: { label: '觀想', desc: '查看抽牌堆頂的牌，並可將其中任意張棄置。' },
};

export const STATUS_DECAY = { none: '不消退', minus1: '回合結束減 1 層', clear: '回合結束全部清除' };
export const STATUS_KINDS = { buff: '增益', debuff: '減益' };
export const ENCOUNTER_POOLS = { easy: '前段', hard: '後段', boss: '頭目' };

export function newEffect(type) {
  const e = { type };
  for (const f of EFFECTS[type].fields) if (f.def !== undefined) e[f.key] = f.def;
  return e;
}

export function blankCard(id) {
  return {
    id, name: '新卡片', faction: 'nameless', type: 'skill', rarity: 'common', cost: 1,
    keywords: {}, sacrifice: null, effects: [], triggers: {}, powers: [],
    text: '', flavor: '', image: '', upgrade: null, publish: 'draft',
  };
}

// 紙偶姿勢。fallback：缺圖時依序改用哪個姿勢。
export const HERO_POSES = {
  idle: { label: '待機', when: '平時' },
  attack: { label: '攻擊', when: '打出攻擊牌', fallback: ['idle'] },
  block: { label: '格擋', when: '打出會獲得格擋的牌', fallback: ['idle'] },
  skill: { label: '技能', when: '打出其他技能牌', fallback: ['idle'] },
  blessing: { label: '祝福', when: '打出祝福牌', fallback: ['skill', 'idle'] },
  hitBlocked: { label: '受擊（無扣血）', when: '攻擊被格擋完全擋下', fallback: ['block', 'idle'] },
  hit: { label: '受擊（有扣血）', when: '失去生命', fallback: ['idle'] },
  sacrifice: { label: '獻祭', when: '獻祭了一張生贄', fallback: ['skill', 'idle'] },
  down: { label: '倒下', when: '戰敗', fallback: ['hit', 'idle'] },
};
export const ENEMY_POSES = {
  idle: { label: '待機', when: '平時' },
  attack: { label: '攻擊', when: '使出會造成傷害的招式', fallback: ['idle'] },
  charge: { label: '蓄力', when: '使出不造成傷害的招式', fallback: ['idle'] },
  hitBlocked: { label: '受擊（無扣血）', when: '攻擊被格擋完全擋下', fallback: ['idle'] },
  hit: { label: '受擊（有扣血）', when: '失去生命', fallback: ['idle'] },
};

// 卡框版面：各區域在卡面上的位置（x 為卡片寬度的 %，y 為卡片高度的 %）。
// 每個陣營的卡框可以在 Studio 微調，沒調整的項目用這裡的預設值。
export const CARD_RATIO = 1.5;
export const FRAME_LAYOUT = {
  art: { left: 13, top: 12, right: 87.5, bottom: 54.5 },
  cost: { x: 15.6, y: 7.9, size: 13 },
  // 名稱以 center 為中心（預設卡片中線）；left、right 是不能超過的範圍（例如避開封蠟）
  name: { left: 31, right: 88, center: 50, top: 6.4, bottom: 11.6 },
  text: { left: 12, right: 89, top: 61.2, bottom: 89.8 },
  gem: { x: 50, y: 54.4, size: 5.6 },
};
export const FRAME_PARTS = {
  art: { label: '卡圖', kind: 'box' }, name: { label: '名稱', kind: 'box' }, text: { label: '文字區', kind: 'box' },
  cost: { label: '費用', kind: 'point' },
};
export function frameLayout(fac) {
  const L = fac?.frame?.layout || {};
  const out = {};
  for (const [k, v] of Object.entries(FRAME_LAYOUT)) out[k] = { ...v, ...(L[k] || {}) };
  return out;
}

// 戰鬥場景的版面。三聯畫的設定跟著場景走；地板、教堂亮度、角色站位是所有場景共用（規則頁）。
export const TRI_LAYOUT = { x: 50, y: 0, width: 92, height: 64, wing: 28, bright: 62, gap: 2 };
export const STAGE_LAYOUT = { floorTop: 52, standLine: 61, floorDepth: 100, foreLift: 9, churchBright: 60, sidePad: 19 };
export const PART_LAYERS = { back: '最後方（三聯畫後面）', mid: '中間（三聯畫前、紙偶後）', front: '最前方（紙偶前面）' };
export const PART_MOTIONS = { none: '靜止', sway: '左右搖晃', bob: '上下浮動', spin: '緩慢旋轉', drift: '左右漂移', jitter: '顫抖', flicker: '閃爍' };
export const newPart = () => ({ img: '', layer: 'mid', x: 50, y: 30, size: 12, rot: 0, flip: false, opacity: 100, motion: 'sway', speed: 3, amp: 6 });

// 畫面明暗（規則頁可調）：整體亮度、暗角、卡片亮度、燭光閃爍
export const MOOD = { bright: 70, vignette: 78, cards: 84, flicker: true };
