// 戰鬥畫面：遊戲本體與 Studio 試玩沙盒共用。
// 紙偶是常駐的元素（不會每次重畫），其餘資訊在每次狀態改變後重畫。
import { h, fill, cardEl, cardBackEl, modal, sleep, showCards } from './common.js';
import { createBattle, startBattle, playCard, endTurn, canPlay, cardDef, needsTarget, intentSummary } from '../engine/battle.js';
import { effectsText, describePowers } from '../engine/describe.js';
import { HERO_POSES, ENEMY_POSES } from '../engine/schema.js';
import { makePuppet } from './puppet.js';
import { makeScene } from './scene.js';
import { imgUrl } from './store.js';

const INTENT_ICON = { attack: '⚔', block: '⛨', buff: '▲', debuff: '▼', delay: '⏳' };
// 墨漬狀的爆裂圖形（受擊時顯示）
const SPLAT = '<svg viewBox="0 0 100 100"><path d="M50 3 L58 30 L82 12 L70 38 L98 42 L72 54 L92 78 L64 68 L60 97 L48 70 L26 92 L34 64 L4 62 L30 48 L10 22 L40 34 Z"/></svg>';

export function runBattle(root, idx, opts) {
  return new Promise((resolve) => {
    let selected = null, done = false, showLog = false, animating = false;
    const fx = idx.rules.fx || {};
    const closeup = fx.closeup !== false, paperEdge = fx.paperEdge !== false;

    const choose = (req) => new Promise((res) => {
      if (req.type === 'sacrifice') {
        const alt = effectsText(idx, req.alt);
        const m = modal('獻祭：選擇一張生贄', h('div', {},
          h('p', { class: 'dim', style: { textAlign: 'center', margin: 0 } }, '被獻祭的生贄會永久離開牌組，並觸發它自己的額外效果。'),
          h('div', { class: 'card-pick' }, req.tributes.map((c) => { const el = cardEl(idx, c, { width: 170 }); el.onclick = () => { m.close(); res(c.uid); }; return el; })),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            h('button', { class: 'btn ghost', onclick: () => { m.close(); res('cancel'); } }, '取消出牌'),
            h('button', { class: 'btn', onclick: () => { m.close(); res(null); } }, alt ? `不獻祭，支付代價：${alt}` : '不獻祭'))), { closable: false });
        return;
      }
      const picked = new Set();
      const ok = h('button', { class: 'btn primary' }, '確定');
      const refresh = () => { ok.disabled = picked.size < req.min || picked.size > req.max; };
      const m = modal(req.title, h('div', {},
        h('p', { class: 'dim small', style: { textAlign: 'center', margin: 0 } }, req.min === req.max ? `請選 ${req.min} 張` : `可選 ${req.min}～${req.max} 張`),
        h('div', { class: 'card-pick' }, req.cards.map((c) => {
          const el = cardEl(idx, c, { width: 170 });
          el.onclick = () => {
            if (picked.has(c.uid)) picked.delete(c.uid);
            else { if (req.max === 1) { picked.clear(); m.box.querySelectorAll('.picked').forEach((x) => x.classList.remove('picked')); } if (picked.size >= req.max) return; picked.add(c.uid); }
            el.classList.toggle('picked', picked.has(c.uid)); refresh();
          };
          return el;
        })),
        h('div', { class: 'row', style: { justifyContent: 'center' } }, ok)), { closable: false });
      ok.onclick = () => { m.close(); res([...picked]); };
      refresh();
    });

    const tick = async () => { await playEvents(); render(); };
    const state = createBattle(idx, { ...opts, choose, tick });

    // ── 常駐的舞台 ──
    const floatLayer = h('div', { class: 'float-layer' });
    const stage = h('div', { class: 'battle-stage' }, h('div', { class: 'stage-dim' }));
    const enemiesEl = h('div', { class: 'enemies' });
    const hintEl = h('div', { class: 'hint' });
    const bottomEl = h('div', { class: 'battle-bottom' });
    const logEl = h('div', { class: 'battle-log panel' });
    const scene = makeScene(idx, opts.scene);
    const battleEl = h('div', { class: 'battle' }, scene.el, stage, hintEl, bottomEl, logEl, floatLayer);
    const actors = new Map();

    function makeActor(a, def, isPlayer) {
      const puppet = makePuppet({
        name: a.name, poses: isPlayer ? opts.player.poses : def?.poses, defs: isPlayer ? HERO_POSES : ENEMY_POSES,
        side: isPlayer ? 'left' : 'right', color: isPlayer ? (opts.player.color || '#8c7a5e') : '#7a3a34', paperEdge, boss: !!a.boss,
      });
      const intent = h('div', { class: 'intent' }), info = h('div', { class: 'actor-info' });
      const el = h('div', { class: `actor ${isPlayer ? 'player' : 'enemy'}${a.boss ? ' boss' : ''}`, 'data-uid': a.uid, onclick: isPlayer ? null : () => onEnemy(a) },
        isPlayer ? null : intent, puppet.el, info);
      const rec = { el, puppet, intent, info, actor: a };
      actors.set(a.uid, rec);
      return rec;
    }
    stage.append(makeActor(state.player, null, true).el, enemiesEl);
    for (const en of state.enemies) enemiesEl.append(makeActor(en, idx.enemies.get(en.defId), false).el);
    fill(root, battleEl);

    const statusChips = (actor) => Object.entries(actor.statuses).map(([id, n]) => {
      const s = idx.statuses.get(id);
      if (!s) return null;
      const icon = imgUrl(s.image);
      return icon ? h('span', { class: `chip icon ${s.kind}`, title: `${s.name}：${s.desc || ''}` }, h('img', { src: icon, alt: s.name }), h('b', {}, n))
        : h('span', { class: `chip ${s.kind}`, title: s.desc || '' }, `${s.name} ${n}`);
    });
    const hpBar = (a) => h('div', { class: 'hpbar' },
      h('div', { class: 'hpfill', style: { width: `${Math.max(0, (a.hp / a.maxHp) * 100)}%` } }),
      h('span', {}, `${a.hp} / ${a.maxHp}`));

    async function onCard(inst) {
      if (animating || state.busy || state.phase !== 'player' || !canPlay(state, inst)) return;
      const al = state.enemies.filter((e) => !e.dead);
      if (needsTarget(cardDef(idx, inst)) && al.length > 1) { selected = selected === inst.uid ? null : inst.uid; render(); return; }
      selected = null;
      await playCard(state, inst.uid, al[0]?.uid);
      render();
    }
    async function onEnemy(en) {
      if (!selected || animating || state.busy || en.dead) return;
      const u = selected; selected = null;
      await playCard(state, u, en.uid);
      render();
    }

    function render() {
      const p = state.player, my = state.phase === 'player' && !state.busy && !animating;
      const sorted = (pile) => [...pile].sort((a, b) => a.id.localeCompare(b.id));
      battleEl.classList.toggle('targeting', !!selected);
      fill(actors.get('player').info,
        h('div', { class: 'actor-name' }, p.name), hpBar(p),
        h('div', { class: 'chips' }, p.block ? h('span', { class: 'chip block' }, `格擋 ${p.block}`) : null, statusChips(p)),
        h('div', { class: 'chips' }, p.powers.map((pw) => h('span', { class: 'chip power' + (pw.relic ? ' relic' : ''), title: describePowers(idx, [pw]) }, pw.image && imgUrl(pw.image) ? h('img', { class: 'chip-img', src: imgUrl(pw.image), alt: '' }) : (pw.relic ? '◈ ' : '✦ '), pw.name))));
      for (const en of state.enemies) {
        const rec = actors.get(en.uid);
        if (!rec || en.dead) continue;
        rec.intent.title = `下一步：${en.intent.name}\n${effectsText(idx, en.intent.effects, 'enemy')}`;
        fill(rec.intent, intentSummary(state, en).map((i) => h('span', { class: 'intent-' + i.kind }, `${INTENT_ICON[i.kind]} ${i.text}`)));
        fill(rec.info, h('div', { class: 'actor-name' }, en.name), hpBar(en),
          h('div', { class: 'chips' }, en.block ? h('span', { class: 'chip block' }, `格擋 ${en.block}`) : null, statusChips(en)));
      }
      hintEl.textContent = selected ? '請點選一個敵人作為目標（再點一次卡片可取消）' : '';
      fill(bottomEl,
        h('div', { class: 'side' },
          h('div', { class: 'energy', title: '能量' }, `${p.energy}`, h('small', {}, `/${state.rules.energy}`)),
          h('div', { class: 'pile' }, cardBackEl(idx, opts.player.faction), h('button', { class: 'btn sm ghost grow', onclick: () => showCards(idx, '抽牌堆', sorted(state.draw), '順序已打亂顯示') }, `抽牌堆 ${state.draw.length}`))),
        h('div', { class: 'hand' }, state.hand.map((inst) => {
          const el = cardEl(idx, inst, { width: 180, class: (my && canPlay(state, inst) ? 'playable' : 'dimmed') + (selected === inst.uid ? ' selected' : '') });
          el.onclick = () => onCard(inst);
          return el;
        })),
        h('div', { class: 'side' },
          h('button', { class: 'btn primary', disabled: !my, onclick: async () => { selected = null; await endTurn(state); render(); } }, state.phase === 'enemy' ? '敵方回合…' : '結束回合'),
          h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, '棄牌堆', state.discard) }, `棄牌堆 ${state.discard.length}`),
          h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, '消耗區', state.exhaust) }, `消耗區 ${state.exhaust.length}`),
          h('button', { class: 'btn sm ghost', onclick: () => { showLog = !showLog; render(); } }, showLog ? '收起紀錄' : '戰鬥紀錄')));
      logEl.hidden = !showLog;
      if (showLog) { fill(logEl, state.log.slice(-40).map((l) => h('div', {}, l))); logEl.scrollTop = logEl.scrollHeight; }
      if (!done && !animating && (state.phase === 'won' || state.phase === 'lost')) { done = true; setTimeout(() => { if (state.phase === 'won') scene.close(); setTimeout(() => resolve(state), state.phase === 'won' ? 1300 : 0); }, 700); }
    }

    // ── 浮動文字與爆裂圖形 ──
    const offs = {};
    function floater(uid, text, cls, splat = false) {
      const rec = actors.get(uid); if (!rec || !rec.el.isConnected) return;
      const base = battleEl.getBoundingClientRect(), r = rec.puppet.el.getBoundingClientRect();
      const n = (offs[uid] = ((offs[uid] || 0) + 1) % 5);
      const x = r.left - base.left + r.width / 2 + (splat ? (n % 2 ? 34 : -30) : 0), y = r.top - base.top + (splat ? 70 + n * 26 : 10 + n * 24);
      const f = splat ? h('div', { class: 'splat', style: { left: `${x}px`, top: `${y}px`, '--rot': `${(n * 47) % 60 - 30}deg` } }, h('div', { html: SPLAT, class: 'splat-ink' }), h('b', {}, text))
        : h('div', { class: 'floater ' + cls, style: { left: `${x}px`, top: `${y}px` } }, text);
      floatLayer.append(f);
      setTimeout(() => f.remove(), splat ? 900 : 1100);
    }

    // ── 依事件演出：出手特寫 → 命中 → 回到待機 ──
    async function playEvents() {
      const evs = state.events.splice(0);
      if (!evs.length) return;
      animating = true;
      const segs = [{ act: null, evs: [] }];
      for (const ev of evs) { if (ev.type === 'act') segs.push({ act: ev, evs: [] }); else segs[segs.length - 1].evs.push(ev); }
      for (const seg of segs) {
        if (!seg.act && !seg.evs.length) continue;
        const actor = seg.act && actors.get(seg.act.uid);
        const touched = new Set();
        if (actor) {
          touched.add(actor);
          if (closeup) { stage.classList.add('spot'); actor.el.classList.add('focus'); }
          await actor.puppet.setPose(seg.act.pose);
          actor.puppet.play({ attack: 'lunge', charge: 'raise', blessing: 'raise', sacrifice: 'raise', block: 'nudge', skill: 'nudge' }[seg.act.pose] || 'nudge');
          await sleep(170);
        }
        const struck = new Set(), dying = [];
        for (const ev of seg.evs) {
          const rec = actors.get(ev.uid);
          if (ev.type === 'struck' && rec) {
            struck.add(ev.uid); touched.add(rec);
            if (closeup && actor) rec.el.classList.add('lit');
            rec.puppet.setPose(ev.blocked ? 'hitBlocked' : 'hit');
            rec.puppet.play(ev.blocked ? 'nudge' : 'recoil');
          } else if (ev.type === 'hp') {
            if (ev.amount < 0 && struck.has(ev.uid)) floater(ev.uid, String(-ev.amount), '', true);
            else {
              floater(ev.uid, (ev.amount > 0 ? '+' : '') + ev.amount, ev.amount > 0 ? 'heal' : 'hurt');
              // 自損或狀態扣血：只翻面換姿勢，不後仰
              if (ev.amount < 0 && rec) { touched.add(rec); rec.puppet.setPose('hit'); }
            }
          } else if (ev.type === 'block') floater(ev.uid, ev.amount > 0 ? `格擋 +${ev.amount}` : `擋下 ${-ev.amount}`, 'blk');
          else if (ev.type === 'status') floater(ev.uid, ev.text, 'st');
          else if (ev.type === 'die' && rec) dying.push(rec);
        }
        if (seg.evs.length || actor) await sleep(actor ? 360 : 260);
        stage.classList.remove('spot');
        for (const rec of touched) {
          rec.el.classList.remove('focus', 'lit');
          if (!dying.includes(rec)) rec.puppet.setPose('idle');
        }
        for (const rec of dying) {
          if (rec.actor.isPlayer) { await rec.puppet.setPose('down'); continue; }
          rec.puppet.play('fall').then(() => { rec.el.remove(); actors.delete(rec.actor.uid); });
        }
        if (dying.length) await sleep(300);
      }
      animating = false;
    }

    render();
    setTimeout(() => scene.open(), 250);
    startBattle(state).then(render);
  });
}
