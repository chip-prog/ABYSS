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

// 把使用者選的圖片檔縮到合理大小，保留透明背景
export async function fileToBlob(file, max = 900) {
  const img = new Image();
  img.src = URL.createObjectURL(file);
  await img.decode();
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  URL.revokeObjectURL(img.src);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.9));
  return blob && blob.type === 'image/webp' ? blob : new Promise((r) => cv.toBlob(r, 'image/png'));
}
