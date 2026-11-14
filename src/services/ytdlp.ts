/*
  Made By Seikagenou
  Telegram : t.me/seikagenou
  Mohon Untuk Tidak Menghapus, Mengedit, dll Watermark Di Dalam Kode Ini
*/
import { execFile } from "child_process";
import { createHash } from "crypto";
import { access, chmod, mkdir, rename, writeFile } from "fs/promises";
import { constants } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";

/* =====================================================================
   yt-dlp sebagai dependency EKSTERNAL (tidak ada source yt-dlp di repository)

   Urutan pencarian executable:
     1. env YTDLP_PATH                    path binary yt-dlp
     2. `yt-dlp` di PATH server           (dipasang di Dockerfile / apt / pipx / dll)
     3. salinan cache di folder sementara hasil unduhan otomatis sebelumnya
     4. unduh binary resmi dari GitHub Releases ke folder sementara (hanya jika belum ada)
        - diverifikasi SHA-256 dari SHA2-256SUMS rilis yang sama
        - matikan dengan YTDLP_AUTO_DOWNLOAD=0

   Env (semua opsional):
     YTDLP_PATH           path executable yt-dlp
     YTDLP_AUTO_DOWNLOAD  "0" = jangan pernah mengunduh otomatis
     YTDLP_CACHE_DIR      folder cache binary (default: <tmp>/fetchio-bin)
     FFMPEG_PATH          path ffmpeg (default: `ffmpeg` di PATH), dipakai untuk MP3
   ===================================================================== */

const run = promisify(execFile);
const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

export class YtDlpUnavailable extends Error {}

/** Environment minimal untuk proses anak: rahasia aplikasi (cookies, dll) tidak ikut terbawa. */
export function childEnv(): NodeJS.ProcessEnv {
  const keep = [
    "PATH", "PATHEXT", "HOME", "USERPROFILE", "LANG", "LC_ALL", "SystemRoot", "ComSpec",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
  ];
  const env: NodeJS.ProcessEnv = { TMPDIR: tmpdir(), TEMP: tmpdir(), TMP: tmpdir() };
  for (const k of keep) if (process.env[k]) env[k] = process.env[k];
  return env;
}

function assetName(): string | null {
  const { platform, arch } = process;
  if (platform === "linux") return arch === "x64" ? "yt-dlp_linux" : arch === "arm64" ? "yt-dlp_linux_aarch64" : null;
  if (platform === "darwin") return "yt-dlp_macos";
  if (platform === "win32") return "yt-dlp.exe";
  return null;
}

async function probe(bin: string): Promise<string> {
  // binary PyInstaller mengekstrak diri saat pertama jalan, beri waktu longgar
  const { stdout } = await run(bin, ["--version"], { timeout: 30_000, windowsHide: true, env: childEnv() });
  return String(stdout).trim();
}

async function install(dest: string, asset: string): Promise<void> {
  const get = async (url: string, ms: number) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) throw new Error(`HTTP ${r.status} saat mengunduh ${url}`);
    return r;
  };
  const sums = await (await get(RELEASE + "SHA2-256SUMS", 30_000)).text();
  const line = sums.split(/\r?\n/).map((l) => l.trim().split(/\s+\*?/)).find((p) => p.length === 2 && p[1] === asset);
  if (!line || !/^[a-f0-9]{64}$/i.test(line[0])) throw new Error("Checksum yt-dlp tidak ditemukan");
  const buf = Buffer.from(await (await get(RELEASE + asset, 180_000)).arrayBuffer());
  if (createHash("sha256").update(buf).digest("hex") !== line[0].toLowerCase()) throw new Error("Checksum yt-dlp tidak cocok");
  await mkdir(dirname(dest), { recursive: true });
  const part = `${dest}.part-${process.pid}-${Date.now()}`;
  await writeFile(part, buf, { mode: 0o755 });
  await chmod(part, 0o755);
  await rename(part, dest);
}

async function findOrInstall(): Promise<string> {
  const explicit = process.env.YTDLP_PATH?.trim();
  if (explicit) {
    try { await probe(explicit); return explicit; } catch { throw new YtDlpUnavailable("yt-dlp tidak bisa dijalankan di server (cek YTDLP_PATH)"); }
  }
  try { await probe("yt-dlp"); return "yt-dlp"; } catch { /* lanjut ke cache / unduh */ }

  const asset = assetName();
  const notFound = new YtDlpUnavailable("yt-dlp belum terpasang di server");
  if (!asset) throw notFound;
  const dest = join(process.env.YTDLP_CACHE_DIR || join(tmpdir(), "fetchio-bin"), asset);
  try { await access(dest, constants.X_OK); await probe(dest); return dest; } catch { /* belum ada / rusak */ }

  if (process.env.YTDLP_AUTO_DOWNLOAD === "0") throw notFound;
  try {
    await install(dest, asset);
    await probe(dest);
    return dest;
  } catch {
    throw new YtDlpUnavailable("yt-dlp belum terpasang di server dan unduh otomatis gagal");
  }
}

let cached: Promise<string> | undefined;
/** Path executable yt-dlp (hasil pencarian di-cache; kalau gagal akan dicoba lagi di request berikutnya). */
export function ytdlpBinary(): Promise<string> {
  cached ??= findOrInstall().catch((e) => { cached = undefined; throw e; });
  return cached;
}

/** Menjalankan yt-dlp lewat child_process (tanpa shell). stderr ikut dikembalikan (berisi WARNING penting). */
export async function runYtDlp(args: string[], opt: { timeout: number; maxBuffer: number }): Promise<{ stdout: string; stderr: string }> {
  const bin = await ytdlpBinary();
  const { stdout, stderr } = await run(bin, args, { timeout: opt.timeout, maxBuffer: opt.maxBuffer, windowsHide: true, env: childEnv() });
  return { stdout: String(stdout), stderr: String(stderr) };
}

let ffmpegCache: Promise<string | null> | undefined;
/** Path ffmpeg kalau tersedia (untuk konversi MP3), selain itu null. */
export function ffmpegBinary(): Promise<string | null> {
  ffmpegCache ??= (async () => {
    const bin = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    try { await run(bin, ["-version"], { timeout: 10_000, windowsHide: true, env: childEnv() }); return bin; } catch { return null; }
  })();
  return ffmpegCache;
}
