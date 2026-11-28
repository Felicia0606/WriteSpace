import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerReviewDialog } from "../src/features/peer-review/PeerReviewDialog";
import * as api from "../src/features/peer-review/api";
import type {
  PeerComment,
  PeerReaction,
} from "../src/features/peer-review/types";

vi.mock("../src/features/peer-review/api", () => ({
  peerReviewConfigured: true,
  openReview: vi.fn(),
  loadFeedback: vi.fn(),
  subscribeFeedback: vi.fn(),
  refreshReviewToken: vi.fn(),
  addPeerComment: vi.fn(),
  setPeerReaction: vi.fn(),
}));

const comments: PeerComment[] = [
  {
    id: "comment",
    class_id: "class",
    group_id: "group",
    snapshot_id: "snapshot",
    author_uid: "reviewer",
    author_name: "Taylor",
    body: "A clear opening.",
    selection_start: 0,
    selection_end: 4,
    quote: "Good",
    created_at: "2026-11-27T00:00:00Z",
  },
];
const props = {
  classId: "class",
  groupId: "group",
  groupName: "Group 2",
  userId: "student",
  onClose: vi.fn(),
};
const stop = vi.fn();
let changed: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.openReview).mockResolvedValue({
    snapshot: { id: "snapshot", text_content: "Good writing." },
    canWrite: true,
  });
  vi.mocked(api.loadFeedback).mockResolvedValue({
    comments: [...comments],
    reactions: [],
  });
  vi.mocked(api.subscribeFeedback).mockImplementation(
    async (_group, listener, status) => {
      changed = listener;
      status(true);
      return stop;
    },
  );
  vi.mocked(api.refreshReviewToken).mockResolvedValue(undefined);
  vi.mocked(api.addPeerComment).mockResolvedValue({});
  vi.mocked(api.setPeerReaction).mockResolvedValue({});
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("Inline peer feedback interactions", () => {
  it("shows stored author, timestamp and anchored feedback in a read-only essay", async () => {
    render(createElement(PeerReviewDialog, props));
    expect(await screen.findByText("Taylor")).toBeInTheDocument();
    expect(screen.getByText("A clear opening.")).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute(
      "datetime",
      comments[0].created_at,
    );
    expect(screen.getByLabelText("Read-only essay")).not.toHaveAttribute(
      "contenteditable",
    );
    fireEvent.keyDown(
      screen.getByRole("button", { name: /Read 1 comment on: Good/ }),
      { key: "Enter" },
    );
    expect(screen.getByText("Taylor").closest("button")).toHaveFocus();
  });
  it("captures a selected passage and persists its exact anchor", async () => {
    render(createElement(PeerReviewDialog, props));
    const essay = await screen.findByLabelText("Read-only essay");
    const range = document.createRange();
    range.setStart(essay.querySelector("mark")!.firstChild!, 0);
    range.setEnd(essay.querySelector("mark")!.firstChild!, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.mouseUp(essay);
    fireEvent.change(screen.getByLabelText("Your comment"), {
      target: { value: "Helpful opening" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() =>
      expect(api.addPeerComment).toHaveBeenCalledWith(
        "class",
        "group",
        "snapshot",
        "Helpful opening",
        { start: 0, end: 4, quote: "Good" },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("General comment")).toHaveValue(""),
    );
    selection.removeAllRanges();
  });
  it("retains drafts and the idempotency key across failed save retries", async () => {
    vi.mocked(api.addPeerComment).mockRejectedValueOnce(
      new Error("Connection lost"),
    );
    render(createElement(PeerReviewDialog, props));
    const input = await screen.findByLabelText("General comment");
    fireEvent.change(input, { target: { value: "Keep my feedback" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Connection lost",
    );
    expect(input).toHaveValue("Keep my feedback");
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(api.addPeerComment).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.addPeerComment).mock.calls;
    expect(calls[0][5]).toBe(calls[1][5]);
    await waitFor(() => expect(input).toHaveValue(""));
  });
  it("sends explicit reaction state and displays realtime updates", async () => {
    render(createElement(PeerReviewDialog, props));
    const button = await screen.findByRole("button", {
      name: "👍 reaction, 0",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(api.setPeerReaction).toHaveBeenCalledWith(
        "class",
        "group",
        "👍",
        true,
      ),
    );
    const reaction: PeerReaction = {
      id: "r",
      class_id: "class",
      group_id: "group",
      author_uid: "student",
      author_name: "Sam",
      emoji: "👍",
      active: true,
      created_at: comments[0].created_at,
    };
    vi.mocked(api.loadFeedback).mockResolvedValue({
      comments,
      reactions: [reaction],
    });
    await act(async () => {
      changed();
    });
    const active = await screen.findByRole("button", {
      name: "👍 reaction, 1",
    });
    expect(active).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(active);
    await waitFor(() =>
      expect(api.setPeerReaction).toHaveBeenLastCalledWith(
        "class",
        "group",
        "👍",
        false,
      ),
    );
  });
  it("disables mutation controls for teachers and essay owners", async () => {
    vi.mocked(api.openReview).mockResolvedValue({
      snapshot: { id: "snapshot", text_content: "Good writing." },
      canWrite: false,
    });
    render(createElement(PeerReviewDialog, props));
    expect(
      await screen.findByRole("button", { name: "👍 reaction, 0" }),
    ).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Taylor")).toBeInTheDocument();
  });
  it("shows access failures without exposing feedback", async () => {
    vi.mocked(api.openReview).mockRejectedValue(
      new Error("Submit your essay first."),
    );
    render(createElement(PeerReviewDialog, props));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Submit your essay first.",
    );
    expect(screen.queryByLabelText("Read-only essay")).not.toBeInTheDocument();
    expect(api.loadFeedback).not.toHaveBeenCalled();
  });
  it("cleans up subscriptions and supports Escape to close", async () => {
    const view = render(createElement(PeerReviewDialog, props));
    await screen.findByText("Taylor");
    await waitFor(() => expect(api.subscribeFeedback).toHaveBeenCalled());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(props.onClose).toHaveBeenCalled();
    view.unmount();
    expect(stop).toHaveBeenCalled();
    expect(document.body.style.overflow).toBe("");
  });
});
