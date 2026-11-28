import { createElement } from 'react';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CommentHighlighter } from '../src/components/ui/CommentHighlighter';
import type { WritingComment } from '../src/types';
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); });
const comment = (id: string, start: number, end: number, quote: string): WritingComment => ({ id, classId: 'c', groupId: 'g', authorId: 'u', authorName: 'Teacher', authorRole: 'teacher', body: `Feedback ${id}`, selectedText: quote, anchorStart: start, anchorEnd: end, createdAt: 1 });
it('captures the exact repeated occurrence and restores it after reopening', () => {
  const onTextSelect = vi.fn();
  const view = render(createElement(CommentHighlighter, { text: 'Good. Good.', comments: [], onTextSelect }));
  const text = screen.getByText('Good. Good.');
  const range = document.createRange(); range.setStart(text.firstChild!, 6); range.setEnd(text.firstChild!, 10);
  window.getSelection()!.addRange(range); fireEvent.mouseUp(text);
  expect(onTextSelect).toHaveBeenCalledWith('Good', { start: 6, end: 10, quote: 'Good' });
  view.unmount(); window.getSelection()!.removeAllRanges();
  const reopened = render(createElement(CommentHighlighter, { text: 'Good. Good.', comments: [comment('a',6,10,'Good')] }));
  expect(reopened.container.querySelector('mark')?.previousSibling?.textContent).toBe('Good. ');
  fireEvent.click(reopened.container.querySelector('mark')!);
  expect(screen.getByText('Feedback a')).toBeInTheDocument();
});
it('keeps overlapping comments accessible without repeating essay text', () => {
  const view = render(createElement(CommentHighlighter, { text: 'abcdef', comments: [comment('a',0,4,'abcd'), comment('b',2,6,'cdef')] }));
  const marks = view.container.querySelectorAll('mark');
  expect([...marks].map(m => m.textContent)).toEqual(['ab','cd','ef']);
  fireEvent.click(marks[1]); fireEvent.click(screen.getByText('Comment 2'));
  expect(screen.getByText('Feedback b')).toBeInTheDocument();
});
it('never moves an invalid saved anchor to a different matching passage', () => {
  const view = render(createElement(CommentHighlighter, { text: 'Good. changed', comments: [comment('a',6,10,'Good')] }));
  expect(view.container.querySelector('mark')).toBeNull();
});
