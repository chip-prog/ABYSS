// 紙偶：一張插在棍子上的紙片。換姿勢時整張翻面，動作刻意用低影格、一格一格跳。
import { h } from './common.js';
import { imgUrl } from './store.js';

export const poseOf = (poses, name) => (poses?.[name]?.img ? poses[name] : null);

// 依 fallback 順序找出實際要顯示的姿勢
export function resolvePose(poses, defs, name) {
  for (const n of [name, ...(defs[name]?.fallback || [])]) { const p = poseOf(poses, n); if (p) return p; }
  return null;
}
export function poseTransform(p) {
  return `translate(calc(-50% + ${p.x || 0}px), ${p.y || 0}px) scale(${p.scale || 1})`;
}

const STEPS = (n) => `steps(${n}, end)`;

export function makePuppet({ name, poses, defs, side = 'left', color = '#8c7a5e', paperEdge = true, boss = false }) {
  const img = h('img', { class: 'puppet-img', alt: '', draggable: false });
  const tag = h('div', { class: 'puppet-tag' });
  // 沒有任何圖時的暫代紙偶：一塊寫著名字的紙牌
  const stand = h('div', { class: 'puppet-stand', style: { '--pc': color } }, h('span', {}, [...(name || '？')][0]), tag);
  const body = h('div', { class: 'puppet-body' }, img, stand);
  const flip = h('div', { class: 'puppet-flip' }, body);
  const el = h('div', { class: `puppet ${side}${paperEdge ? ' paper' : ''}${boss ? ' boss' : ''}` },
    h('div', { class: 'puppet-rays' }), h('div', { class: 'puppet-stick' }), flip, h('div', { class: 'puppet-shadow' }));
  body.style.animationDelay = `${-Math.random() * 2}s`;
  let current = null, busy = Promise.resolve();
  const dir = side === 'left' ? 1 : -1;

  function show(pose) {
    const p = resolvePose(poses, defs, pose);
    current = pose;
    if (p) { img.src = imgUrl(p.img); img.style.transform = poseTransform(p); img.hidden = false; stand.hidden = true; }
    else { img.hidden = true; stand.hidden = false; tag.textContent = defs[pose]?.label || ''; stand.dataset.pose = pose; }
  }
  // 翻面換姿勢：轉到側面看不見時換圖
  function setPose(pose, instant = false) {
    if (pose === current) return busy;
    if (instant || !el.isConnected) { show(pose); return busy; }
    busy = busy.then(async () => {
      await flip.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(90deg)' }], { duration: 90, easing: STEPS(3) }).finished.catch(() => {});
      show(pose);
      await flip.animate([{ transform: 'rotateY(-90deg)' }, { transform: 'rotateY(0deg)' }], { duration: 90, easing: STEPS(3) }).finished.catch(() => {});
    });
    return busy;
  }
  const MOVES = {
    lunge: [[{ transform: 'translateX(0) rotate(0)' }, { transform: `translateX(${dir * 70}px) rotate(${dir * 7}deg)`, offset: 0.35 }, { transform: `translateX(${dir * 70}px) rotate(${dir * 7}deg)`, offset: 0.7 }, { transform: 'translateX(0) rotate(0)' }], 460, 6],
    recoil: [[{ transform: 'translateX(0) rotate(0)' }, { transform: `translateX(${-dir * 30}px) rotate(${-dir * 11}deg)`, offset: 0.3 }, { transform: `translateX(${-dir * 18}px) rotate(${-dir * 6}deg)`, offset: 0.7 }, { transform: 'translateX(0) rotate(0)' }], 420, 5],
    nudge: [[{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * 10}px)`, offset: 0.3 }, { transform: `translateX(${dir * 4}px)`, offset: 0.6 }, { transform: 'translateX(0)' }], 300, 4],
    raise: [[{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)', offset: 0.4 }, { transform: 'translateY(-16px)', offset: 0.75 }, { transform: 'translateY(0)' }], 440, 5],
    fall: [[{ transform: 'rotateX(0deg)', opacity: 1 }, { transform: 'rotateX(80deg)', opacity: 1, offset: 0.7 }, { transform: 'rotateX(88deg)', opacity: 0 }], 520, 6],
  };
  function play(kind) {
    const m = MOVES[kind]; if (!m || !el.isConnected) return Promise.resolve();
    return body.animate(m[0], { duration: m[1], easing: STEPS(m[2]), fill: kind === 'fall' ? 'forwards' : 'none' }).finished.catch(() => {});
  }
  show('idle');
  return { el, setPose, play, refresh: () => show(current || 'idle'), reset: () => { body.getAnimations().forEach((a) => { if (!(a instanceof CSSAnimation)) a.cancel(); }); show('idle'); }, get pose() { return current; } };
}
