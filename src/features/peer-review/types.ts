export const REACTIONS = ["👍", "❤️", "💡", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];

export interface TextAnchor {
  start: number;
  end: number;
  quote: string;
}
export interface PeerComment {
  id: string;
  class_id: string;
  group_id: string;
  snapshot_id: string;
  author_uid: string;
  author_name: string;
  body: string;
  selection_start: number | null;
  selection_end: number | null;
  quote: string | null;
  created_at: string;
}
export interface PeerReaction {
  id: string;
  class_id: string;
  group_id: string;
  author_uid: string;
  author_name: string;
  emoji: ReactionEmoji;
  active: boolean;
  created_at: string;
}
export interface ReviewSnapshot {
  id: string;
  text_content: string;
}
export interface ReviewAccess {
  snapshot: ReviewSnapshot;
  canWrite: boolean;
}
