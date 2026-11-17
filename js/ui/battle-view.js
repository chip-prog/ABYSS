// 戰鬥畫面：遊戲本體與 Studio 試玩沙盒共用。
import { h, cardEl, modal, sleep, showCards } from './common.js';
import { createBattle, startBattle, playCard, endTurn, canPlay, cardDef, needsTarget, intentSummary } from '../engine/battle.js';
import { effectsText, describePowers } from '../engine/describe.js';

const INTENT_ICON = { attack: '⚔', block: '⛨', buff: '▲', debuff: '▼', delay: '⏳' };

export function runBattle(root, idx, opts) {
  return new Promise((resolve) => {
    let selected = null, done = false, showLog = false;
    const floatLayer = h('div', { class: 'float-layer' });

    const choose = (req) => new Promise((res) => {
      if (req.type === 'sacrifice') {
        const alt = effectsText(idx, req.alt);
        const m = modal(`獻祭：選擇一張生贄`, h('div', {},
          h('p', { class: 'dim', style: { textAlign: 'center', margin: 0 } }, '被獻祭的生贄會永久離開牌組，並觸發它自己的額外效果。'),
          h('div', { class: 'card-pick' }, req.tributes.map((c) => { const el = cardEl(idx, c, { width: 150 }); el.onclick = () => { m.close(); res(c.uid); }; return el; })),
          h('div', { class: 'row', style: { justifyContent: 'center' } },
            h('button', { class: 'btn ghost', onclick: () => { m.close(); res('cancel'); } }, '取消出牌'),
            h('button', { class: 'btn', onclick: () => { m.close(); res(null); } }, alt ? `不獻祭生贄，改為：${alt}` : '不獻祭生贄'))), { closable: false });
        return;
      }
      const picked = new Set();
      const ok = h('button', { class: 'btn primary' }, '確定');
      const refresh = () => { ok.disabled = picked.size < req.min || picked.size > req.max; };
      const m = modal(req.title, h('div', {},
        h('p', { class: 'dim small', style: { textAlign: 'center', margin: 0 } }, req.min === req.max ? `請選 ${req.min} 張` : `可選 ${req.min}～${req.max} 張`),
        h('div', { class: 'card-pick' }, req.cards.map((c) => {
          const el = cardEl(idx, c, { width: 150 });
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

    const tick = async () => { render(); if (state.phase === 'enemy') await sleep(420); };
    const state = createBattle(idx, { ...opts, choose, tick });

    const statusChips = (actor) => Object.entries(actor.statuses).map(([id, n]) => {
      const s = idx.statuses.get(id);
      return s ? h('span', { class: `chip ${s.kind}`, title: s.desc || '' }, `${s.name} ${n}`) : null;
    });
    const hpBar = (a) => h('div', { class: 'hpbar' },
      h('div', { class: 'hpfill', style: { width: `${Math.max(0, (a.hp / a.maxHp) * 100)}%` } }),
      h('span', {}, `${a.hp} / ${a.maxHp}`));
    const medal = (name, image, cls) => h('div', { class: 'medal ' + cls }, image ? h('img', { src: image, alt: '' }) : h('span', {}, [...name][0] || '？'));

    async function onCard(inst) {
      if (state.busy || state.phase !== 'player') return;
      if (!canPlay(state, inst)) return;
      const al = state.enemies.filter((e) => !e.dead);
      if (needsTarget(cardDef(idx, inst)) && al.length > 1) { selected = selected === inst.uid ? null : inst.uid; render(); return; }
      selected = null;
      await playCard(state, inst.uid, al[0]?.uid);
      render();
    }
    async function onEnemy(en) {
      if (!selected || state.busy) return;
      const u = selected; selected = null;
      await playCard(state, u, en.uid);
      render();
    }

    function render() {
      const p = state.player;
      const my = state.phase === 'player' && !state.busy;
      const sorted = (pile) => [...pile].sort((a, b) => a.id.localeCompare(b.id));
      root.replaceChildren(h('div', { class: 'battle' + (selected ? ' targeting' : '') },
        h('div', { class: 'battle-stage' },
          h('div', { class: 'actor player', 'data-uid': 'player' },
            medal(p.name, opts.player.image, 'hero'),
            h('div', { class: 'actor-name' }, p.name),
            hpBar(p),
            h('div', { class: 'chips' }, p.block ? h('span', { class: 'chip block' }, `格擋 ${p.block}`) : null, statusChips(p)),
            h('div', { class: 'chips' }, p.powers.map((pw) => h('span', { class: 'chip power' + (pw.relic ? ' relic' : ''), title: describePowers(idx, [pw]) }, (pw.relic ? '◈ ' : '✦ ') + pw.name)))),
          h('div', { class: 'enemies' }, state.enemies.filter((e) => !e.dead).map((en) => {
            const def = idx.enemies.get(en.defId);
            return h('div', { class: 'actor enemy' + (en.acting ? ' acting' : '') + (en.boss ? ' boss' : ''), 'data-uid': en.uid, onclick: () => onEnemy(en) },
              h('div', { class: 'intent', title: `下一步：${en.intent.name}\n${effectsText(idx, en.intent.effects, 'enemy')}` },
                intentSummary(state, en).map((i) => h('span', { class: 'intent-' + i.kind }, `${INTENT_ICON[i.kind]} ${i.text}`))),
              medal(en.name, def?.image, 'foe'),
              h('div', { class: 'actor-name' }, en.name),
              hpBar(en),
              h('div', { class: 'chips' }, en.block ? h('span', { class: 'chip block' }, `格擋 ${en.block}`) : null, statusChips(en)));
          }))),
        selected ? h('div', { class: 'hint' }, '請點選一個敵人作為目標（再點一次卡片可取消）') : null,
        h('div', { class: 'battle-bottom' },
          h('div', { class: 'side' },
            h('div', { class: 'energy', title: '能量' }, `${p.energy}`, h('small', {}, `/${state.rules.energy}`)),
            h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, '抽牌堆', sorted(state.draw), '順序已打亂顯示') }, `抽牌堆 ${state.draw.length}`)),
          h('div', { class: 'hand' }, state.hand.map((inst) => {
            const el = cardEl(idx, inst, { width: 150, class: (my && canPlay(state, inst) ? 'playable' : 'dimmed') + (selected === inst.uid ? ' selected' : '') });
            el.onclick = () => onCard(inst);
            return el;
          })),
          h('div', { class: 'side' },
            h('button', { class: 'btn primary', disabled: !my, onclick: async () => { selected = null; await endTurn(state); render(); } }, state.phase === 'enemy' ? '敵方回合…' : '結束回合'),
            h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, '棄牌堆', state.discard) }, `棄牌堆 ${state.discard.length}`),
            h('button', { class: 'btn sm ghost', onclick: () => showCards(idx, '消耗區', state.exhaust) }, `消耗區 ${state.exhaust.length}`),
            h('button', { class: 'btn sm ghost', onclick: () => { showLog = !showLog; render(); } }, showLog ? '收起紀錄' : '戰鬥紀錄'))),
        showLog ? h('div', { class: 'battle-log panel' }, state.log.slice(-40).map((l) => h('div', {}, l))) : null,
        floatLayer));
      const logEl = root.querySelector('.battle-log'); if (logEl) logEl.scrollTop = logEl.scrollHeight;
      flushEvents();
      if (!done && (state.phase === 'won' || state.phase === 'lost')) { done = true; setTimeout(() => resolve(state), 900); }
    }

    function flushEvents() {
      const base = root.getBoundingClientRect();
      const offs = {};
      for (const ev of state.events.splice(0)) {
        const el = root.querySelector(`[data-uid="${ev.uid}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const n = (offs[ev.uid] = (offs[ev.uid] || 0) + 1);
        let text, cls;
        if (ev.type === 'hp') { text = (ev.amount > 0 ? '+' : '') + ev.amount; cls = ev.amount > 0 ? 'heal' : 'hurt'; }
        else if (ev.type === 'block') { text = ev.amount > 0 ? `格擋 +${ev.amount}` : `擋下 ${-ev.amount}`; cls = 'blk'; }
        else { text = ev.text; cls = 'st'; }
        const f = h('div', { class: 'floater ' + cls, style: { left: `${r.left - base.left + r.width / 2}px`, top: `${r.top - base.top + 30 + n * 22}px` } }, text);
        floatLayer.append(f);
        setTimeout(() => f.remove(), 1100);
      }
    }

    render();
    startBattle(state).then(render);
  });
}
