import { useEffect, useRef, useReducer, type ChangeEvent, type ReactNode } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { Bold, Italic, Heading2, List, ListOrdered, Quote, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * WYSIWYG markdown editor: a drop-in replacement for <Textarea>. Formatting is
 * shown directly in the field (bold is bold, no `**`), but the value is read and
 * written as plain **markdown** — so storage and the public rendering (react-
 * markdown) are unchanged, and existing tournaments load fine.
 *
 * `onChange` mirrors the native textarea handler, so existing form `handleChange`
 * functions (which read `e.target.name` / `e.target.value`) work unchanged.
 */
/** tiptap-markdown augments editor.storage with this, but the type isn't picked up. */
type MarkdownStorage = { markdown: { getMarkdown: () => string } };

interface MarkdownEditorProps {
  id?: string;
  name: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  rows?: number;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}

export function MarkdownEditor({
  id,
  name,
  value,
  onChange,
  rows = 4,
  placeholder,
  maxLength,
  disabled,
}: MarkdownEditorProps) {
  // Last markdown we emitted — guards the external-sync effect against the
  // markdown round-trip not being byte-identical (which would loop).
  const lastValue = useRef(value);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ transformPastedText: true, transformCopiedText: true }),
    ],
    content: value,
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const md = (editor.storage as unknown as MarkdownStorage).markdown.getMarkdown();
      lastValue.current = md;
      onChange({
        target: { name, value: md, type: 'textarea' },
      } as unknown as ChangeEvent<HTMLTextAreaElement>);
    },
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: 'tiptap px-3 py-2 text-rizzotto-stone-100 focus:outline-none',
        style: `min-height:${rows * 1.6}rem`,
      },
    },
  });

  // Keep the toolbar's active states in sync with the cursor/selection.
  useEffect(() => {
    if (!editor) return;
    const update = () => rerender();
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  // Reflect external value changes (edit form loading data, form reset).
  useEffect(() => {
    if (!editor) return;
    if (value !== lastValue.current) {
      lastValue.current = value;
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  // Reflect disabled changes.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  if (!editor) {
    return (
      <div
        className="rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800"
        style={{ minHeight: `${rows * 1.6}rem` }}
      />
    );
  }

  function toggleLink() {
    if (!editor) return;
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt('Link URL (https://…)');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  const tools: { icon: ReactNode; title: string; run: () => void; active: boolean }[] = [
    { icon: <Bold size={15} />, title: 'Bold', run: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
    { icon: <Italic size={15} />, title: 'Italic', run: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
    { icon: <Heading2 size={15} />, title: 'Heading', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
    { icon: <List size={15} />, title: 'Bullet list', run: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
    { icon: <ListOrdered size={15} />, title: 'Numbered list', run: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
    { icon: <Quote size={15} />, title: 'Quote', run: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
    { icon: <Link2 size={15} />, title: 'Link', run: toggleLink, active: editor.isActive('link') },
  ];

  const over = maxLength != null && value.length > maxLength;

  return (
    <div className={cn('rounded-md border border-rizzotto-iron-600 bg-rizzotto-iron-800', disabled && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-rizzotto-iron-700 px-1.5 py-1">
        {tools.map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            disabled={disabled}
            // Keep the editor selection while clicking a toolbar button.
            onMouseDown={(e) => e.preventDefault()}
            onClick={tool.run}
            className={cn(
              'rounded p-1 text-rizzotto-stone-300 transition-colors hover:bg-rizzotto-iron-700 hover:text-rizzotto-gold-300 disabled:opacity-40',
              tool.active && 'bg-rizzotto-iron-700 text-rizzotto-gold-300',
            )}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <EditorContent editor={editor} />

      {maxLength != null && (
        <div className="px-3 pb-1 text-right text-[10px] text-rizzotto-stone-500">
          <span className={over ? 'text-rizzotto-danger' : undefined}>{value.length}</span> / {maxLength}
        </div>
      )}
    </div>
  );
}
