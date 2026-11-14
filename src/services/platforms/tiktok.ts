/*
  Made By Seikagenou
  Telegram : t.me/seikagenou
  Mohon Untuk Tidak Menghapus, Mengedit, dll Watermark Di Dalam Kode Ini
*/
import { isTikTokHost } from "../../utils/url-parser";

export const UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";

const TIMEOUT = 30_000;
const PAGE_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

export interface MediaFormat {
  type: "video" | "audio" | "image" | "thumbnail";
  quality: string;
  label: string;
  ext: string;
  url: string;
  width?: number;
  height?: number;
  size?: number;
  fps?: number;
  /** false = video-only stream (YouTube adaptive); undefined = not applicable */
  hasAudio?: boolean;
  codec?: string;
  bitrate?: number;
}
export interface ChannelInfo {
  name: string | null;
  id: string | null;
  handle: string | null;
  url: string | null;
  avatar: string | null;
  /** YouTube only exposes a rounded number ("1.23M subscribers") */
  subscribersText: string | null;
  subscribers: number | null;
}
export interface CaptionTrack {
  languageCode: string;
  name: string;
  auto: boolean;
  downloads: { ext: "srt" | "vtt" | "txt"; url: string }[];
}
export interface ThumbnailInfo { url: string; width?: number; height?: number }
export interface MediaResult {
  platform: "tiktok" | "youtube";
  title: string;
  author: string | null;
  thumbnail: string | null;
  duration: number | null;
  formats: MediaFormat[];
  /* ---- extra fields (YouTube) ---- */
  id?: string;
  description?: string;
  channel?: ChannelInfo;
  views?: number | null;
  publishedAt?: string | null;
  uploadedAt?: string | null;
  /** YouTube does not expose "last edited" publicly; null unless found in page data */
  editedAt?: string | null;
  keywords?: string[];
  thumbnails?: ThumbnailInfo[];
  captions?: CaptionTrack[];
  warning?: string;
}

/* ---------- host allow-lists (anti-SSRF) ---------- */
const CDN_SUFFIXES = [
  "tiktok.com", "tiktokv.com", "tiktokv.us", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com",
  "byteoversea.com", "ibytedtos.com", "muscdn.com", "bytecdn.com", "ttwstatic.com", "tiktokv.eu",
  "ibyteimg.com", "byteimg.com", "ttlivecdn.com", "tiktokw.us", "tiktokw.eu",
];
export function isAllowedCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return CDN_SUFFIXES.some((d) => h === d || h.endsWith("." + d));
}
function assertSafeUrl(raw: string, allow: (h: string) => boolean): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" || !allow(u.hostname)) throw new Error("URL tidak diizinkan");
  return u;
}

/* ---------- cookies + fetch ---------- */
function collectCookies(res: Response, jar: Map<string, string>) {
  const list: string[] = (res.headers as any).getSetCookie?.() ?? [];
  for (const line of list) {
    const pair = line.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
const cookieHeader = (jar: Map<string, string>) =>
  [...jar].map(([k, v]) => `${k}=${v}`).join("; ").slice(0, 1500);

/** Fetch following redirects manually so every hop stays on an allowed host. */
export async function safeFetch(
  startUrl: string,
  init: { headers: Record<string, string> },
  allow: (h: string) => boolean,
  jar?: Map<string, string>,
  signal?: AbortSignal
): Promise<Response> {
  let url = assertSafeUrl(startUrl, allow).toString();
  for (let hop = 0; hop < 8; hop++) {
    const headers = { ...init.headers };
    if (jar && jar.size) headers.Cookie = cookieHeader(jar);
    const res = await fetch(url, { headers, redirect: "manual", signal });
    if (jar) collectCookies(res, jar);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      url = assertSafeUrl(new URL(loc, url).toString(), allow).toString();
      await res.body?.cancel().catch(() => {});
      continue;
    }
    // keep the final URL available to callers (manual-redirect responses have url="")
    try { Object.defineProperty(res, "url", { value: url }); } catch { /* ignore */ }
    return res;
  }
  throw new Error("Terlalu banyak redirect saat membuka link TikTok");
}

/* ---------- text / url helpers ---------- */
const htmlDecode = (v: string) =>
  v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

function cleanUrl(value: any): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  let url = htmlDecode(value.replace(/\\u002F/gi, "/").replace(/\\u0026/gi, "&").replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
  if (url.startsWith("//")) url = "https:" + url;
  try { return new URL(url).href; } catch { return undefined; }
}
const firstUrl = (values: any[]) => {
  for (const v of values) { const u = cleanUrl(v); if (u) return u; }
  return undefined;
};
function urlsFrom(value: any): string[] {
  if (!value) return [];
  if (typeof value === "string") { const u = cleanUrl(value); return u ? [u] : []; }
  if (Array.isArray(value)) return value.flatMap(urlsFrom);
  if (typeof value === "object") return urlsFrom(value.UrlList ?? value.urlList ?? value.url_list ?? value.url ?? value.Url);
  return [];
}
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
const clean = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "tiktok";
const findUrl = (html: string, re: RegExp) => cleanUrl(html.match(re)?.[1]);

/* ---------- link resolving (vm / vt / tt.site / full) ---------- */
function directTikTokUrl(input: string): string | undefined {
  try {
    const u = new URL(input);
    if (!isTikTokHost(u.hostname)) return undefined;
    const m = u.pathname.match(/^\/@[^/]+\/(?:video|photo)\/\d+/);
    return m ? "https://www.tiktok.com" + m[0] : undefined;
  } catch { return undefined; }
}

function extractRedirectUrl(html: string, base: string): string | undefined {
  const patterns = [
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url\s*=\s*([^"' >]+)[^"']*["']/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /location\.replace\s*\(\s*["']([^"']+)["']\s*\)/i,
    /location\.assign\s*\(\s*["']([^"']+)["']\s*\)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (!m?.[1]) continue;
    try {
      let v = htmlDecode(m[1]);
      try { v = decodeURIComponent(v); } catch { /* keep */ }
      return new URL(v, base).href;
    } catch { /* next */ }
  }
  const t = html.match(/https?:\/\/(?:www\.|m\.|vm\.|vt\.)?tiktok\.com\/[^\s"'<>\\]+/i);
  if (t?.[0]) { try { return new URL(htmlDecode(t[0]), base).href; } catch { /* none */ } }
  return undefined;
}

async function loadPage(input: string, jar: Map<string, string>): Promise<string> {
  let current = input.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    for (let i = 0; i < 8; i++) {
      current = directTikTokUrl(current) ?? current;
      if (!isTikTokHost(new URL(current).hostname)) throw new Error("Link tidak mengarah ke halaman TikTok");
      const res = await safeFetch(current, { headers: PAGE_HEADERS }, isTikTokHost, jar, ctrl.signal);
      if (!res.ok) throw new Error(`TikTok returned HTTP ${res.status}`);
      const html = await res.text();
      const finalUrl = (res as any).url || current;
      if (/(^|\.)tiktok\.com$/i.test(new URL(finalUrl).hostname) && !/tt\.site/i.test(finalUrl)) return html;
      const next = extractRedirectUrl(html, finalUrl);
      if (!next || next === current) return html;
      current = next;
    }
    throw new Error("Terlalu banyak redirect saat membuka link TikTok");
  } catch (e) {
    if ((e as any)?.name === "AbortError") throw new Error("TikTok terlalu lama merespons, coba lagi");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- data extraction ---------- */
function scriptJson(html: string, id: string): any | null {
  const m = html.match(new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, "i"));
  if (!m?.[1]) return null;
  const raw = m[1].trim();
  try { return JSON.parse(raw); } catch { try { return JSON.parse(htmlDecode(raw)); } catch { return null; } }
}

function findVideoObject(root: any): any | null {
  const seen = new WeakSet<object>();
  const walk = (v: any): any | null => {
    if (v === null || typeof v !== "object" || seen.has(v)) return null;
    seen.add(v);
    if ((typeof v.id === "string" || typeof v.itemId === "string") &&
        (typeof v.video === "object" || typeof v.imagePost === "object" || v.playAddr || v.downloadAddr)) return v;
    for (const k of Array.isArray(v) ? v.keys() : Object.keys(v)) {
      const f = walk((v as any)[k]);
      if (f) return f;
    }
    return null;
  };
  return walk(root);
}

function extractFromHtml(html: string): any | null {
  const playAddr = findUrl(html, /"playAddr"\s*:\s*"([^"]+)"/i);
  const downloadAddr = findUrl(html, /"downloadAddr"\s*:\s*"([^"]+)"/i);
  const cover = findUrl(html, /"originCover"\s*:\s*"([^"]+)"/i) ?? findUrl(html, /"cover"\s*:\s*"([^"]+)"/i);
  const id = html.match(/"id"\s*:\s*"(\d{10,})"/i)?.[1] ?? html.match(/"itemId"\s*:\s*"(\d{10,})"/i)?.[1];
  const title = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"]+)["']/i)?.[1];
  if (!playAddr && !downloadAddr && !id) return null;
  return { id, desc: title, video: { playAddr, downloadAddr, cover } };
}

function extractItem(html: string): any {
  const universal = scriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const detail = universal?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  const direct = detail?.itemInfo?.itemStruct;
  if (direct && typeof direct === "object") return direct;
  if (detail && Number(detail.statusCode) > 0)
    throw new Error("Video tidak tersedia (privat, dihapus, atau dibatasi wilayah)");
  if (universal) { const f = findVideoObject(universal); if (f) return f; }
  const sigi = scriptJson(html, "SIGI_STATE");
  const sItem = sigi?.ItemModule && Object.values(sigi.ItemModule)[0];
  if (sItem && typeof sItem === "object") return sItem;
  if (sigi) { const f = findVideoObject(sigi); if (f) return f; }
  const fb = extractFromHtml(html);
  if (fb) return fb;
  if (/captcha|verify-bar|security check/i.test(html))
    throw new Error("TikTok meminta verifikasi (captcha) untuk server ini, coba lagi nanti");
  throw new Error("Data video TikTok tidak ditemukan di halaman");
}

/* ---------- qualities: 720p, 1080p, 1440p, 4K, 8K ---------- */
const TIERS: { label: string; min: number }[] = [
  { label: "8K", min: 4320 }, { label: "4K", min: 2160 }, { label: "1440p", min: 1440 },
  { label: "1080p", min: 1080 }, { label: "720p", min: 720 },
];
const tierOf = (side: number) => TIERS.find((t) => side >= t.min * 0.9)?.label;

function pickVideos(video: any, d: any, html: string) {
  const infos: any[] = Array.isArray(video.bitrateInfo) ? video.bitrateInfo : Array.isArray(video.bit_rate) ? video.bit_rate : [];
  const best = new Map<string, { url: string; bitrate: number; w?: number; h?: number; size?: number; h264: boolean }>();
  let fallbackBest: { url: string; bitrate: number; w?: number; h?: number; size?: number; h264: boolean; side: number } | null = null;
  for (const b of infos) {
    const pa = b?.PlayAddr ?? b?.play_addr;
    const url = urlsFrom(pa)[0];
    if (!url) continue;
    const w = num(pa?.Width ?? pa?.width), h = num(pa?.Height ?? pa?.height);
    const side = Math.min(w ?? 0, h ?? 0) || Math.max(w ?? 0, h ?? 0);
    const bitrate = Number(b?.Bitrate ?? b?.bit_rate) || 0;
    const h264 = /h264/i.test(String(b?.CodecType ?? b?.codec_type ?? "h264")) || !/265|hevc|bytevc/i.test(String(b?.CodecType ?? ""));
    const cand = { url, bitrate, w, h, size: num(pa?.DataSize ?? pa?.data_size), h264 };
    const tier = tierOf(side);
    if (!tier) { if (!fallbackBest || side > fallbackBest.side) fallbackBest = { ...cand, side }; continue; }
    const cur = best.get(tier);
    if (!cur || (cand.h264 && !cur.h264) || (cand.h264 === cur.h264 && bitrate > cur.bitrate)) best.set(tier, cand);
  }
  if (!best.size) {
    const play = urlsFrom([video.playAddr, video.PlayAddrStruct, video.play_addr, d.playAddr, d.play_addr])[0] ??
      findUrl(html, /"playAddr"\s*:\s*"([^"]+)"/i) ?? findUrl(html, /"UrlList"\s*:\s*\[\s*"([^"]+)"/i);
    const url = fallbackBest?.url ?? play;
    if (url) {
      const w = num(video.width) ?? fallbackBest?.w, h = num(video.height) ?? fallbackBest?.h;
      const tier = tierOf(Math.min(w ?? 0, h ?? 0)) ?? "HD";
      best.set(tier, { url, bitrate: 0, w, h, size: fallbackBest?.size, h264: true });
    }
  }
  return best;
}

const fmtSize = (n?: number) => (n ? ` · ${n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"}` : "");

/* ---------- photos / slideshow ---------- */
function pickImage(list: any): string | null {
  const urls = urlsFrom(list);
  return urls.find((u) => /\.(jpe?g|png)(\?|$)/i.test(u)) || urls.find((u) => !/heic/i.test(u)) || urls[0] || null;
}
function extractImages(d: any): { url: string; w?: number; h?: number }[] {
  const lists = [d.imagePost?.images, d.images, d.imagePost?.imageList, d.slideshowImageLinks];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    const out = list.map((it: any) => {
      if (typeof it === "string") { const u = cleanUrl(it); return u ? { url: u } : null; }
      const url = pickImage(it?.imageURL?.urlList ?? it?.imageURL) ?? pickImage(it?.displayImage?.urlList) ?? firstUrl([it?.originUrl, it?.url, it?.src]);
      return url ? { url, w: num(it?.imageWidth), h: num(it?.imageHeight) } : null;
    }).filter(Boolean) as { url: string; w?: number; h?: number }[];
    if (out.length) return out;
  }
  return [];
}

/* ---------- token for /file ---------- */
export interface FileToken {
  u: string; c: string; n: string; t: string;
  /** user-agent to use upstream (YouTube URLs are bound to the client that issued them) */
  a?: string;
  /** referer: undefined = TikTok default, "" = none */
  r?: string;
  /** exact byte size (enables chunked streaming for googlevideo) */
  s?: number;
}
export function encodeToken(payload: FileToken) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
export function decodeToken(token: string): FileToken {
  const p = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  if (typeof p?.u !== "string" || typeof p?.n !== "string") throw new Error("Token tidak valid");
  return {
    u: p.u,
    c: typeof p.c === "string" ? p.c.replace(/[^\w\-=.%;, ]/g, "") : "",
    n: p.n,
    t: String(p.t || "video"),
    a: typeof p.a === "string" ? p.a.replace(/[^\x20-\x7e]/g, "").slice(0, 300) || undefined : undefined,
    r: typeof p.r === "string" ? p.r.replace(/[^\x20-\x7e]/g, "").slice(0, 300) : undefined,
    s: Number.isFinite(Number(p.s)) && Number(p.s) > 0 ? Number(p.s) : undefined,
  };
}

/* ---------- main ---------- */
export async function resolveTikTok(inputUrl: string): Promise<MediaResult> {
  const jar = new Map<string, string>();
  const html = await loadPage(inputUrl, jar);
  const item = extractItem(html);
  const cookie = cookieHeader(jar);

  const video = item.video ?? {};
  const id = String(item.id ?? item.itemId ?? item.item_id ?? Date.now());
  const desc = typeof (item.desc ?? item.description ?? item.title) === "string" ? String(item.desc ?? item.description ?? item.title) : "";
  const base = clean(desc || id);
  const images = extractImages(item);
  const formats: MediaFormat[] = [];

  if (!images.length) {
    const order = [...TIERS.map((t) => t.label), "HD"];
    const vids = pickVideos(video, item, html);
    [...vids.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).forEach(([tier, r]) => {
      formats.push({
        type: "video", quality: tier, label: `MP4 ${tier}${fmtSize(r.size)}`, ext: "mp4", width: r.w, height: r.h, size: r.size,
        url: "/file?t=" + encodeToken({ u: r.url, c: cookie, n: `${base} - ${id} - ${tier}.mp4`, t: "video" }),
      });
    });
  }

  const audio = firstUrl([item.music?.playUrl, item.music?.play_url, item.music?.url, video.music?.playUrl, video.music?.play_url, video.music?.url]);
  if (audio) {
    formats.push({
      type: "audio", quality: "MP3", label: "MP3 Audio", ext: "mp3",
      url: "/file?t=" + encodeToken({ u: audio, c: cookie, n: `${base} - ${id}.mp3`, t: "audio" }),
    });
  }

  images.forEach((im, i) => formats.push({
    type: "image", quality: "Photo", label: `Foto ${i + 1}`, ext: "jpg", width: im.w, height: im.h,
    url: "/file?t=" + encodeToken({ u: im.url, c: "", n: `${base} - ${id} - ${i + 1}.jpg`, t: "image" }),
  }));

  if (!formats.length || (!images.length && !formats.some((f) => f.type === "video"))) {
    const info = [
      `playAddr=${video.playAddr ? "ada" : "kosong"}`,
      `downloadAddr=${video.downloadAddr ? "ada" : "kosong"}`,
      `bitrateInfo=${Array.isArray(video.bitrateInfo) ? video.bitrateInfo.length : 0}`,
    ].join(", ");
    throw new Error(`URL video tidak ada di halaman TikTok (${info}), tikTok mungkin menyembunyikan video dari IP server`);
  }

  const author = item.author;
  const username = typeof author === "string" ? author : author?.uniqueId ?? author?.unique_id ?? author?.username ?? item.authorMeta?.name;
  return {
    platform: "tiktok",
    title: (desc || "TikTok").slice(0, 200),
    author: username ? "@" + username : null,
    thumbnail: firstUrl([video.originCover, video.origin_cover, item.originCover, video.cover, video.coverUrl, item.cover, video.dynamicCover]) ??
      pickImage(item.imagePost?.cover?.imageURL?.urlList) ?? images[0]?.url ?? null,
    duration: num(video.duration ?? item.duration) ?? null,
    formats,
  };
}