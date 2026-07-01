import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { ListTodo, List, Undo2, Redo2 } from "lucide-react";
import type { Editor } from "@tiptap/core";

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

function Toolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-card-border bg-background-secondary/20">
      <ToolbarButton
        title="Checklist"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <ListTodo size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={14} />
      </ToolbarButton>
      <div className="w-px h-4 bg-card-border mx-1" />
      <ToolbarButton
        title="Undo"
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        title="Redo"
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={14} />
      </ToolbarButton>
    </div>
  );
}

/**
 * A lightweight WYSIWYG note editor. Bullets (`*␣`/`-␣`) and checkboxes (`[]␣`)
 * come from TipTap input rules; Enter continues a list and exits it on an empty
 * item. No raw markdown syntax is required from the user.
 */
export function NoteEditor({ initialContent, onChange }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
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
      <EditorContent
        editor={editor}
        className="flex-1 min-h-0 overflow-auto"
      />
    </div>
  );
}
