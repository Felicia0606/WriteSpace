import { createClient } from "@supabase/supabase-js";
import { auth } from "@/config/firebase";
import type {
  PeerComment,
  PeerReaction,
  ReviewAccess,
  TextAnchor,
  ReactionEmoji,
} from "./types";

const url = import.meta.env.VITE_SUPABASE_URL;
const key =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY;
const client = (() => {
  if (!url || !key) return null;
  try {
    return createClient(url, key, {
      accessToken: async () => (await auth?.currentUser?.getIdToken()) ?? null,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    return null;
  }
})();
export const peerReviewConfigured = Boolean(client);

async function request<T>(
  classId: string,
  groupId: string,
  action: string,
  values = {},
): Promise<T> {
  if (!client)
    throw new Error(
      "Peer feedback is not connected yet. Please contact your teacher.",
    );
  const token = await auth?.currentUser?.getIdToken();
  if (!token) throw new Error("Please sign in again to open peer feedback.");
  const response = await fetch(`${url}/functions/v1/peer-review`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ classId, groupId, action, ...values }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      result.error || "Could not save peer feedback. Please try again.",
    );
  return result as T;
}

export const openReview = (classId: string, groupId: string) =>
  request<ReviewAccess>(classId, groupId, "open");
export const addPeerComment = (
  classId: string,
  groupId: string,
  snapshotId: string,
  body: string,
  anchor: TextAnchor | null,
  id: string,
) => request(classId, groupId, "comment", { snapshotId, body, anchor, id });
export const setPeerReaction = (
  classId: string,
  groupId: string,
  emoji: ReactionEmoji,
  active: boolean,
) => request(classId, groupId, "reaction", { emoji, active });

export async function loadFeedback(classId: string, groupId: string) {
  if (!client) throw new Error("Peer feedback is not connected yet.");
  // Paginate instead of silently omitting comments after the server's row limit.
  async function rows<T>(table: string): Promise<T[]> {
    const all: T[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await client!
        .from(table)
        .select("*")
        .eq("class_id", classId)
        .eq("group_id", groupId)
        .order("created_at")
        .order("id")
        .range(offset, offset + 499);
      if (error)
        throw new Error(
          "Could not load feedback. Check your connection and retry.",
        );
      all.push(...(data as T[]));
      if (data.length < 500) return all;
    }
  }
  const [comments, reactions] = await Promise.all([
    rows<PeerComment>("peer_review_comments"),
    rows<PeerReaction>("peer_review_reactions"),
  ]);
  return { comments, reactions: reactions.filter((r) => r.active) };
}

export async function subscribeFeedback(
  groupId: string,
  changed: () => void,
  status: (live: boolean) => void,
) {
  if (!client) return () => {};
  await client.realtime.setAuth(await auth.currentUser.getIdToken());
  const channel = client
    .channel(`peer-review:${groupId}:${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "peer_review_comments",
        filter: `group_id=eq.${groupId}`,
      },
      changed,
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "peer_review_reactions",
        filter: `group_id=eq.${groupId}`,
      },
      changed,
    )
    .subscribe((state) => {
      status(state === "SUBSCRIBED");
      if (state === "SUBSCRIBED") changed();
    });
  return () => {
    void client.removeChannel(channel);
  };
}

export async function refreshReviewToken() {
  if (client && auth?.currentUser)
    await client.realtime.setAuth(await auth.currentUser.getIdToken());
}
