// Studio 的儲存空間（瀏覽器的 IndexedDB）：工作內容與上傳的圖片都放在這裡。
// 圖片在內容裡只記一個「參照」：
//   local:<檔名>   還在這台電腦的 Studio 裡，尚未放進儲存庫
//   assets/<檔名>  已經是儲存庫裡的檔案
//   data:...       舊格式，開啟時會自動轉換
import { uid } from '../engine/rng.js';

let dbp;
const db = () => (dbp ||= new Promise((res, rej) => {
  const r = indexedDB.open('abyss-studio', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('kv'); r.result.createObjectStore('img'); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
}));
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq?.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

const urls = new Map(), sizes = new Map();
export async function initImages() {
  const d = await db();
  await new Promise((res, rej) => {
    const t = d.transaction('img', 'readonly');
    const c = t.objectStore('img').openCursor();
    c.onsuccess = () => { const cur = c.result; if (!cur) return; setUrl(cur.key, cur.value); cur.continue(); };
    t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
function setUrl(key, blob) {
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  urls.set(key, URL.createObjectURL(blob)); sizes.set(key, blob.size);
}

// 參照 → 可以放進 <img src> 的網址
export function imgUrl(ref) {
  if (!ref) return '';
  if (ref.startsWith('local:')) return urls.get(ref.slice(6)) || '';
  return ref;
}
export const isLocal = (ref) => typeof ref === 'string' && ref.startsWith('local:');
export const localKey = (ref) => ref.slice(6);
export const hasImage = (key) => urls.has(key);
export const imageSize = (key) => sizes.get(key) || 0;
export const imageKeys = () => [...urls.keys()];
export const getBlob = (key) => tx('img', 'readonly', (s) => s.get(key));

export async function addImage(blob, key) {
  key ||= `${uid()}.${(blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
  await tx('img', 'readwrite', (s) => s.put(blob, key));
  setUrl(key, blob);
  return 'local:' + key;
}
export async function delImage(key) {
  await tx('img', 'readwrite', (s) => s.delete(key));
  if (urls.has(key)) URL.revokeObjectURL(urls.get(key));
  urls.delete(key); sizes.delete(key);
}

// 走訪內容裡所有的圖片參照（欄位名為 image 或 img）；fn 回傳新值時會取代
export async function walkRefs(node, fn) {
  if (!node || typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    const v = node[k];
    if ((k === 'image' || k === 'img') && typeof v === 'string') { const n = await fn(v); if (n !== undefined) node[k] = n; }
    else if (v && typeof v === 'object') await walkRefs(v, fn);
  }
}

// 把使用者選的圖片檔縮到合理大小，保留透明背景。
// key：圖片四角是綠幕時自動去背；trim：去背後裁掉四周多餘的透明區域。
export async function fileToBlob(file, max = 900, { key = false, trim = false } = {}) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const k = Math.min(1, max / Math.max(img.width, img.height));
  let cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  let keyed = false;
  if (key) {
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    if (looksGreen(data)) { chromaKey(data); ctx.putImageData(data, 0, 0); keyed = true; if (trim) cv = trimCanvas(cv, data); }
  }
  const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
  const out = blob && blob.type === 'image/webp' ? blob : await new Promise((r) => cv.toBlob(r, 'image/png'));
  out.keyed = keyed;
  return out;
}
const greenness = (d, i) => d[i + 1] - Math.max(d[i], d[i + 2]);
// 四個角落都是明顯的綠色，才當作綠幕
function looksGreen({ data, width, height }) {
  const s = Math.max(2, Math.round(Math.min(width, height) * 0.02));
  const corners = [[0, 0], [width - s, 0], [0, height - s], [width - s, height - s]];
  return corners.every(([x0, y0]) => {
    let g = 0, n = 0;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { g += greenness(data, (y * width + x) * 4); n++; }
    return g / n > 35;
  });
}
// 去綠：明顯偏綠的像素變透明，邊緣半透明並去掉綠色反光
function chromaKey({ data }) {
  for (let i = 0; i < data.length; i += 4) {
    const g = greenness(data, i);
    if (g > 40) data[i + 3] = 0;
    else if (g > 12) {
      data[i + 3] = Math.round(data[i + 3] * (1 - (g - 12) / 28));
      data[i + 1] = Math.max(data[i], data[i + 2]);
    }
  }
}
function trimCanvas(cv, { data, width, height }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 16) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return cv;
  const pad = 2, w = x1 - x0 + 1 + pad * 2, h = y1 - y0 + 1 + pad * 2;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  out.getContext('2d').drawImage(cv, x0 - pad, y0 - pad, w, h, 0, 0, w, h);
  return out;
}
