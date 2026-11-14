import { diagnoseYouTube } from "../services/platforms/youtube";

// Mengecek alur YouTube (SnapYT). Pemakaian: npm run ytdlp:check [VIDEO_ID]
(async () => {
  const r = await diagnoseYouTube(process.argv[2] || undefined);
  console.log("hasil  :", r.ok ? "BERHASIL mengambil data video" : "GAGAL");
  console.log("detail :", r.stderr);
  process.exit(r.ok ? 0 : 2);
})();
