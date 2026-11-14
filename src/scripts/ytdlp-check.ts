import { diagnoseYouTube } from "../services/platforms/youtube";
import { ytdlpBinary, runYtDlp } from "../services/ytdlp";

(async () => {
  try {
    console.log("yt-dlp:", await ytdlpBinary(), (await runYtDlp(["--version"], { timeout: 30_000, maxBuffer: 1 << 20 })).stdout.trim());
  } catch (e: any) { console.log("yt-dlp: TIDAK TERSEDIA -", e?.message ?? e); process.exit(1); }
  const r = await diagnoseYouTube(process.argv[2] || undefined);
  console.log("cookies:", r.cookies);
  console.log("hasil  :", r.ok ? "BERHASIL mengambil data video" : "GAGAL");
  console.log("--- stderr yt-dlp (nilai cookie disamarkan) ---");
  console.log(r.stderr.split("\n").filter((l) => /ERROR|WARNING|cookie|bot|sign in|client|player|js runtime|ejs|proxy/i.test(l)).slice(-25).join("\n") || "(kosong)");
  process.exit(r.ok ? 0 : 2);
})();
