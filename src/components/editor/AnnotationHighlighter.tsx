import { Annotation, WritingComment } from '@/types';
import { CommentHighlighter } from '@/components/ui/CommentHighlighter';

interface AnnotationHighlighterProps {
  content: string;
  annotations: Annotation[];
  onAnnotationClick?: (annotation: Annotation) => void;
}

export function AnnotationHighlighter({ content, annotations, onAnnotationClick }: AnnotationHighlighterProps) {
  const comments: WritingComment[] = annotations.map(annotation => ({
    id: annotation.id,
    classId: '',
    groupId: annotation.groupId,
    authorId: annotation.authorId,
    authorName: annotation.authorName,
    authorRole: 'teacher',
    body: annotation.comment || annotation.selectedText,
    selectedText: annotation.selectedText,
    // Older annotations used 0/0 instead of recording a selection.
    anchorStart: annotation.to > annotation.from ? annotation.from : null,
    anchorEnd: annotation.to > annotation.from ? annotation.to : null,
    highlightColor: annotation.type === 'correction' ? 'pink' : annotation.type === 'comment' ? 'blue' : 'yellow',
    createdAt: annotation.createdAt,
  }));
  return <div className="annotation-highlighter prose max-w-none p-4 min-h-[200px]">
    <CommentHighlighter text={content} comments={comments} onCommentClick={id => {
      const annotation = annotations.find(item => item.id === id);
      if (annotation) onAnnotationClick?.(annotation);
    }} />
  </div>;
}
