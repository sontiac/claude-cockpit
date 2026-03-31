import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Modal } from "../shared/Modal";
import { ColorPicker } from "../shared/ColorPicker";
import { FolderBrowser } from "../shared/FolderBrowser";
import { PROJECT_COLORS, DEFAULT_COMMAND } from "../../lib/constants";
import { generateId } from "../../lib/utils";
import { playSound } from "../../lib/sounds";
import type { Project } from "../../types/project";

interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (project: Project) => void;
  editProject?: Project | null;
}

export function AddProjectModal({
  open,
  onClose,
  onSave,
  editProject,
}: AddProjectModalProps) {
  const [name, setName] = useState(editProject?.name ?? "");
  const [path, setPath] = useState(editProject?.path ?? "");
  const [color, setColor] = useState(
    editProject?.color ?? PROJECT_COLORS[0]
  );
  const [terminals, setTerminals] = useState(editProject?.terminals ?? 1);
  const [command, setCommand] = useState(
    editProject?.command ?? DEFAULT_COMMAND
  );
  const [error, setError] = useState("");
  const [showBrowser, setShowBrowser] = useState(false);

  const handleFolderSelect = (selectedPath: string, folderName: string) => {
    setPath(selectedPath);
    if (!name) {
      setName(folderName);
    }
    setError("");
  };

  const handleSave = () => {
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    if (!path.trim()) {
      setError("Project path is required");
      return;
    }
    if (!path.startsWith("/")) {
      setError("Path must be absolute (start with /)");
      return;
    }

    playSound("click");

    onSave({
      id: editProject?.id ?? generateId(),
      name: name.trim(),
      path: path.trim(),
      color,
      terminals,
      command: command.trim() || null,
    });
    onClose();
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={editProject ? "Edit Project" : "Add Project"}
      >
        <div className="space-y-4">
          {/* Project name */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground-muted">
              Project Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="w-full bg-white/5 border border-card-border rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-accent-cyan transition-colors"
            />
          </div>

          {/* Project path with browse button */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground-muted">
              Project Path
            </label>
            <div className="flex gap-2">
              <input
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setError("");
                }}
                placeholder="/Users/you/projects/my-project"
                className="flex-1 bg-white/5 border border-card-border rounded-lg px-3 py-2 text-sm text-foreground font-mono outline-none focus:border-accent-cyan transition-colors"
              />
              <button
                type="button"
                onClick={() => {
                  playSound("click");
                  setShowBrowser(true);
                }}
                className="px-3 py-2 rounded-lg bg-white/5 border border-card-border hover:border-accent-cyan text-foreground-muted hover:text-accent-cyan transition-colors flex items-center gap-1.5"
                title="Browse for folder"
              >
                <FolderOpen size={18} />
              </button>
            </div>
          </div>

          {/* Color picker */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground-muted">
              Color
            </label>
            <ColorPicker value={color} onChange={setColor} />
          </div>

          {/* Terminal count selector */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground-muted">
              Default Terminal Count
            </label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    playSound("click");
                    setTerminals(num);
                  }}
                  className={`w-10 h-10 rounded-lg font-medium transition-all ${
                    num === terminals
                      ? "bg-accent-cyan text-background"
                      : "bg-white/5 border border-card-border hover:border-foreground-muted text-foreground"
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Command */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-foreground-muted">
              Command
            </label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={DEFAULT_COMMAND}
              className="w-full bg-white/5 border border-card-border rounded-lg px-3 py-2 text-sm text-foreground font-mono outline-none focus:border-accent-cyan transition-colors"
            />
          </div>

          {/* Error message */}
          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg border border-card-border text-sm text-foreground-muted hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="flex-1 py-2.5 rounded-lg bg-accent-cyan text-background font-medium hover:glow-cyan transition-all text-sm"
            >
              {editProject ? "Save Changes" : "Add Project"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Folder Browser (overlays on top of the modal) */}
      <FolderBrowser
        open={showBrowser}
        onClose={() => setShowBrowser(false)}
        onSelect={handleFolderSelect}
        initialPath={path || "~"}
      />
    </>
  );
}
