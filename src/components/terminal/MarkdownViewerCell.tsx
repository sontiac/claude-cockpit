import { useState, useEffect } from "react";
import type React from "react";
import { FileText, CircleAlert } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PaneHeader } from "./PaneHeader";
import { useMarkdownFile } from "../../hooks/useMarkdownFile";
import type { MdViewerPane } from "../../types/pane";
import type { Workspace } from "../../types/terminal";

interface MarkdownViewerCellProps {
  pane: MdViewerPane;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (label: string) => void;
  onSetPath: (path: string | null) => void;
  onHeaderPointerDown?: (e: React.PointerEvent) => void;
  workspaces: Workspace[];
  onMove: (workspaceId: string) => void;
}

/**
 * Read-only markdown file viewer. Paste an absolute path (e.g. a plan Claude
 * just wrote) and press Enter; the file renders and auto-reloads whenever it
 * changes on disk (mtime poll via useMarkdownFile).
 */
export function MarkdownViewerCell({
  pane,
  isActive,
  onSelect,
  onClose,
  onRename,
  onSetPath,
  onHeaderPointerDown,
  workspaces,
  onMove,
}: MarkdownViewerCellProps) {
  const [draft, setDraft] = useState(pane.path ?? "");
  const { content, error } = useMarkdownFile(pane.path);

  // Keep the input in sync if the path changes from outside (e.g. restore).
  useEffect(() => {
    setDraft(pane.path ?? "");
  }, [pane.path]);

  const commit = () => {
    const trimmed = draft.trim();
    onSetPath(trimmed === "" ? null : trimmed);
  };

  return (
    <div
      className={`flex flex-col h-full min-h-0 bg-background ${
        isActive ? "ring-1 ring-accent-cyan/40" : ""
      }`}
      onClick={onSelect}
    >
      <PaneHeader
        icon={<FileText size={12} />}
        label={pane.label}
        color={pane.color}
        isActive={isActive}
        workspaceId={pane.workspaceId}
        workspaces={workspaces}
        onSelect={onSelect}
        onClose={onClose}
        onRename={onRename}
        onMove={onMove}
        onHeaderPointerDown={onHeaderPointerDown}
      />

      {/* Path row */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-card-border bg-background-secondary/20">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
          }}
          onBlur={commit}
          placeholder="/path/to/plan.md — paste and press Enter"
          spellCheck={false}
          className="flex-1 min-w-0 bg-white/5 border border-card-border rounded px-2 py-0.5 text-xs text-foreground outline-none focus:border-accent-cyan path-text"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
          <CircleAlert size={12} className="flex-shrink-0" />
          <span className="truncate" title={error}>
            {error}
          </span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto" onClick={(e) => e.stopPropagation()}>
        {content !== null ? (
          <div className="md-prose px-4 py-3 text-sm text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : !error ? (
          <div className="h-full flex items-center justify-center text-xs text-foreground-muted px-6 text-center">
            {pane.path
              ? "Loading…"
              : "Paste a markdown file path above — e.g. the plan Claude just wrote — and press Enter."}
          </div>
        ) : null}
      </div>
    </div>
  );
}
