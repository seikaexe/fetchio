import { Platform } from "../../utils/url-parser";
import { resolveTikTok, MediaResult } from "./tiktok";
import { resolveYouTube } from "./youtube";

export type { MediaResult };

export async function resolveMedia(platform: Platform, url: string): Promise<MediaResult> {
  if (platform === "tiktok") return resolveTikTok(url);
  if (platform === "youtube") return resolveYouTube(url);
  if (platform === "unknown") throw new Error("Platform tidak dikenali. Saat ini link TikTok dan YouTube yang didukung.");
  throw new Error("Saat ini hanya TikTok dan YouTube yang didukung. Platform lain segera hadir.");
}
