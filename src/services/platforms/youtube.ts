/*
  Made By Seikagenou
  Telegram : t.me/seikagenou
  Mohon Untuk Tidak Menghapus, Mengedit, dll Watermark Di Dalam Kode Ini
*/
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MediaFormat, MediaResult, ThumbnailInfo, encodeToken, UA } from "./tiktok";
import { YtDlpUnavailable, ffmpegBinary, runYtDlp } from "../ytdlp";

/* =====================================================================
   YouTube — yt-dlp EKSTERNAL (tanpa API pihak ketiga, tanpa source yt-dlp di repo)

   yt-dlp dipanggil lewat child_process (lihat src/services/ytdlp.ts) dari executable yang
   dipasang di server (Dockerfile memasangnya) atau diunduh otomatis ke folder sementara.
   JavaScript runtime untuk tantangan YouTube = Node.js yang menjalankan aplikasi ini.

   Env (semua opsional):
     YTDLP_PATH               path executable yt-dlp (default: `yt-dlp` di PATH)
     YTDLP_AUTO_DOWNLOAD      "0" = jangan unduh otomatis bila yt-dlp tidak ada
     YTDLP_COOKIES_FILE       file cookies Netscape
     YTDLP_COOKIES_BASE64     cookies Netscape dalam Base64 (untuk Environment Variables Vercel)
     YOUTUBE_COOKIES          isi cookies Netscape biasa (alternatif)
     YTDLP_PROXY              mis. http://user:pass@host:port (berguna kalau IP server diblokir YouTube)
     YTDLP_REMOTE_COMPONENTS  mis. "ejs:github" - hanya perlu jika yt-dlp BUKAN executable resmi
                              (executable resmi sudah membawa yt-dlp-ejs)
     YTDLP_MAX_PARALLEL       proses yt-dlp bersamaan, default 3
     FFMPEG_PATH              path ffmpeg; bila ada, opsi audio MP3 ikut ditampilkan
   ===================================================================== */

const TIMEOUT = 60_000;

export function isYouTubeHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === "youtu.be" || h === "youtube.com" || h.endsWith(".youtube.com");
}
const YT_CDN = ["googlevideo.com", "ytimg.com", "ggpht.com", "googleusercontent.com", "youtube.com"];
export function isYouTubeCdnHost(host: string): boolean {
  const h = host.toLowerCase();
  return YT_CDN.some((d) => h === d || h.endsWith("." + d));
}

export function extractVideoId(input: string): string | null {
  try {
    const u = new URL(input);
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
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
const str = (v: any): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: any) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };
const httpUrl = (v: any): string | undefined => {
  const s = str(v);
  if (!s) return undefined;
  try { const u = new URL(s.startsWith("//") ? "https:" + s : s); return /^https?:$/.test(u.protocol) ? u.href : undefined; } catch { return undefined; }
};
const cleanName = (s: string) => s.replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "youtube";
const mb = (n?: number) => (n ? ` · ${n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB"}` : "");
const hasV = (f: any) => !!f?.vcodec && f.vcodec !== "none";
const hasA = (f: any) => !!f?.acodec && f.acodec !== "none";

/* ---------- menjalankan yt-dlp ---------- */
let cookieFile: string | undefined;
let cacheDir: string | undefined;

function cookiesArgs(): string[] {
  // File path (mis. Secret File di hosting) memiliki prioritas tertinggi.
  const filePath = process.env.YTDLP_COOKIES_FILE?.trim();
  if (filePath) return ["--cookies", filePath];

  // Vercel: simpan isi cookies Netscape sebagai Base64 di Environment Variables.
  // File dibuat di /tmp (tmpdir pada Vercel) dan tidak pernah masuk repository.
  const encoded = process.env.YTDLP_COOKIES_BASE64?.trim();
  const raw = encoded
    ? Buffer.from(encoded, "base64").toString("utf8")
    : process.env.YOUTUBE_COOKIES;
  if (raw && raw.trim()) {
    if (!cookieFile) {
      const contents = raw.replace(/\\n/g, "\n");
      if (!contents.includes("# Netscape HTTP Cookie File") && !contents.includes("# HTTP Cookie File")) {
        throw new Error("Cookies YouTube harus menggunakan format Netscape cookies.txt");
      }
      const file = join(mkdtempSync(join(tmpdir(), "fetchio-")), "youtube-cookies.txt");
      writeFileSync(file, contents, { mode: 0o600 });
      cookieFile = file;
    }
    return ["--cookies", cookieFile as string];
  }
  return [];
}

/** batasi proses yt-dlp yang jalan bersamaan supaya server tidak kewalahan */
const MAX = Math.max(1, Number(process.env.YTDLP_MAX_PARALLEL) || 3);
let active = 0;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX) throw new Error("Server sedang sibuk, coba lagi sebentar");
  active++;
  try { return await fn(); } finally { active--; }
}

function friendly(err: any): Error {
  const out = String(err?.stderr ?? "") + " " + String(err?.message ?? "");
  if (err instanceof YtDlpUnavailable) return err;
  if (err?.code === "ENOENT" || err?.code === "EACCES") return new Error("yt-dlp tidak ditemukan atau tidak bisa dijalankan di server");
  if (err?.killed || err?.signal === "SIGTERM") return new Error("Pengambilan data YouTube terlalu lama, coba lagi");
  if (/confirm you.?re not a bot|sign in to confirm/i.test(out)) return new Error("YouTube meminta verifikasi dari server ini. Atur cookies (YTDLP_COOKIES_FILE) atau proxy (YTDLP_PROXY)");
  if (/private video/i.test(out)) return new Error("Video ini privat");
  if (/members.only|join this channel/i.test(out)) return new Error("Video ini khusus anggota channel");
  if (/age|confirm your age|inappropriate/i.test(out) && /sign in|restricted/i.test(out)) return new Error("Video dibatasi usia dan butuh login (atur cookies)");
  if (/not available in your country|blocked it in your country|geo/i.test(out)) return new Error("Video tidak tersedia di wilayah server");
  if (/video unavailable|has been removed|no longer available|does not exist|terminated/i.test(out)) return new Error("Video tidak tersedia atau sudah dihapus");
  if (/live event will begin|premieres in|is upcoming/i.test(out)) return new Error("Siaran langsung/premiere ini belum dimulai");
  if (/unsupported url|is not a valid url/i.test(out)) return new Error("Link YouTube tidak didukung");
  if (/requested format is not available|no video formats/i.test(out)) return new Error("Format video tidak tersedia untuk video ini");
  if (/http error 429|too many requests/i.test(out)) return new Error("YouTube membatasi permintaan dari server ini, coba lagi nanti");
  return new Error("Gagal mengambil data video dari YouTube");
}

async function ytdlpJson(id: string): Promise<any> {
  cacheDir ??= join(tmpdir(), "fetchio-ytdlp-cache");
  const remote = process.env.YTDLP_REMOTE_COMPONENTS;
  const args = [
    "-J", "--no-playlist", "--no-warnings", "--no-update", "--ignore-config",
    "--socket-timeout", "20", "--cache-dir", cacheDir,
    "--js-runtimes", `node:${process.execPath}`,
    ...(remote && remote !== "0" ? ["--remote-components", remote] : []),
    ...(process.env.YTDLP_PROXY ? ["--proxy", process.env.YTDLP_PROXY] : []),
    ...cookiesArgs(),
    "--", `https://www.youtube.com/watch?v=${id}`,       // URL dibangun ulang dari ID tervalidasi, tanpa shell
  ];
  return slot(async () => {
    try {
      return JSON.parse(await runYtDlp(args, { timeout: TIMEOUT, maxBuffer: 96 * 1024 * 1024 }));
    } catch (e) { throw friendly(e); }
  });
}

/* ---------- ubah JSON yt-dlp -> hasil Fetchio ---------- */
const isoDate = (j: any): string | null => {
  const d = str(j?.upload_date);
  if (d && /^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return num(j?.timestamp) ? new Date(Number(j.timestamp) * 1000).toISOString() : null;
};

export async function resolveYouTube(inputUrl: string): Promise<MediaResult> {
  const id = extractVideoId(inputUrl);
  if (!id) throw new Error("Link YouTube tidak valid (gunakan link video, shorts, live, atau youtu.be)");

  const j = await ytdlpJson(id);
  if (j?.is_live) throw new Error("Siaran langsung tidak bisa diunduh sampai selesai");
  const title = str(j?.title) ?? "YouTube";
  const base = cleanName(`${title} - ${id}`);

  const ok: any[] = (Array.isArray(j?.formats) ? j.formats : []).filter(
    (f: any) => httpUrl(f?.url) && /^https/i.test(String(f.protocol ?? "https")) && f.ext !== "mhtml" && !/storyboard/i.test(String(f.format_note ?? ""))
  );
  const sizeOf = (f: any) => num(f.filesize) ?? num(f.filesize_approx);
  // link googlevideo terikat ke IP server yang menjalankan yt-dlp: unduh lewat /file (proxy)
  const link = (f: any, name: string, type: "video" | "audio") =>
    "/file?t=" + encodeToken({ u: httpUrl(f.url)!, c: "", n: name, t: type, a: str(f.http_headers?.["User-Agent"]) ?? UA, r: "" });

  // video: satu pilihan terbaik per resolusi (utamakan yang sudah ada suaranya); webm hanya untuk resolusi di atas mp4
  const best = (list: any[]) => list.sort((a, b) => Number(hasA(b)) - Number(hasA(a)) || (num(b.tbr) ?? 0) - (num(a.tbr) ?? 0))[0];
  const byHeight = (ext: string) => {
    const m = new Map<number, any[]>();
    for (const f of ok.filter((f) => hasV(f) && f.ext === ext && num(f.height))) { const k = Number(f.height); m.set(k, [...(m.get(k) ?? []), f]); }
    return new Map([...m].map(([k, v]) => [k, best(v)] as [number, any]));
  };
  const mp4 = byHeight("mp4");
  const webm = byHeight("webm");
  const maxMp4 = Math.max(0, ...mp4.keys());
  const chosen: any[] = [...mp4.values(), ...[...webm].filter(([h]) => h > maxMp4).map(([, f]) => f)].sort((a, b) => a.height - b.height);

  const videos: MediaFormat[] = chosen.map((f) => {
    const size = sizeOf(f);
    const audio = hasA(f);
    const ext = f.ext === "webm" ? "webm" : "mp4";
    return {
      type: "video", quality: `${f.height}p`, ext, height: Number(f.height), size, hasAudio: audio,
      label: `${ext.toUpperCase()} ${f.height}p${audio ? "" : " · tanpa audio"}${mb(size)}`,
      url: link(f, `${base} - ${f.height}p.${ext}`, "video"),
    };
  });

  // audio: terbaik per kontainer (m4a, webm -> weba)
  const audios: MediaFormat[] = [];
  for (const [src, ext] of [["m4a", "m4a"], ["webm", "weba"]] as const) {
    const f = ok.filter((f) => hasA(f) && !hasV(f) && f.ext === src).sort((a, b) => (num(b.abr) ?? 0) - (num(a.abr) ?? 0))[0];
    if (!f) continue;
    const size = sizeOf(f);
    const br = num(f.abr) ? Math.round(Number(f.abr) * 1000) : undefined;
    audios.push({
      type: "audio", quality: br ? `${Math.round(br / 1000)}kbps` : ext, ext, size, bitrate: br,
      label: `Audio ${ext.toUpperCase()}${br ? ` ${Math.round(br / 1000)} kbps` : ""}${mb(size)}`,
      url: link(f, `${base}.${ext}`, "audio"),
    });
  }
  // MP3: dikonversi saat diunduh lewat ffmpeg (hanya jika ffmpeg ada di server)
  if (await ffmpegBinary()) {
    const src = ok.filter((f) => hasA(f) && !hasV(f)).sort((a, b) => Number(a.ext === "m4a") - Number(b.ext === "m4a") || (num(a.abr) ?? 0) - (num(b.abr) ?? 0)).pop();
    if (src) {
      const dur = num(j?.duration);
      audios.unshift({
        type: "audio", quality: "192kbps", ext: "mp3", bitrate: 192_000, size: dur ? Math.round(dur * 24_000) : undefined,
        label: `Audio MP3 192 kbps`,
        url: "/file?t=" + encodeToken({ u: httpUrl(src.url)!, c: "", n: `${base}.mp3`, t: "mp3", a: str(src.http_headers?.["User-Agent"]) ?? UA, r: "" }),
      });
    }
  }
  if (!videos.length && !audios.length) throw new Error("Tidak ada format yang bisa diunduh untuk video ini");

  const thumbnails: ThumbnailInfo[] = [
    { url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` },
    { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` },
    ...(httpUrl(j?.thumbnail) ? [{ url: httpUrl(j.thumbnail)! }] : []),
  ];
  const name = str(j?.channel) ?? str(j?.uploader) ?? null;
  const handle = str(j?.uploader_id);
  return {
    platform: "youtube",
    id,
    title: title.slice(0, 200),
    author: name,
    thumbnail: thumbnails[0].url,
    duration: num(j?.duration) ? Math.round(Number(j.duration)) : null,
    formats: [...videos, ...audios],
    description: (str(j?.description) ?? "").slice(0, 5000),
    channel: {
      name, id: str(j?.channel_id) ?? null, handle: handle?.startsWith("@") ? handle : null,
      url: httpUrl(j?.channel_url) ?? null, avatar: null, subscribersText: null, subscribers: num(j?.channel_follower_count) ?? null,
    },
    views: num(j?.view_count) ?? null,
    publishedAt: isoDate(j),
    uploadedAt: isoDate(j),
    editedAt: null,
    keywords: Array.isArray(j?.tags) ? j.tags.slice(0, 30).map(String) : [],
    thumbnails,
    captions: [],
  };
}
