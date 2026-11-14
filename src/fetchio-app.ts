import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import path from "path";
import { Readable } from "stream";
import { spawn } from "child_process";
import { parseMediaUrl } from "./utils/url-parser";
import { resolveMedia } from "./services/platforms";
import { decodeToken, safeFetch, isAllowedCdnHost, UA } from "./services/platforms/tiktok";
import { isYouTubeCdnHost } from "./services/platforms/youtube";
import { childEnv, ffmpegBinary } from "./services/ytdlp";

const allowCdn = (h: string) => isAllowedCdnHost(h) || isYouTubeCdnHost(h);

/** Bukan perubahan UI: tombol unduh YouTube di frontend hanya menerima URL absolut, jadi /file diberi origin. */
function absolutizeFileLinks(req: express.Request, data: any) {
  const envBase = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  const host = req.get("host") || "";
  const base = envBase || (/^[\w.-]+(:\d{1,5})?$/.test(host) ? `${req.protocol}://${host}` : "");
  if (!base || !data) return data;
  const fix = (o: any) => { if (o && typeof o.url === "string" && o.url.startsWith("/file?")) o.url = base + o.url; };
  (data.formats || []).forEach(fix);
  (data.captions || []).forEach((c: any) => (c?.downloads || []).forEach(fix));
  return data;
}

let ffmpegActive = 0;
const FFMPEG_MAX = Math.max(1, Number(process.env.FFMPEG_MAX_PARALLEL) || 2);

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: process.env.CORS_ORIGIN === "*" || !process.env.CORS_ORIGIN ? true : process.env.CORS_ORIGIN.split(",") }));
app.use(express.json({ limit: "4kb", strict: true }));
app.use(["/download", "/file"], rateLimit({ windowMs: 60000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false }));

/*
  Keamanan input / SQL injection:
  - Aplikasi ini TIDAK memakai database sama sekali (database-schema.sql hanya rencana), jadi tidak ada query SQL yang bisa disuntik.
  - Input tetap divalidasi ketat (hanya URL http/https polos, tanpa karakter kontrol/kutip/tanda kurung sudut, tanpa user:pass).
  - Jika nanti database ditambahkan, WAJIB pakai prepared statement / parameter binding (jangan pernah menggabungkan string ke query).
*/
const SAFE_URL = /^https?:\/\/[^\s<>"'`\\{}|^\x00-\x1f\x7f]+$/i;
function cleanInputUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 8 || s.length > 2048 || !SAFE_URL.test(s)) return null;
  try { const u = new URL(s); return u.username || u.password ? null : s; } catch { return null; }
}

app.post("/download", async (req, res) => {
  try {
    const body = req.body;
    const clean = body && typeof body === "object" && !Array.isArray(body) ? cleanInputUrl(body.url) : null;
    if (!clean) return res.status(400).json({ success: false, error: "Masukkan URL yang valid" });
    const parsed = parseMediaUrl(clean);
    const data = await resolveMedia(parsed.platform, parsed.url);
    return res.json({ success: true, data: parsed.platform === "youtube" ? absolutizeFileLinks(req, data) : data });
  } catch (error) {
    const message = error instanceof TypeError && /Invalid URL/i.test(error.message) ? "Masukkan URL yang valid" : error instanceof Error ? error.message : "Internal server error";
    return res.status(400).json({ success: false, error: message });
  }
});

/** Streams the media file from the platform CDN so the browser downloads it directly. */
app.get("/file", async (req, res) => {
  const ctrl = new AbortController();
  res.on("close", () => { if (!res.writableFinished) ctrl.abort(); });
  try {
    const rawTok = typeof req.query.t === "string" ? req.query.t : "";
    if (!rawTok || rawTok.length > 6000 || !/^[\w-]+$/.test(rawTok)) throw new Error("Token tidak valid");
    const tok = decodeToken(rawTok);

    const ua = tok.a || UA;
    const referer = tok.r === undefined ? "https://www.tiktok.com/" : tok.r;
    const headers: Record<string, string> = { "User-Agent": ua, Accept: "*/*" };
    if (referer) headers.Referer = referer;
    if (tok.c) headers.Cookie = tok.c;
    if (typeof req.headers.range === "string") headers.Range = req.headers.range;

    // --- MP3 (YouTube): stream audio sumber lewat ffmpeg (stdin -> stdout), host tetap lewat allow-list
    if (tok.t === "mp3") {
      const ff = await ffmpegBinary();
      if (!ff) return res.status(501).json({ success: false, error: "Konversi MP3 tidak tersedia di server ini (ffmpeg belum terpasang)" });
      if (ffmpegActive >= FFMPEG_MAX) return res.status(503).json({ success: false, error: "Server sedang sibuk, coba lagi sebentar" });
      const src = await safeFetch(tok.u, { headers: { "User-Agent": ua, Accept: "*/*" } }, allowCdn, undefined, ctrl.signal);
      if (!src.ok || !src.body) return res.status(502).json({ success: false, error: `Gagal mengambil audio dari server sumber (${src.status})` });
      ffmpegActive++;
      const proc = spawn(ff, ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-map", "0:a:0", "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "0", "-f", "mp3", "pipe:1"],
        { stdio: ["pipe", "pipe", "ignore"], env: childEnv(), windowsHide: true });
      let done = false;
      const finish = () => { if (done) return; done = true; ffmpegActive--; clearTimeout(timer); proc.kill("SIGKILL"); };
      const timer = setTimeout(() => { finish(); res.destroy(); }, 20 * 60_000);
      proc.on("error", () => { finish(); if (!res.headersSent) res.status(500).json({ success: false, error: "Gagal menjalankan ffmpeg" }); else res.destroy(); });
      proc.on("close", (code) => { const ok = code === 0; finish(); if (!ok && !res.writableEnded) res.destroy(); });
      res.on("close", finish);
      const name = tok.n.replace(/[^\w .()\-]+/g, "_");
      res.status(200);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(tok.n)}`);
      res.setHeader("Cache-Control", "private, no-store");
      proc.stdin.on("error", () => {});
      Readable.fromWeb(src.body as any).on("error", () => finish()).pipe(proc.stdin);
      proc.stdout.pipe(res);
      return;
    }

    let upstream = await safeFetch(tok.u, { headers }, allowCdn, undefined, ctrl.signal);
    if (upstream.status === 401 || upstream.status === 403) {
      // some CDN nodes reject Referer/cookies: retry once with plain browser headers
      await upstream.body?.cancel().catch(() => {});
      upstream = await safeFetch(tok.u, { headers: { "User-Agent": ua, Accept: "*/*" } }, allowCdn, undefined, ctrl.signal);
    }
    if (!upstream.ok && upstream.status !== 206) return res.status(502).json({ success: false, error: `Gagal mengambil file dari server sumber (${upstream.status})` });
    let type = upstream.headers.get("content-type") || "";
    if (tok.t === "audio" && !type.startsWith("audio/")) type = "audio/mpeg";
    if (tok.t === "video" && !type.startsWith("video/")) type = "video/mp4";
    if (tok.t === "image" && !type.startsWith("image/")) type = "image/jpeg";
    if (tok.t === "image") {
      const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : type.includes("heic") ? "heic" : "jpg";
      tok.n = tok.n.replace(/\.\w+$/, "." + ext);
      res.setHeader("X-File-Ext", ext);
    }
    const name = tok.n.replace(/[^\w .()\-]+/g, "_");
    res.status(upstream.status);
    res.setHeader("Content-Type", type);
    const inline = req.query.inline === "1" && tok.t === "image";
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(tok.n)}`);
    res.setHeader("Cache-Control", inline ? "private, max-age=600" : "private, no-store");
    for (const h of ["content-length", "content-range", "accept-ranges"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as any).on("error", () => res.destroy()).pipe(res);
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ success: false, error: "Link unduhan tidak valid atau sudah kedaluwarsa" });
    else res.destroy();
  }
});

// error handler: JSON rusak / terlalu besar -> pesan generik, tanpa stack trace
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  return res.status(400).json({ success: false, error: "Permintaan tidak valid" });
});

if (process.env.NODE_ENV !== "production") {
  app.use(express.static(path.join(process.cwd(), "public")));
  app.get("*", (_req, res) => res.sendFile(path.join(process.cwd(), "public/index.html")));
}
export default app;
