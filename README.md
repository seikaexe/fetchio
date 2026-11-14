# Fetchio

Download TikTok videos (MP4 up to the source resolution: 1080p / 4K / 8K), MP3 audio, and photo slideshows (per slide or all as ZIP).

## Local
```
npm install
npm run dev
```
Open http://localhost:3000

## Deploy
Import the repo into Vercel (Node 26.x). Static files live in `public/`; the Express handler in `api/index.ts` is exposed at `/download` and `/file` through `vercel.json` rewrites.

## YouTube
`src/services/platforms/youtube.ts` scrapes: thumbnail, video (lowest -> highest resolution; adaptive streams are video-only and labelled "tanpa audio"), audio, caption (SRT/VTT/TXT), description, creator, subscriber count, upload date, and (if present in page data) edit date.

Set `YOUTUBE_COOKIES` (see `.env.example`) locally in `.env` and on Vercel as an environment variable. Cookies stay on the server.

## Keamanan
- Tidak ada database yang terhubung, jadi tidak ada query SQL yang bisa disuntik. `database-schema.sql` hanya rencana.
- Input `/download` divalidasi ketat (hanya URL http/https polos, tanpa karakter kontrol/kutip/`<>`/user:pass, maks 2048 karakter, body JSON maks 4 KB).
- Link unduhan YouTube lewat `/file` dengan allow-list host (googlevideo/ytimg); proses anak (yt-dlp/ffmpeg) dijalankan tanpa shell dan tanpa rahasia aplikasi di environment-nya.
- Jika database ditambahkan nanti: wajib prepared statement / parameter binding, jangan gabungkan string ke query.

## YouTube: yt-dlp eksternal
YouTube memakai yt-dlp saja (tanpa API pihak ketiga). **Source yt-dlp tidak ada di repository**: aplikasi memanggil executable `yt-dlp` lewat `child_process` (`src/services/ytdlp.ts`, tanpa shell).

Urutan pencarian executable: `YTDLP_PATH` -> `yt-dlp` di PATH -> salinan cache di folder sementara -> unduh otomatis binary resmi dari GitHub Releases ke folder sementara (diverifikasi SHA-256, matikan dengan `YTDLP_AUTO_DOWNLOAD=0`).

- **Docker / VPS (disarankan)**: `docker build -t fetchio . && docker run -p 3000:3000 fetchio`. Dockerfile memasang binary resmi (sudah membawa yt-dlp-ejs) + ffmpeg. Perbarui yt-dlp dengan `docker build --no-cache`.
- **Server biasa**: pasang yt-dlp (binary resmi dari GitHub Releases, atau `pipx install "yt-dlp[default]"`) dan Node.js 20+; opsional `ffmpeg` untuk MP3.
- **Vercel / tanpa Docker**: tidak ada yt-dlp di PATH, jadi binary diunduh otomatis ke `/tmp` saat request pertama (cold start lebih lama). MP3 tidak tersedia tanpa ffmpeg. IP Vercel sering diblokir YouTube; pakai cookies/proxy bila perlu.
- Env: lihat `.env.example` (`YTDLP_PATH`, `YTDLP_AUTO_DOWNLOAD`, `YTDLP_COOKIES_FILE`, `YOUTUBE_COOKIES`, `YTDLP_PROXY`, `YTDLP_REMOTE_COMPONENTS`, `YTDLP_MAX_PARALLEL`, `FFMPEG_PATH`, `PUBLIC_BASE_URL`).
- Hasil diunduh lewat `/file` karena link googlevideo terikat ke IP server. MP3 dikonversi saat diunduh (ffmpeg, 192 kbps).
