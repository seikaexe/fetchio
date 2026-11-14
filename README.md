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

## YouTube: SnapYT
YouTube diproses lewat SnapYT (`https://www.snapyt.app`) di `src/services/platforms/youtube.ts` (port dari scraper Node: nonce -> `process_video_url` -> halaman preview -> daftar format). Tanpa yt-dlp, cookies, ffmpeg, axios, maupun cheerio.

- Link unduhan adalah link SnapYT (`data-force`) yang langsung dibuka browser pengguna, tidak lewat server Fetchio.
- Deskripsi, views, dan tanggal upload tidak tersedia dari SnapYT; nama channel diambil dari YouTube oEmbed.
- Env opsional: `SNAPYT_BASE`. Cek alur: `npm run ytdlp:check [VIDEO_ID]`.
- `ytdlp.ts` dan `ytcookies.ts` sudah tidak dipakai YouTube; boleh dihapus bersama Dockerfile yt-dlp jika tidak diperlukan lagi.

## YouTube: cookies & diagnosis
- Isi cookies lewat `YTDLP_COOKIES_FILE`, `YTDLP_COOKIES_BASE64`, atau `YOUTUBE_COOKIES`. Format apa pun diterima (Netscape, JSON Cookie-Editor, atau header `SID=...; ...`) dan otomatis diubah ke Netscape di folder sementara.
- Cookies yang dikonfigurasi tapi tidak bisa dipakai (file tidak ada, tidak ada sesi login, semua kedaluwarsa) sekarang menghasilkan pesan error yang jelas, bukan diam-diam berjalan tanpa cookies.
- Cara ekspor yang tahan lama (YouTube merotasi cookies tab yang terbuka): jendela incognito -> login -> buka `https://www.youtube.com/robots.txt` di tab yang sama -> ekspor cookies youtube.com -> tutup jendela incognito tanpa logout.
- Cek penyebab kegagalan: `npm run ytdlp:check` (menampilkan ringkasan cookies tanpa nilainya dan stderr asli yt-dlp). Log server juga mencatat stderr yt-dlp (`[yt-dlp] ...`).
- Jika IP server (datacenter, termasuk Vercel) ditandai YouTube, cookies saja tidak cukup: pakai `YTDLP_PROXY` residensial. `YTDLP_PLAYER_CLIENT` (mis. `tv,web_safari`) bisa dicoba untuk eksperimen.
