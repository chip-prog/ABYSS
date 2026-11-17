// 可重現的亂數：同一個種子會得到同一串結果，方便重現問題。
export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    weighted(items, weightOf) {
      const total = items.reduce((s, x) => s + weightOf(x), 0);
      let r = next() * total;
      for (const x of items) { r -= weightOf(x); if (r <= 0) return x; }
      return items[items.length - 1];
    },
  };
}

export const uid = () => Math.random().toString(36).slice(2, 10);
