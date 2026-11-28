import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { WritingComment, WRITESPACE_HIGHLIGHT_COLORS } from '@/types';
import { captureAnchor } from '@/features/peer-review/anchors';
import type { TextAnchor } from '@/features/peer-review/types';
import { cn } from '@/utils';

interface CommentHighlighterProps {
  /** The plain-text essay content to render with highlights. */
  text: string;
  /** All comments (root-level and replies) for this essay. */
  comments: WritingComment[];
  /** Called when the user selects text in the essay. */
  onTextSelect?: (selectedText: string, anchor: TextAnchor) => void;
  /** Called when user clicks a highlighted comment span to scroll the sidebar. */
  onCommentClick?: (commentId: string) => void;
  /** Extra className for the wrapper element. */
  className?: string;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  commentIds: string[];
  color: string | null;
}

/**
 * Renders essay text with persistent highlighted spans linked to comments.
 * Clicking a highlight opens a floating popover showing the comment.
 * Works for both teacher review and student peer review contexts.
 */
export const CommentHighlighter: React.FC<CommentHighlighterProps> = ({
  text,
  comments,
  onTextSelect,
  onCommentClick,
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const essayRef = useRef<HTMLDivElement>(null);
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  // Build highlighted segments from root comments that have selectedText
  const segments: Segment[] = useMemo(() => {
    if (!text) return [{ start: 0, end: 0, text: '', commentIds: [], color: null }];

    const rootComments = comments.filter(
      (c) => !c.parentId && !c.isDeleted && c.selectedText && c.selectedText.trim()
    );

    if (rootComments.length === 0) {
      return [{ start: 0, end: text.length, text, commentIds: [], color: null }];
    }

    // Build ranges: for each comment, find the first occurrence of selectedText in the essay
    const ranges: Array<{
      start: number;
      end: number;
      commentId: string;
      color: string;
    }> = [];

    for (const comment of rootComments) {
      const quote = comment.selectedText!;
      const colorMeta = WRITESPACE_HIGHLIGHT_COLORS[comment.highlightColor || 'orange'];
      const bg = colorMeta.bg;

      // Try anchorStart first, then indexOf as fallback
      let start = -1;
      if (
        typeof comment.anchorStart === 'number' &&
        comment.anchorStart >= 0 &&
        typeof comment.anchorEnd === 'number' &&
        comment.anchorEnd <= text.length
      ) {
        const slice = text.slice(comment.anchorStart, comment.anchorEnd);
        if (slice === quote) {
          start = comment.anchorStart;
        }
      }
      if (start < 0) {
        const match = text.indexOf(quote);
        if (comment.anchorStart == null && match >= 0 && text.indexOf(quote, match + 1) < 0) start = match;
      }
      if (start < 0) continue;

      ranges.push({
        start,
        end: start + quote.length,
        commentId: comment.id,
        color: bg,
      });
    }

    if (ranges.length === 0) {
      return [{ start: 0, end: text.length, text, commentIds: [], color: null }];
    }

    const boundaries = [...new Set([0, text.length, ...ranges.flatMap(r => [r.start, r.end])])].sort((a, b) => a - b);
    return boundaries.slice(0, -1).map((start, index) => {
      const end = boundaries[index + 1];
      const matches = ranges.filter(r => r.start <= start && r.end >= end);
      return { start, end, text: text.slice(start, end), commentIds: matches.map(r => r.commentId), color: matches[0]?.color ?? null };
    });
  }, [text, comments]);

  // Close popover on click outside
  useEffect(() => {
    if (!activeCommentId) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement).closest('[data-comment-highlight]')
      ) {
        setActiveCommentId(null);
        setPopoverPos(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeCommentId]);

  // Handle text selection for new comments
  const handleMouseUp = useCallback(() => {
    if (!onTextSelect) return;
    if (!essayRef.current) return;
    const anchor = captureAnchor(essayRef.current, window.getSelection());
    if (!anchor) return;
    const leading = anchor.quote.length - anchor.quote.trimStart().length;
    const quote = anchor.quote.trim();
    if (!quote || quote.length > 500) return;
    onTextSelect(quote, { start: anchor.start + leading, end: anchor.start + leading + quote.length, quote });
  }, [onTextSelect]);

  // Handle highlight click to show popover
  const handleHighlightClick = useCallback(
    (e: React.MouseEvent, commentId: string) => {
      e.stopPropagation();
      const target = e.currentTarget as HTMLElement;
      const container = containerRef.current;
      if (!container) return;

      const targetRect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      setPopoverPos({
        top: targetRect.bottom - containerRect.top + 8,
        left: Math.max(0, targetRect.left - containerRect.left),
      });
      setActiveCommentId(commentId);
      onCommentClick?.(commentId);
    },
    [onCommentClick]
  );

  // Find the active comment data for the popover
  const activeComment = activeCommentId
    ? comments.find((c) => c.id === activeCommentId)
    : null;
  const activeReplies = activeCommentId
    ? comments.filter((c) => c.parentId === activeCommentId && !c.isDeleted)
    : [];

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      onMouseUp={handleMouseUp}
      onKeyUp={handleMouseUp}
      onTouchEnd={handleMouseUp}
    >
      <div ref={essayRef} className="whitespace-pre-wrap text-slate-800 leading-7 select-text">
        {segments.map((segment, i) =>
          segment.commentIds.length > 0 && segment.color ? (
            <mark
              key={i}
              data-comment-highlight
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}
              onClick={(e) => {
                if (window.getSelection()?.isCollapsed === false) return;
                setActiveIds(segment.commentIds);
                handleHighlightClick(e, segment.commentIds[0]);
              }}
              style={{ backgroundColor: segment.color }}
              className="cursor-pointer rounded-sm px-px transition-all hover:brightness-90 hover:ring-2 hover:ring-offset-1 hover:ring-slate-400"
              title="Click to view comment"
            >
              {segment.text}
            </mark>
          ) : (
            <React.Fragment key={i}>{segment.text}</React.Fragment>
          )
        )}
      </div>

      {/* Comment popover on highlight click */}
      {activeComment && popoverPos && (
        <div
          ref={popoverRef}
          className="absolute z-50 w-80 max-w-[90%] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl animate-in fade-in"
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white',
                  activeComment.authorRole === 'teacher' ? 'bg-orange-500' : 'bg-green-600'
                )}
              >
                {activeComment.authorName.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-bold text-slate-900 truncate">
                  {activeComment.authorName}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {activeComment.authorRole === 'teacher' ? 'Teacher' : 'Student'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveCommentId(null);
                setPopoverPos(null);
              }}
              className="text-slate-400 hover:text-slate-700 p-0.5"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          {activeIds.length > 1 && <div className="flex gap-2 mb-2">{activeIds.map((id, index) => <button type="button" key={id} className="text-xs underline" onClick={() => setActiveCommentId(id)}>Comment {index + 1}</button>)}</div>}
          {activeComment.selectedText && (
            <blockquote
              className={cn(
                'mb-2 rounded-lg border-l-4 px-2.5 py-1.5 text-xs italic line-clamp-2',
                WRITESPACE_HIGHLIGHT_COLORS[activeComment.highlightColor || 'orange'].quoteClass
              )}
            >
              &ldquo;{activeComment.selectedText}&rdquo;
            </blockquote>
          )}

          <p className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
            {activeComment.body}
          </p>

          <p className="mt-2 text-[10px] text-slate-400">
            {activeComment.createdAt
              ? new Date(activeComment.createdAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : ''}
          </p>

          {/* Show replies */}
          {activeReplies.length > 0 && (
            <div className="mt-2.5 space-y-2 border-t border-slate-100 pt-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <MessageSquare size={10} className="inline mr-1" />
                {activeReplies.length} {activeReplies.length === 1 ? 'reply' : 'replies'}
              </p>
              {activeReplies.map((reply) => (
                <div key={reply.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                  <span className="font-bold text-slate-900">{reply.authorName}</span>
                  <span className="text-slate-400 ml-1">
                    ({reply.authorRole === 'teacher' ? 'Teacher' : 'Student'})
                  </span>
                  <p className="mt-0.5 text-slate-700 whitespace-pre-wrap">{reply.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
