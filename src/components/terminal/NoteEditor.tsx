import { useEditor, EditorContent, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Highlight from "@tiptap/extension-highlight";
import { Placeholder } from "@tiptap/extensions";
import {
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Highlighter,
  ListTodo,
  List,
  Quote,
  Minus,
  Undo2,
  Redo2,
  Check,
} from "lucide-react";
import type { Editor } from "@tiptap/core";
import { taskProgress } from "../../lib/noteProgress";

interface NoteEditorProps {
  initialContent: unknown | null;
  onChange: (doc: unknown) => void;
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus/selection
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "text-accent-cyan bg-accent-cyan/15"
          : "text-foreground-muted hover:text-foreground hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-card-border mx-0.5 flex-shrink-0" />;
}

function Toolbar({ editor }: { editor: Editor }) {
  // Re-renders on every editor transaction so button active-states and the
  // task progress stay live. Notes are small docs; getJSON per keystroke is fine.
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      h1: editor.isActive("heading", { level: 1 }),
      h2: editor.isActive("heading", { level: 2 }),
      h3: editor.isActive("heading", { level: 3 }),
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      strike: editor.isActive("strike"),
      highlight: editor.isActive("highlight"),
      taskList: editor.isActive("taskList"),
      bulletList: editor.isActive("bulletList"),
      blockquote: editor.isActive("blockquote"),
      progress: taskProgress(editor.getJSON()),
    }),
  });
  const { done, total } = s.progress;
  const allDone = total > 0 && done === total;

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b border-card-border bg-background-secondary/20 flex-wrap">
      <ToolbarButton
        title="Heading 1"
        active={s.h1}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Heading 2"
        active={s.h2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Heading 3"
        active={s.h3}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="Bold (Cmd+B)"
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Italic (Cmd+I)"
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={s.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Highlight"
        active={s.highlight}
        onClick={() => editor.chain().focus().toggleHighlight().run()}
      >
        <Highlighter size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton
        title="Checklist"
        active={s.taskList}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Bullet list"
        active={s.bulletList}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        active={s.blockquote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Divider line"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={14} />
      </ToolbarButton>
      <Divider />
      <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={14} />
      </ToolbarButton>

      {total > 0 && (
        <div
          className="ml-auto flex items-center gap-1.5 pl-2 flex-shrink-0"
          title={`${done} of ${total} tasks done`}
        >
          <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                allDone ? "bg-emerald-400" : "bg-emerald-500/80"
              }`}
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>
          {allDone ? (
            <Check size={12} className="text-emerald-400" />
          ) : (
            <span className="text-[10px] tabular-nums text-foreground-muted">
              {done}/{total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A lightweight WYSIWYG note editor. Every feature is a toolbar button;
 * markdown input rules (`# `, `**bold**`, `[] `) keep working as shortcuts
 * but are never required. Checklist completion is tracked live in the toolbar.
 */
export function NoteEditor({ initialContent, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight,
      Placeholder.configure({
        placeholder: "Write something — or use the toolbar above…",
      }),
    ],
    content: (initialContent as any) ?? "",
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class:
          "note-prose flex-1 min-h-0 overflow-auto px-3 py-2 text-sm text-foreground outline-none",
      },
    },
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} className="flex-1 min-h-0 overflow-auto" />
    </div>
  );
}
