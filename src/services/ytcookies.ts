/*
  Made By Seikagenou
  Telegram : t.me/seikagenou
  Mohon Untuk Tidak Menghapus, Mengedit, dll Watermark Di Dalam Kode Ini
*/
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";

/* =====================================================================
   Cookies YouTube untuk yt-dlp
   Sumber (prioritas): YTDLP_COOKIES_FILE > YTDLP_COOKIES_BASE64 > YOUTUBE_COOKIES
   Format yang diterima (otomatis diubah ke Netscape cookies.txt):
     - Netscape cookies.txt (termasuk yang tab-nya rusak jadi spasi saat ditempel)
     - JSON export Cookie-Editor / EditThisCookie (array)
     - header string "SID=...; HSID=..."
   Cookie yang dipakai yt-dlp selalu salinan di folder sementara yang bisa ditulis
   (yt-dlp menyimpan cookie hasil rotasi ke file tersebut).
   ===================================================================== */

const DOMAIN_OK = /(^|\.)(youtube|google|googlevideo|youtube-nocookie)\.com$/i;
const AUTH_NAMES = ["SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PAPISID", "__Secure-3PAPISID", "LOGIN_INFO"];

export interface CookieSummary {
  source: "file" | "base64" | "env";
  total: number;
  youtube: number;
  expired: number;
  authPresent: string[];
  loggedIn: boolean;
}

const clean = (v: unknown) => String(v ?? "").replace(/[\t\r\n]+/g, "");

function fromJson(raw: string): string[] {
  const lines: string[] = [];
  let arr: any[];
  try { const j = JSON.parse(raw); arr = Array.isArray(j) ? j : Array.isArray(j?.cookies) ? j.cookies : []; } catch { return lines; }
  for (const c of arr) {
    const name = clean(c?.name);
    if (!name || typeof c?.value !== "string") continue;
    const domain = clean(c.domain || ".youtube.com");
    if (!DOMAIN_OK.test(domain.replace(/^\./, ""))) continue;
    const sub = domain.startsWith(".") || c.hostOnly === false;
    const exp = c.session || !c.expirationDate ? 0 : Math.floor(Number(c.expirationDate));
    lines.push([
      (c.httpOnly ? "#HttpOnly_" : "") + domain, sub ? "TRUE" : "FALSE", clean(c.path || "/"),
      c.secure ? "TRUE" : "FALSE", String(Number.isFinite(exp) ? exp : 0), name, clean(c.value),
    ].join("\t"));
  }
  return lines;
}

function fromNetscape(raw: string): string[] {
  const out: string[] = [];
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line) continue;
    if (line.startsWith("#") && !line.startsWith("#HttpOnly_")) continue;
    // tab rusak jadi spasi (umum saat ditempel ke Environment Variables): pulihkan 7 kolom
    let f = line.includes("\t") ? line.split("\t") : line.split(/\s+/);
    if (f.length > 7) f = [...f.slice(0, 6), f.slice(6).join(" ")];
    if (f.length !== 7) continue;
    const dom = f[0].replace(/^#HttpOnly_/, "");
    if (!DOMAIN_OK.test(dom.replace(/^\./, ""))) continue;
    out.push(f.map(clean).join("\t"));
  }
  return out;
}

function fromHeader(raw: string): string[] {
  const exp = String(Math.floor(Date.now() / 1000) + 365 * 86400);
  const out: string[] = [];
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const name = clean(part.slice(0, i).trim());
    if (name) out.push([".youtube.com", "TRUE", "/", "TRUE", exp, name, clean(part.slice(i + 1).trim())].join("\t"));
  }
  return out;
}

export function normalizeCookies(rawIn: string): { text: string; lines: string[] } {
  let raw = rawIn.replace(/^\uFEFF/, "").trim();
  if (!raw.includes("\n") && raw.includes("\\n")) raw = raw.replace(/\\n/g, "\n");
  let lines: string[];
  if (raw.startsWith("[") || raw.startsWith("{")) lines = fromJson(raw);
  else if (/^\S+\s+(TRUE|FALSE)\s+/im.test(raw) || raw.includes("# Netscape") || raw.includes("# HTTP Cookie File")) lines = fromNetscape(raw);
  else lines = fromHeader(raw);
  return { lines, text: "# Netscape HTTP Cookie File\n" + lines.join("\n") + "\n" };
}

export function summarize(lines: string[], source: CookieSummary["source"]): CookieSummary {
  const now = Math.floor(Date.now() / 1000);
  const names = new Set<string>();
  let youtube = 0, expired = 0;
  const live = new Set<string>();
  for (const l of lines) {
    const f = l.split("\t");
    const dom = f[0].replace(/^#HttpOnly_/, "").replace(/^\./, "");
    if (/(^|\.)youtube\.com$/i.test(dom)) youtube++;
    const exp = Number(f[4]);
    const isExpired = exp > 0 && exp < now;
    if (isExpired) expired++;
    names.add(f[5]);
    if (!isExpired) live.add(f[5]);
  }
  const authPresent = AUTH_NAMES.filter((n) => names.has(n));
  const loggedIn = ["SAPISID", "__Secure-3PAPISID", "__Secure-1PAPISID", "__Secure-3PSID", "SID", "LOGIN_INFO"].some((n) => live.has(n));
  return { source, total: lines.length, youtube, expired, authPresent, loggedIn };
}

/** Tidak pernah memuat nilai cookie, hanya jumlah dan nama cookie autentikasi. */
export function describe(s: CookieSummary | undefined): string {
  if (!s) return "tidak ada cookies yang dikonfigurasi";
  return `sumber=${s.source}, total=${s.total}, youtube.com=${s.youtube}, kedaluwarsa=${s.expired}, cookie login=[${s.authPresent.join(",") || "tidak ada"}], login terdeteksi=${s.loggedIn ? "ya" : "TIDAK"}`;
}

export class CookieConfigError extends Error {}

let cached: { sig: string; file: string; summary: CookieSummary } | undefined;

/**
 * Menyiapkan file cookies untuk yt-dlp. Mengembalikan null jika tidak ada konfigurasi cookies.
 * Melempar CookieConfigError bila cookies dikonfigurasi tetapi tidak bisa dipakai.
 */
export function prepareCookies(): { file: string; summary: CookieSummary } | null {
  let raw = "";
  let source: CookieSummary["source"] = "env";
  const filePath = process.env.YTDLP_COOKIES_FILE?.trim();
  if (filePath) {
    source = "file";
    if (!existsSync(filePath)) throw new CookieConfigError(`File cookies tidak ditemukan di server (YTDLP_COOKIES_FILE=${basename(filePath)}). Tanpa file, yt-dlp diam-diam berjalan tanpa cookies`);
    try { raw = readFileSync(filePath, "utf8"); } catch { throw new CookieConfigError("File cookies tidak bisa dibaca (periksa izin file)"); }
  } else if (process.env.YTDLP_COOKIES_BASE64?.trim()) {
    source = "base64";
    raw = Buffer.from(process.env.YTDLP_COOKIES_BASE64.trim(), "base64").toString("utf8");
  } else if (process.env.YOUTUBE_COOKIES?.trim()) {
    raw = process.env.YOUTUBE_COOKIES;
  } else return null;

  const sig = createHash("sha1").update(source).update(raw).digest("hex");
  if (cached && cached.sig === sig && existsSync(cached.file)) return { file: cached.file, summary: cached.summary };

  const { text, lines } = normalizeCookies(raw);
  const summary = summarize(lines, source);
  if (!lines.length) throw new CookieConfigError("Cookies terbaca tetapi tidak berisi satu pun cookie youtube.com/google.com (format tidak dikenali atau salah domain)");
  if (!summary.loggedIn) throw new CookieConfigError(`Cookies tidak berisi sesi login yang masih berlaku (${describe(summary)}). Ekspor ulang saat akun sedang login`);

  const dir = join(tmpdir(), "fetchio-cookies");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `yt-${sig.slice(0, 12)}.txt`);
  writeFileSync(file, text, { mode: 0o600 });
  cached = { sig, file, summary };
  return { file, summary };
}

/** Hapus nilai sensitif dari teks log. */
export function redact(s: string): string {
  return s
    .replace(/((?:__Secure-\w+|SAPISID|APISID|SSID|HSID|SID|LOGIN_INFO|SIDCC)[=\s:]+)[^\s;"']+/g, "$1<redacted>")
    .replace(/((?:Cookie|Authorization)[:=]\s*)\S.*/gi, "$1<redacted>");
}
