import type { PeerComment, TextAnchor } from "./types";

// UTF-16 offsets match DOM Range and JavaScript slice, including emoji.
export function captureAnchor(
  root: HTMLElement,
  selection: Selection | null,
): TextAnchor | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  const quote = range.toString();
  if (!quote.trim()) return null;
  return { start, end: start + quote.length, quote };
}

export function highlightSegments(
  text: string,
  snapshotId: string,
  comments: PeerComment[],
) {
  const anchored = comments.filter(
    (c) =>
      c.snapshot_id === snapshotId &&
      c.selection_start !== null &&
      c.selection_end !== null &&
      c.selection_start >= 0 &&
      c.selection_end > c.selection_start &&
      c.selection_end <= text.length &&
      text.slice(c.selection_start, c.selection_end) === c.quote,
  );
  const boundaries = [
    ...new Set([
      0,
      text.length,
      ...anchored.flatMap((c) => [c.selection_start!, c.selection_end!]),
    ]),
  ].sort((a, b) => a - b);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    return {
      start,
      text: text.slice(start, end),
      commentIds: anchored
        .filter((c) => c.selection_start! <= start && c.selection_end! >= end)
        .map((c) => c.id),
    };
  });
}
