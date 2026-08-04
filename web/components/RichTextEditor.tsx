'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, cn } from './ui';

/**
 * Rich text editor built on a `contentEditable` region.
 *
 * `document.execCommand` is formally deprecated but is still the only API every
 * browser implements consistently for inline formatting, and it keeps this
 * dependency-free — a full ProseMirror/Slate stack would add megabytes for a
 * toolbar with eight buttons.
 *
 * Whatever is produced here is sanitised again on the server before it is stored
 * or sent, so the editor never has to be the security boundary.
 */

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

type Command = {
  id: string;
  label: string;
  title: string;
  command?: string;
  argument?: string;
  icon: React.ReactNode;
  action?: () => void;
};

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write your email…',
  minHeight = 320,
  disabled,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Only write into the DOM when the value diverges from what the user typed;
  // assigning innerHTML on every keystroke would destroy the caret position.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || htmlMode) return;
    if (editor.innerHTML !== value) editor.innerHTML = value;
  }, [value, htmlMode]);

  const syncFromEditor = useCallback(() => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const refreshActiveFormats = useCallback(() => {
    const formats = new Set<string>();
    for (const command of ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList']) {
      try {
        if (document.queryCommandState(command)) formats.add(command);
      } catch {
        /* not supported in this context */
      }
    }
    setActiveFormats(formats);
  }, []);

  const exec = useCallback(
    (command: string, argument?: string) => {
      if (disabled) return;
      editorRef.current?.focus();
      document.execCommand(command, false, argument);
      syncFromEditor();
      refreshActiveFormats();
    },
    [disabled, syncFromEditor, refreshActiveFormats],
  );

  const insertLink = useCallback(() => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? '';
    const url = window.prompt('Link URL', 'https://');
    if (!url) return;

    // Block javascript: and other executable schemes at the source.
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      window.alert('Only http, https, mailto and tel links are allowed.');
      return;
    }

    if (selectedText) {
      exec('createLink', url);
    } else {
      exec('insertHTML', `<a href="${escapeAttribute(url)}">${escapeText(url)}</a>`);
    }
  }, [exec]);

  const insertImage = useCallback(() => {
    const url = window.prompt('Image URL', 'https://');
    if (!url) return;
    if (!/^https?:/i.test(url)) {
      window.alert('Image URLs must start with http:// or https://');
      return;
    }
    exec('insertHTML', `<img src="${escapeAttribute(url)}" alt="" style="max-width:100%;height:auto;" />`);
  }, [exec]);

  const commands: Command[][] = [
    [
      { id: 'bold', command: 'bold', label: 'B', title: 'Bold (Ctrl+B)', icon: <span className="font-bold">B</span> },
      { id: 'italic', command: 'italic', label: 'I', title: 'Italic (Ctrl+I)', icon: <span className="italic">I</span> },
      {
        id: 'underline',
        command: 'underline',
        label: 'U',
        title: 'Underline (Ctrl+U)',
        icon: <span className="underline">U</span>,
      },
      {
        id: 'strikeThrough',
        command: 'strikeThrough',
        label: 'S',
        title: 'Strikethrough',
        icon: <span className="line-through">S</span>,
      },
    ],
    [
      {
        id: 'h1',
        command: 'formatBlock',
        argument: '<h1>',
        label: 'H1',
        title: 'Heading 1',
        icon: <span className="text-xs font-bold">H1</span>,
      },
      {
        id: 'h2',
        command: 'formatBlock',
        argument: '<h2>',
        label: 'H2',
        title: 'Heading 2',
        icon: <span className="text-xs font-bold">H2</span>,
      },
      {
        id: 'p',
        command: 'formatBlock',
        argument: '<p>',
        label: 'P',
        title: 'Normal text',
        icon: <span className="text-xs">P</span>,
      },
      {
        id: 'blockquote',
        command: 'formatBlock',
        argument: '<blockquote>',
        label: '"',
        title: 'Quote',
        icon: <QuoteIcon />,
      },
    ],
    [
      { id: 'insertUnorderedList', command: 'insertUnorderedList', label: '•', title: 'Bullet list', icon: <BulletIcon /> },
      { id: 'insertOrderedList', command: 'insertOrderedList', label: '1.', title: 'Numbered list', icon: <NumberIcon /> },
    ],
    [
      { id: 'link', label: '🔗', title: 'Insert link', icon: <LinkGlyph />, action: insertLink },
      { id: 'image', label: '🖼', title: 'Insert image', icon: <ImageGlyph />, action: insertImage },
    ],
    [
      { id: 'removeFormat', command: 'removeFormat', label: 'Tx', title: 'Clear formatting', icon: <ClearIcon /> },
    ],
  ];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-950',
        'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 p-1.5 dark:border-slate-800 dark:bg-slate-900">
        {!htmlMode &&
          commands.map((group, groupIndex) => (
            <div key={groupIndex} className="flex items-center gap-0.5">
              {groupIndex > 0 && <span className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-700" />}
              {group.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  title={item.title}
                  aria-label={item.title}
                  aria-pressed={activeFormats.has(item.id)}
                  disabled={disabled}
                  // onMouseDown, not onClick: clicking a button blurs the editor and
                  // destroys the selection before the command can apply.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (item.action) item.action();
                    else if (item.command) exec(item.command, item.argument);
                  }}
                  className={cn(
                    'flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-sm transition-colors',
                    activeFormats.has(item.id)
                      ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300'
                      : 'text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-800',
                  )}
                >
                  {item.icon}
                </button>
              ))}
            </div>
          ))}

        <div className="ml-auto">
          <Button
            type="button"
            size="sm"
            variant={htmlMode ? 'primary' : 'ghost'}
            onClick={() => {
              // Leaving HTML mode: push the edited source back through React state.
              if (htmlMode && editorRef.current) onChange(editorRef.current.innerHTML);
              setHtmlMode((mode) => !mode);
            }}
            title="Toggle raw HTML editing"
          >
            {'</>'} HTML
          </Button>
        </div>
      </div>

      {htmlMode ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          spellCheck={false}
          className="scroll-thin w-full resize-y bg-transparent p-4 font-mono text-xs text-slate-800 outline-none dark:text-slate-200"
          style={{ minHeight }}
          aria-label="HTML source"
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="Email body"
          data-placeholder={placeholder}
          onInput={syncFromEditor}
          onBlur={syncFromEditor}
          onKeyUp={refreshActiveFormats}
          onMouseUp={refreshActiveFormats}
          onPaste={(event) => {
            // Paste as plain text by default: pasting from Word or a web page
            // otherwise drags in a mountain of markup that email clients mangle.
            event.preventDefault();
            const text = event.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
            syncFromEditor();
          }}
          className="rte-content scroll-thin overflow-y-auto p-4 text-slate-900 outline-none dark:text-slate-100"
          style={{ minHeight }}
        />
      )}
    </div>
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Small glyphs, sized to match the text buttons beside them.
const glyph = 'h-4 w-4';

function QuoteIcon() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 7h4v4H9c0 2 1 3 2 3v2c-2.5 0-4-2-4-5V7Zm8 0h4v4h-2c0 2 1 3 2 3v2c-2.5 0-4-2-4-5V7Z" />
    </svg>
  );
}

function BulletIcon() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="3.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function NumberIcon() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M9 6h12M9 12h12M9 18h12M3 5h1v4M3 13h2l-2 3h2" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
    </svg>
  );
}

function ImageGlyph() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m21 16-5-5-6 6" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg className={glyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M4 7h12M10 7v10M7 20h10M16 4l5 5M21 4l-5 5" />
    </svg>
  );
}
