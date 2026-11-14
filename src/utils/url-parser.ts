export type Platform = "tiktok" | "youtube" | "instagram" | "facebook" | "twitter" | "unknown";

const TIKTOK_HOSTS = ["tiktok.com", "tiktokv.com", "tiktokv.us", "tt.site"];

export function isTikTokHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return TIKTOK_HOSTS.some((d) => h === d || h.endsWith("." + d));
}

export function parseMediaUrl(value: string) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed");
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  let platform: Platform = "unknown";
  if (isTikTokHost(host)) platform = "tiktok";
  else if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") platform = "youtube";
  else if (host === "instagram.com" || host.endsWith(".instagram.com")) platform = "instagram";
  else if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") platform = "facebook";
  else if (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com")) platform = "twitter";
  return { url: parsed.toString(), platform };
}
