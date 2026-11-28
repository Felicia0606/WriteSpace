import { describe, expect, it } from "vitest";
import {
  captureAnchor,
  highlightSegments,
} from "../src/features/peer-review/anchors";
import {
  reviewPermission,
  validateAnchor,
} from "../supabase/functions/peer-review/policy";
import type { PeerComment } from "../src/features/peer-review/types";

function comment(
  id: string,
  start: number,
  end: number,
  quote: string,
  snapshot = "v1",
): PeerComment {
  return {
    id,
    class_id: "class",
    group_id: "target",
    snapshot_id: snapshot,
    author_uid: "student",
    author_name: "Sam",
    body: "Feedback",
    selection_start: start,
    selection_end: end,
    quote,
    created_at: "2026-11-27T00:00:00Z",
  };
}

describe("Persistent text anchors", () => {
  it("highlights the selected occurrence of repeated text only", () => {
    const segments = highlightSegments("Good work. Good work.", "v1", [
      comment("a", 11, 15, "Good"),
    ]);
    expect(segments.filter((s) => s.commentIds.length)).toEqual([
      { start: 11, text: "Good", commentIds: ["a"] },
    ]);
    expect(segments.map((s) => s.text).join("")).toBe("Good work. Good work.");
  });
  it("preserves every overlapping comment without duplicating text", () => {
    const segments = highlightSegments("abcdef", "v1", [
      comment("a", 0, 4, "abcd"),
      comment("b", 2, 6, "cdef"),
    ]);
    expect(segments.map((s) => [s.text, s.commentIds])).toEqual([
      ["ab", ["a"]],
      ["cd", ["a", "b"]],
      ["ef", ["b"]],
    ]);
  });
  it("does not attach stale or mismatching selections to a revised essay", () => {
    const segments = highlightSegments("changed", "v2", [
      comment("old", 0, 3, "cha"),
      comment("wrong", 0, 3, "not", "v2"),
    ]);
    expect(segments.every((s) => s.commentIds.length === 0)).toBe(true);
  });
  it("captures a range across highlighted nodes, newlines and emoji", () => {
    const root = document.createElement("div");
    root.innerHTML = "<span>Hi 😀\n</span><mark>Good</mark><span> work</span>";
    document.body.append(root);
    const range = document.createRange();
    range.setStart(root.children[0].firstChild!, 3);
    range.setEnd(root.children[2].firstChild!, 5);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureAnchor(root, selection)).toEqual({
      start: 3,
      end: 15,
      quote: "😀\nGood work",
    });
    selection.removeAllRanges();
    root.remove();
  });
  it("rejects selections that extend outside the essay", () => {
    const root = document.createElement("div");
    root.textContent = "Essay";
    const outside = document.createTextNode("Outside");
    document.body.append(root, outside);
    const range = document.createRange();
    range.setStart(root.firstChild!, 0);
    range.setEnd(outside, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(captureAnchor(root, selection)).toBeNull();
    selection.removeAllRanges();
    root.remove();
    outside.remove();
  });
  it("validates exact UTF-16 positions on the server", () => {
    expect(validateAnchor("A😀B", { start: 1, end: 3, quote: "😀" })).toEqual({
      start: 1,
      end: 3,
      quote: "😀",
    });
    for (const anchor of [
      { start: -1, end: 3, quote: "😀" },
      { start: 1, end: 2, quote: "😀" },
      { start: 0, end: 999, quote: "A" },
      { start: 0.5, end: 1, quote: "A" },
    ]) {
      expect(() => validateAnchor("A😀B", anchor)).toThrow();
    }
  });
});

describe("Peer review authorization", () => {
  const target = { classId: "class", status: "SUBMITTED" };
  const essay = { classId: "class", status: "SUBMITTED" };
  const student = { groupId: "own", name: "Sam" };
  const own = {
    classId: "class",
    status: "SUBMITTED",
    members: [{ uid: "student", name: "Sam" }],
    memberIds: ["student"],
  };
  it("allows submitted classmates to review other submitted essays", () => {
    expect(
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        target,
        essay,
        student,
        own,
        "SUBMITTED",
      ),
    ).toEqual({ canWrite: true, authorName: "Sam" });
  });
  it("gives teachers and essay owners read-only access to peer feedback", () => {
    expect(
      reviewPermission(
        "teacher",
        "teacher",
        "class",
        "target",
        target,
        essay,
        null,
        null,
      ).canWrite,
    ).toBe(false);
    expect(
      reviewPermission(
        "student",
        "teacher",
        "class",
        "own",
        target,
        essay,
        student,
        own,
        "REVIEWED",
      ).canWrite,
    ).toBe(false);
  });
  it("denies unsubmitted reviewers even if their document or group claims submission", () => {
    expect(() =>
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        target,
        essay,
        student,
        { ...own, status: "WRITING" },
        "SUBMITTED",
      ),
    ).toThrow(/Submit/);
    expect(() =>
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        target,
        essay,
        student,
        own,
        "WRITING",
      ),
    ).toThrow(/Submit/);
  });
  it("rejects removed members, unrelated classes and unsubmitted target essays", () => {
    expect(() =>
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        target,
        essay,
        student,
        { ...own, memberIds: [] },
        "SUBMITTED",
      ),
    ).toThrow(/member/);
    expect(() =>
      reviewPermission(
        "intruder",
        "teacher",
        "class",
        "target",
        target,
        essay,
        student,
        own,
        "SUBMITTED",
      ),
    ).toThrow(/member/);
    expect(() =>
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        { ...target, classId: "other" },
        essay,
        student,
        own,
        "SUBMITTED",
      ),
    ).toThrow(/classroom/);
    expect(() =>
      reviewPermission(
        "student",
        "teacher",
        "class",
        "target",
        target,
        { ...essay, status: "WRITING" },
        student,
        own,
        "SUBMITTED",
      ),
    ).toThrow(/not currently submitted/);
  });
});
