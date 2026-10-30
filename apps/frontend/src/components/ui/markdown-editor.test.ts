import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Markdown } from 'tiptap-markdown';

/** Same extensions as MarkdownEditor; SafeMarkdown relies on underline being stored as <u>…</u>. */
let editor: Editor | null = null;
const make = (content: string) =>
  (editor = new Editor({ extensions: [StarterKit, Markdown], content }));
const md = (e: Editor) => (e.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

afterEach(() => editor?.destroy());

describe('MarkdownEditor underline', () => {
  it('stores underline as <u>…</u>', () => {
    const e = make('Read the rules');
    e.commands.selectAll();
    e.commands.toggleUnderline();
    expect(md(e)).toBe('<u>Read the rules</u>');
  });

  it('loads <u>…</u> back as underline', () => {
    const e = make('a <u>b</u> c');
    expect(md(e)).toBe('a <u>b</u> c');
    expect(e.getHTML()).toContain('<u>b</u>');
  });
});
