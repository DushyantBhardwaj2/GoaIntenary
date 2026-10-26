export type ReelIdeaInput = {
  title: string;
  kind: "reel" | "photo";
  instagramUrl: string | null;
  location: string;
  notes: string;
  participantUserIds: string[];
};

export type ReelIdea = ReelIdeaInput & {
  id: string;
  tripId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

/** Also guard stored references before putting an external URL in a link. */
export function instagramReference(value: string | null): string | null {
  if (!value?.trim()) return null;
  if (/[\s\u0000-\u001f\u007f\\]/.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !(url.hostname === "instagram.com" || url.hostname.endsWith(".instagram.com"))) return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch { return null; }
}
