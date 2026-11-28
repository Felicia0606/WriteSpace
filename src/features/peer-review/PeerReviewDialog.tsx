import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, X, Send, Lock, RefreshCw } from "lucide-react";
import { cn } from "@/utils";
import { captureAnchor, highlightSegments } from "./anchors";
import {
  addPeerComment,
  loadFeedback,
  openReview,
  peerReviewConfigured,
  refreshReviewToken,
  setPeerReaction,
  subscribeFeedback,
} from "./api";
import {
  REACTIONS,
  type PeerComment,
  type PeerReaction,
  type ReviewAccess,
  type TextAnchor,
} from "./types";

interface Props {
  classId: string;
  groupId: string;
  groupName: string;
  userId: string;
  onClose: () => void;
}

export function PeerReviewDialog({
  classId,
  groupId,
  groupName,
  userId,
  onClose,
}: Props) {
  const [access, setAccess] = useState<ReviewAccess | null>(null);
  const [comments, setComments] = useState<PeerComment[]>([]);
  const [reactions, setReactions] = useState<PeerReaction[]>([]);
  const [anchor, setAnchor] = useState<TextAnchor | null>(null);
  const [body, setBody] = useState("");
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [live, setLive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const essay = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const requestId = useRef(crypto.randomUUID());
  const reload = useRef<() => Promise<void>>(async () => {});
  const close = useRef(onClose);
  const snapshotId = useRef<string | null>(null);
  const anchorIdentity = useRef("null");
  close.current = onClose;
  const chooseAnchor = useCallback((value: TextAnchor | null) => {
    const identity = JSON.stringify(value);
    if (identity === anchorIdentity.current) return;
    anchorIdentity.current = identity;
    setAnchor(value);
    requestId.current = crypto.randomUUID();
  }, []);

  useEffect(() => {
    if (!access?.canWrite || saving) return;
    const selectionChanged = () => {
      if (!essay.current) return;
      const selected = captureAnchor(essay.current, window.getSelection());
      if (selected) {
        chooseAnchor(selected);
      }
    };
    document.addEventListener("selectionchange", selectionChanged);
    return () =>
      document.removeEventListener("selectionchange", selectionChanged);
  }, [access?.canWrite, saving, chooseAnchor]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    function keys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const elements = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ];
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === root.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === root.current)
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    root.current?.addEventListener("keydown", keys);
    const dialog = root.current;
    return () => {
      dialog?.removeEventListener("keydown", keys);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    let refreshing = false;
    let refreshAgain = false;
    let checkingAccess = false;
    setLoading(true);
    setError("");
    async function refresh() {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      try {
        do {
          refreshAgain = false;
          const feedback = await loadFeedback(classId, groupId);
          if (!cancelled) {
            setComments(feedback.comments);
            setReactions(feedback.reactions);
          }
        } while (refreshAgain && !cancelled);
      } catch (err) {
        if (!cancelled) {
          setLive(false);
          setError(
            err instanceof Error ? err.message : "Could not load feedback.",
          );
        }
      } finally {
        refreshing = false;
      }
    }
    reload.current = refresh;
    async function authorize() {
      if (checkingAccess) return;
      checkingAccess = true;
      try {
        const result = await openReview(classId, groupId);
        if (cancelled) return;
        if (snapshotId.current && snapshotId.current !== result.snapshot.id)
          chooseAnchor(null);
        snapshotId.current = result.snapshot.id;
        setAccess(result);
        setError("");
        await refreshReviewToken();
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setAccess(null);
          setComments([]);
          setReactions([]);
          setLive(false);
          setError(
            err instanceof Error
              ? err.message
              : "Could not open peer feedback.",
          );
        }
      } finally {
        checkingAccess = false;
        if (!cancelled) setLoading(false);
      }
    }
    void (async () => {
      await authorize();
      if (cancelled || !peerReviewConfigured) return;
      try {
        const stop = await subscribeFeedback(
          groupId,
          () => {
            void refresh();
          },
          (value) => {
            if (!cancelled) setLive(value);
          },
        );
        if (cancelled) stop();
        else unsubscribe = stop;
      } catch {
        if (!cancelled) setLive(false);
      }
    })();
    const interval = window.setInterval(() => {
      void authorize();
    }, 60000);
    const reconnect = () => {
      void authorize();
    };
    window.addEventListener("online", reconnect);
    window.addEventListener("focus", reconnect);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(interval);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("focus", reconnect);
    };
  }, [classId, groupId, userId, attempt, chooseAnchor]);

  const segments = useMemo(
    () =>
      highlightSegments(
        access?.snapshot.text_content ?? "",
        access?.snapshot.id ?? "",
        comments,
      ),
    [access, comments],
  );
  const focusComments = (ids: string[]) => {
    setActiveIds(ids);
    cards.current
      .get(ids[0])
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    cards.current.get(ids[0])?.focus({ preventScroll: true });
  };
  const selectText = () => {
    if (!essay.current || !access?.canWrite || saving) return;
    const selection = captureAnchor(essay.current, window.getSelection());
    if (selection) {
      chooseAnchor(selection);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm sm:p-6">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby="peer-review-title"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2
              id="peer-review-title"
              className="text-lg font-extrabold text-slate-900"
            >
              {groupName} · Peer feedback
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
              <Lock size={12} /> Read-only essay ·{" "}
              {live && access
                ? "Live updates connected"
                : "Reconnecting · refresh available"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close peer feedback"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
          >
            <X size={20} />
          </button>
        </header>
        <div className="overflow-y-auto p-4 sm:p-6">
          {error && (
            <div
              role="alert"
              className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"
            >
              <span>{error}</span>
              <button
                type="button"
                className="ws-btn-secondary text-xs"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {loading ? (
            <p
              role="status"
              className="py-16 text-center text-sm text-slate-500"
            >
              Loading essay and peer feedback…
            </p>
          ) : (
            access && (
              <div className="flex flex-col items-start gap-5 lg:flex-row">
                <section className="min-w-0 flex-1 w-full">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">
                      {access.canWrite
                        ? "Select a passage to comment. Click a highlight to read its feedback."
                        : "Click a highlight to read its feedback."}
                    </p>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-xs font-bold text-slate-600"
                      onClick={() => setAttempt((n) => n + 1)}
                    >
                      <RefreshCw size={13} /> Refresh
                    </button>
                  </div>
                  <div
                    ref={essay}
                    aria-label="Read-only essay"
                    onMouseUp={selectText}
                    onTouchEnd={selectText}
                    onKeyUp={selectText}
                    tabIndex={0}
                    className="min-h-[240px] whitespace-pre-wrap break-words rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-800 select-text lg:max-h-[54vh] lg:overflow-y-auto"
                  >
                    {segments.map((segment) =>
                      segment.commentIds.length ? (
                        <mark
                          key={segment.start}
                          role="button"
                          tabIndex={0}
                          aria-label={`Read ${segment.commentIds.length} comment${segment.commentIds.length === 1 ? "" : "s"} on: ${segment.text}`}
                          className={cn(
                            "cursor-pointer rounded-sm bg-orange-100 text-inherit decoration-orange-400 underline decoration-2 underline-offset-4",
                            segment.commentIds.some((id) =>
                              activeIds.includes(id),
                            )
                              ? "bg-orange-200 ring-2 ring-orange-400"
                              : "",
                          )}
                          onClick={() => {
                            if (window.getSelection()?.isCollapsed !== false)
                              focusComments(segment.commentIds);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              focusComments(segment.commentIds);
                            }
                          }}
                        >
                          {segment.text}
                        </mark>
                      ) : (
                        <span key={segment.start}>{segment.text}</span>
                      ),
                    )}
                    {!access.snapshot.text_content && (
                      <span className="text-slate-400 italic">
                        This essay is empty.
                      </span>
                    )}
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-bold text-slate-600">
                      Reactions
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {REACTIONS.map((emoji) => {
                        const matches = reactions.filter(
                          (r) => r.emoji === emoji,
                        );
                        const mine = matches.some(
                          (r) => r.author_uid === userId,
                        );
                        return (
                          <button
                            key={emoji}
                            type="button"
                            aria-label={`${emoji} reaction, ${matches.length}`}
                            aria-pressed={mine}
                            disabled={!access.canWrite || reacting}
                            title={
                              matches.map((r) => r.author_name).join(", ") ||
                              "Be the first to react"
                            }
                            className={cn(
                              "rounded-xl border px-3 py-2 text-sm disabled:cursor-default",
                              mine
                                ? "border-green-300 bg-green-50 text-green-800"
                                : "border-slate-200 bg-white text-slate-600",
                            )}
                            onClick={async () => {
                              setReacting(true);
                              setError("");
                              try {
                                await setPeerReaction(
                                  classId,
                                  groupId,
                                  emoji,
                                  !mine,
                                );
                                await reload.current();
                              } catch (err) {
                                setError(
                                  err instanceof Error
                                    ? err.message
                                    : "Could not save reaction.",
                                );
                              } finally {
                                setReacting(false);
                              }
                            }}
                          >
                            {emoji}{" "}
                            <span className="ml-1 font-bold">
                              {matches.length}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
                <aside className="w-full shrink-0 rounded-3xl border border-slate-200 bg-white p-4 lg:w-[340px]">
                  <h3 className="flex items-center gap-2 border-b border-slate-100 pb-3 text-base font-extrabold text-slate-900">
                    <MessageSquare size={18} className="text-orange-500" />{" "}
                    Comments{" "}
                    <span className="ml-auto text-xs text-slate-500">
                      {comments.length}
                    </span>
                  </h3>
                  <div
                    className="max-h-[35vh] space-y-3 overflow-y-auto py-3"
                    aria-label="Peer comments"
                  >
                    {!comments.length && (
                      <p className="py-6 text-center text-sm text-slate-500">
                        No peer comments yet.
                      </p>
                    )}
                    {comments.map((comment) => (
                      <button
                        type="button"
                        key={comment.id}
                        ref={(node) => {
                          if (node) cards.current.set(comment.id, node);
                          else cards.current.delete(comment.id);
                        }}
                        onClick={() => setActiveIds([comment.id])}
                        className={cn(
                          "block w-full rounded-2xl border bg-slate-50/60 p-3 text-left",
                          activeIds.includes(comment.id)
                            ? "border-orange-400 ring-1 ring-orange-300"
                            : "border-slate-100",
                        )}
                      >
                        <span className="block text-sm font-bold text-slate-900">
                          {comment.author_name}
                        </span>
                        <time
                          dateTime={comment.created_at}
                          className="text-xs text-slate-500"
                        >
                          {new Date(comment.created_at).toLocaleString()}
                        </time>
                        {comment.quote && (
                          <blockquote className="mt-2 whitespace-pre-wrap break-words border-l-2 border-orange-400 bg-orange-50 p-2 text-xs text-orange-900">
                            {comment.quote}
                          </blockquote>
                        )}
                        {comment.snapshot_id !== access.snapshot.id && (
                          <span className="mt-1 block text-xs text-slate-500">
                            On an earlier essay version
                          </span>
                        )}
                        <span className="mt-2 block whitespace-pre-wrap break-words text-sm text-slate-700">
                          {comment.body}
                        </span>
                      </button>
                    ))}
                  </div>
                  {access.canWrite ? (
                    <form
                      className="space-y-3 border-t border-slate-100 pt-3"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (saving || !body.trim()) return;
                        setSaving(true);
                        setError("");
                        try {
                          await addPeerComment(
                            classId,
                            groupId,
                            access.snapshot.id,
                            body.trim(),
                            anchor,
                            requestId.current,
                          );
                          setBody("");
                          chooseAnchor(null);
                          window.getSelection()?.removeAllRanges();
                          requestId.current = crypto.randomUUID();
                          await reload.current();
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Could not save comment.",
                          );
                        } finally {
                          setSaving(false);
                        }
                      }}
                    >
                      {anchor && (
                        <div className="rounded-xl bg-orange-50 p-2 text-xs text-orange-900">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="font-bold"
                              onClick={() => textarea.current?.focus()}
                            >
                              Comment on selected text
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              aria-label="Clear selected text"
                              onClick={() => {
                                chooseAnchor(null);
                                window.getSelection()?.removeAllRanges();
                                requestId.current = crypto.randomUUID();
                              }}
                            >
                              <X size={14} />
                            </button>
                          </div>
                          <p className="mt-1 max-h-20 overflow-y-auto whitespace-pre-wrap break-words">
                            {anchor.quote}
                          </p>
                        </div>
                      )}
                      <label className="block text-xs font-bold text-slate-600">
                        {anchor ? "Your comment" : "General comment"}
                        <textarea
                          ref={textarea}
                          className="ws-field mt-1.5 resize-none"
                          rows={3}
                          value={body}
                          maxLength={2000}
                          disabled={saving}
                          onChange={(event) => {
                            setBody(event.target.value);
                            requestId.current = crypto.randomUUID();
                          }}
                          placeholder="Share helpful, specific feedback…"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={saving || !body.trim()}
                        className="ws-btn-green w-full py-2.5 text-xs disabled:opacity-50"
                      >
                        <Send size={14} /> {saving ? "Saving…" : "Post comment"}
                      </button>
                    </form>
                  ) : (
                    <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                      You can view all feedback here. Only students reviewing
                      another group can add peer comments and reactions.
                    </p>
                  )}
                </aside>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
