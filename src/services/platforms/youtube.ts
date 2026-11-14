/*
  Made By Seikagenou
  Telegram : t.me/seikagenou
  Mohon Untuk Tidak Menghapus, Mengedit, dll Watermark Di Dalam Kode Ini
*/
import { MediaFormat, MediaResult, ThumbnailInfo } from "./tiktok";

/* =====================================================================
   YouTube — lewat SnapYT (https://www.snapyt.app), diport dari scraper Node milik pengguna.

   Alur:
     1. POST admin-ajax.php  action=vd_fresh_nonce            -> nonce
     2. POST admin-ajax.php  action=process_video_url         -> { data.redirect } (halaman preview)
     3. GET  halaman preview -> judul, durasi, thumbnail, daftar format (<select id="fmt-select">)
     4. (opsional) YouTube oEmbed -> nama channel

   Tanpa axios/cheerio: memakai fetch bawaan Node dan parser HTML ringan di bawah.
   Link unduhan = `data-force` SnapYT (langsung dari SnapYT ke browser pengguna, tidak lewat server
   Fetchio). Jika tidak ada, dipakai `data-url` (googlevideo, cepat kedaluwarsa).

   Env (opsional):
     SNAPYT_BASE   default https://www.snapyt.app
   ===================================================================== */

const BASE = (process.env.SNAPYT_BASE?.trim() || "https://www.snapyt.app").replace(/\/+$/, "");
const AJAX = `${BASE}/wp-admin/admin-ajax.php`;
const HOME = `${BASE}/id/`;
const TIMEOUT = 45_000;
const RETRIES = 3;
const SNAP_HOST = new URL(BASE).hostname.toLowerCase();

const SNAP_UA =
  "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const HEADERS: Record<string, string> = {
  "User-Agent": SNAP_UA,
  Accept: "text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
};

/* ---------- host helper (dipakai fetchio-app.ts) ---------- */
export function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtube-nocookie.com" || h.endsWith(".youtube-nocookie.com");
}
const YT_CDN = ["googlevideo.com", "ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"];
export function isYouTubeCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return YT_CDN.some((d) => h === d || h.endsWith("." + d));
}

export function extractVideoId(input: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : "https://" + input.trim());
    const h = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    let id: string | undefined;
    if (h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    else {
      id = u.searchParams.get("v") || undefined;
      if (!id) id = u.pathname.match(/^\/(?:shorts|live|embed|v|e)\/([\w-]{11})/)?.[1];
    }
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

/* ---------- helpers ---------- */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "youtube";
const mb = (n?: number | null) => (n ? ` · ${n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"}` : "");

function httpUrl(v: any, base = BASE): string | undefined {
  const s = str(v);
  if (!s) return undefined;
  try {
    const u = new URL(s.startsWith("//") ? "https:" + s : s, base);
    return /^https?:$/.test(u.protocol) ? u.href : undefined;
  } catch { return undefined; }
}

function parseSizeToBytes(size?: string | null): number | undefined {
  const m = String(size ?? "").match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!m) return undefined;
  const mult = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[m[2].toUpperCase() as "GB" | "MB" | "KB"];
  return Math.round(parseFloat(m[1]) * mult);
}
const parseResolution = (s?: string | null) => String(s ?? "").match(/(\d{3,4})p/)?.[1];
const parseBitrate = (s?: string | null) => { const m = String(s ?? "").match(/(\d{2,3})\s*kbps/i); return m ? parseInt(m[1], 10) : undefined; };
function parseDuration(s?: string | null): number | null {
  const m = String(s ?? "").match(/(\d{1,2}:)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return m[0].split(":").reduce((a, p) => a * 60 + parseInt(p, 10), 0);
}

/* ---------- HTTP (fetch + retry) ---------- */
async function request(url: string, init: RequestInit): Promise<Response> {
  let last: any;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), redirect: "follow" });
      if (res.status >= 500 || res.status === 429) { last = new Error(`HTTP ${res.status}`); await res.body?.cancel().catch(() => {}); }
      else return res;
    } catch (e) { last = e; }
    if (attempt < RETRIES) await sleep(1000 * attempt);
  }
  throw new Error(`Permintaan ke SnapYT gagal: ${last?.message ?? "unknown"}`);
}

async function postForm(fields: Record<string, string>): Promise<{ status: number; data: any }> {
  const res = await request(AJAX, {
    method: "POST",
    headers: {
      ...HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: HOME, Origin: BASE, "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* bukan JSON (mis. "-1" / "0") */ }
  return { status: res.status, data };
}

async function getText(url: string): Promise<string> {
  // hanya halaman SnapYT / oEmbed yang boleh diambil server (anti-SSRF)
  const host = new URL(url).hostname.toLowerCase();
  if (host !== SNAP_HOST && host !== "www.youtube.com") throw new Error("Host preview tidak dikenal");
  const res = await request(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${host}`);
  return res.text();
}

/* ---------- inti SnapYT ---------- */
async function getFreshNonce(): Promise<string> {
  try {
    const { data } = await postForm({ action: "vd_fresh_nonce" });
    if (data?.success && data?.data?.nonce) return String(data.data.nonce);
  } catch { /* lanjut ke fallback */ }
  const html = await getText(HOME);
  const m = html.match(/"nonce"\s*:\s*"([a-f0-9]+)"/);
  if (m) return m[1];
  throw new Error("Nonce SnapYT tidak ditemukan");
}

async function requestPreviewUrl(ytUrl: string): Promise<string> {
  let lastMsg = "Respons SnapYT tidak valid";
  for (let attempt = 0; attempt < 2; attempt++) {   // percobaan kedua = nonce baru (nonce basi)
    const nonce = await getFreshNonce();
    const { status, data: j } = await postForm({ action: "process_video_url", video_url: ytUrl, security: nonce });
    const redirect = httpUrl(j?.data?.redirect);
    if (j?.success && redirect) {
      if (new URL(redirect).hostname.toLowerCase() !== SNAP_HOST) throw new Error("Redirect SnapYT tidak valid");
      return redirect;
    }
    lastMsg = typeof j?.data === "string" ? j.data : j?.data?.message || `Respons SnapYT tidak valid (HTTP ${status})`;
    console.error("[snapyt] process_video_url gagal:", status, String(lastMsg).slice(0, 200));
  }
  throw new Error(lastMsg);
}

/* ---------- parser HTML ringan (pengganti cheerio) ---------- */
const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}
/** tag pembuka pertama yang cocok (mis. id="vd-image") */
function firstTag(html: string, name: string, test: (a: Record<string, string>) => boolean): Record<string, string> | null {
  const re = new RegExp(`<${name}\\b[^>]*>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) { const a = attrs(m[0]); if (test(a)) return a; }
  return null;
}
/** isi elemen pertama yang cocok; name = nama tag atau "*" untuk sembarang tag */
function firstInner(html: string, name: string, test: (a: Record<string, string>) => boolean): string | null {
  const re = new RegExp(`<(${name === "*" ? "[a-z][a-z0-9]*" : name})\\b([^>]*)>([\\s\\S]*?)</\\1>`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) if (test(attrs(`<x ${m[2]}>`))) return m[3];
  return null;
}
const hasClass = (a: Record<string, string>, c: string) => (a.class ?? "").split(/\s+/).includes(c);

interface SnapFormat {
  group: string; label: string; kind: string | null; ext: string | null; resolution?: string; bitrate?: number;
  isMp3: boolean; size?: number; recommended: boolean; download?: string; stream?: string;
}
interface SnapPreview {
  title: string | null; chip: string | null; status: string | null; error: string | null;
  thumbs: string[]; durationText: string | null; formats: SnapFormat[];
}

function parsePreview(html: string): SnapPreview {
  const title = textOf(firstInner(html, "h1", (a) => hasClass(a, "title")) ?? "") || null;
  const chip = textOf(firstInner(html, "*", (a) => hasClass(a, "chip")) ?? "") || null;
  const status = textOf(firstInner(html, "*", (a) => a.id === "fmt-sub") ?? "") || null;
  const error = textOf(firstInner(html, "*", (a) => a.id === "error-message") ?? "") || null;

  const img = firstTag(html, "img", (a) => a.id === "vd-image");
  const thumbDl = firstTag(html, "[a-z][a-z0-9]*", (a) => a.id === "vd-thumb-dl");
  const thumbs = [img?.src, ...(thumbDl?.["data-srcs"] ?? "").split("|")].map((s) => httpUrl(s?.trim())).filter((s): s is string => !!s);

  const durationText = html.match(/Duration:\s*(?:<[^>]*>\s*)*([0-9:]+)/i)?.[1] ?? null;

  const formats: SnapFormat[] = [];
  const select = html.match(/<select\b[^>]*id=["']fmt-select["'][^>]*>([\s\S]*?)<\/select>/i)?.[1] ?? "";
  const groupRe = /<optgroup\b([^>]*)>([\s\S]*?)<\/optgroup>/gi;
  let g: RegExpExecArray | null;
  while ((g = groupRe.exec(select))) {
    const rawLabel = attrs(`<optgroup ${g[1]}>`).label ?? "";
    const group = rawLabel.replace(/^[^\w]*\s*/, "").trim() || rawLabel;
    const optRe = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
    let o: RegExpExecArray | null;
    while ((o = optRe.exec(g[2]))) {
      const a = attrs(`<option ${o[1]}>`);
      const text = textOf(o[2]);
      const label = (a["data-label"] ?? text).replace(/\s+/g, " ").trim();
      const bytes = Number(a["data-bytes"]);
      const mp3 = a["data-mp3"];
      formats.push({
        group, label: label || text, kind: a["data-kind"] || null, ext: (a["data-ext"] || "").toLowerCase() || null,
        resolution: parseResolution(label || text),
        bitrate: mp3 ? parseInt(mp3, 10) : parseBitrate(label || text),
        isMp3: !!mp3 || /mp3/i.test(label || text),
        size: Number.isFinite(bytes) && bytes > 0 ? bytes : parseSizeToBytes(a["data-size"]),
        recommended: a["data-recommended"] === "1",
        download: httpUrl(a["data-force"]),
        stream: httpUrl(a["data-url"]),
      });
    }
  }
  return { title, chip, status, error, thumbs, durationText, formats };
}

async function fetchOEmbed(id: string) {
  try {
    const watch = `https://www.youtube.com/watch?v=${id}`;
    const raw = await getText("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(watch));
    const o = JSON.parse(raw);
    const url = httpUrl(o.author_url, "https://www.youtube.com") ?? null;
    const handle = url?.match(/@([^/?#]+)/);
    return { name: str(o.author_name) ?? null, url, handle: handle ? `@${decodeURIComponent(handle[1])}` : null, title: str(o.title) };
  } catch { return { name: null, url: null, handle: null, title: undefined }; }
}

/* ---------- ubah hasil SnapYT -> hasil Fetchio ---------- */
export async function resolveYouTube(inputUrl: string): Promise<MediaResult> {
  const id = extractVideoId(inputUrl);
  if (!id) throw new Error("Link YouTube tidak valid (gunakan link video, shorts, live, atau youtu.be)");
  const canonical = `https://www.youtube.com/watch?v=${id}`;   // URL dibangun ulang dari ID tervalidasi

  let preview: SnapPreview;
  try {
    const redirect = await requestPreviewUrl(canonical);
    preview = parsePreview(await getText(redirect));
  } catch (e: any) {
    console.error("[snapyt]", e?.message ?? e);
    const m = String(e?.message ?? "");
    if (/privat|private/i.test(m)) throw new Error("Video ini privat");
    if (/tidak tersedia|unavailable|removed|dihapus/i.test(m)) throw new Error("Video tidak tersedia atau sudah dihapus");
    throw new Error("Gagal mengambil data video dari YouTube");
  }
  if (!preview.formats.length && !preview.title)
    throw new Error(preview.error || "Video tidak ditemukan atau tidak bisa diunduh (mungkin dihapus, privat, atau diblokir regional)");

  const oembed = await fetchOEmbed(id);
  const title = preview.title ?? oembed.title ?? "YouTube";
  const base = cleanName(`${title} - ${id}`);
  const duration = parseDuration(preview.durationText);

  const linkOf = (f: SnapFormat) => f.download ?? f.stream;
  const usable = preview.formats.filter((f) => linkOf(f));

  /* video: satu pilihan per (resolusi, ekstensi); utamakan yang sudah ada suara */
  const rank = (f: SnapFormat) => (f.kind === "video+audio" ? 2 : 0) + (f.recommended ? 1 : 0);
  const vmap = new Map<string, SnapFormat>();
  for (const f of usable.filter((f) => f.kind !== "audio-only" && !f.isMp3 && f.resolution)) {
    const key = `${f.resolution}|${f.ext ?? "mp4"}`;
    const cur = vmap.get(key);
    if (!cur || rank(f) > rank(cur)) vmap.set(key, f);
  }
  const videos: MediaFormat[] = [...vmap.values()]
    .sort((a, b) => Number(a.resolution) - Number(b.resolution) || Number(a.ext !== "mp4") - Number(b.ext !== "mp4"))
    .map((f) => {
      const ext = f.ext === "webm" ? "webm" : "mp4";
      const height = Number(f.resolution);
      const audio = f.kind ? f.kind === "video+audio" : undefined;
      return {
        type: "video" as const, quality: `${height}p`, ext, height, size: f.size, hasAudio: audio,
        label: `${ext.toUpperCase()} ${height}p${audio === false ? " · tanpa audio" : ""}${mb(f.size)}`,
        url: linkOf(f)!,
      };
    });

  /* audio: MP3, M4A, WEBA — tertinggi per jenis */
  const audios: MediaFormat[] = [];
  const audioSrc = usable.filter((f) => f.kind === "audio-only" || f.isMp3);
  for (const ext of ["mp3", "m4a", "weba"] as const) {
    const pool = audioSrc.filter((f) => (ext === "mp3" ? f.isMp3 : !f.isMp3 && (f.ext === ext || (ext === "weba" && f.ext === "webm"))));
    const f = pool.sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    if (!f) continue;
    audios.push({
      type: "audio", quality: f.bitrate ? `${f.bitrate}kbps` : ext, ext, size: f.size, bitrate: f.bitrate ? f.bitrate * 1000 : undefined,
      label: `Audio ${ext.toUpperCase()}${f.bitrate ? ` ${f.bitrate} kbps` : ""}${mb(f.size)}`,
      url: linkOf(f)!,
    });
  }
  if (!videos.length && !audios.length) throw new Error("Tidak ada format yang bisa diunduh untuk video ini");

  const thumbnails: ThumbnailInfo[] = [
    ...preview.thumbs.map((url) => ({ url })),
    { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
    { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
  ].filter((t, i, a) => a.findIndex((x) => x.url === t.url) === i);

  return {
    platform: "youtube",
    id,
    title: title.slice(0, 200),
    author: oembed.name,
    thumbnail: thumbnails[0].url,
    duration,
    formats: [...videos, ...audios],
    description: "",                       // SnapYT tidak menampilkan deskripsi
    channel: { name: oembed.name, id: null, handle: oembed.handle, url: oembed.url, avatar: null, subscribersText: null, subscribers: null },
    views: null,                           // tidak tersedia di SnapYT
    publishedAt: null,
    uploadedAt: null,
    editedAt: null,
    keywords: [],
    thumbnails,
    captions: [],
  };
}

/** Untuk `npm run ytdlp:check` (kini mengecek SnapYT): mengambil satu video contoh dan melaporkan hasilnya. */
export async function diagnoseYouTube(id = "dQw4w9WgXcQ"): Promise<{ cookies: string; ok: boolean; stderr: string }> {
  try {
    const r = await resolveYouTube(`https://www.youtube.com/watch?v=${id}`);
    return { cookies: "tidak dipakai (SnapYT)", ok: true, stderr: `${r.title} · ${r.formats.length} format` };
  } catch (e: any) {
    return { cookies: "tidak dipakai (SnapYT)", ok: false, stderr: String(e?.message ?? e) };
  }
}
