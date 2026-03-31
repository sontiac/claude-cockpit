import { useState, useEffect, useCallback, useMemo } from "react";
import { Folder, ChevronUp, Check, X, Home, Search } from "lucide-react";
import { browseDirectory } from "../../lib/ipc";
import { playSound } from "../../lib/sounds";

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface FolderBrowserProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string, folderName: string) => void;
  initialPath?: string;
}

export function FolderBrowser({
  open,
  onClose,
  onSelect,
  initialPath,
}: FolderBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath || "~");
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    setError("");
    setSearchQuery("");

    try {
      const result = await browseDirectory(path);
      setCurrentPath(result.current_path);
      setParentPath(result.parent_path);
      setDirectories(result.directories);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to load directory");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      fetchDirectory(initialPath || "~");
    }
  }, [open, initialPath, fetchDirectory]);

  const filteredDirectories = useMemo(() => {
    if (!searchQuery.trim()) return directories;
    const query = searchQuery.toLowerCase();
    return directories.filter((dir) =>
      dir.name.toLowerCase().includes(query)
    );
  }, [directories, searchQuery]);

  if (!open) return null;

  const handleNavigate = (path: string) => {
    playSound("click");
    fetchDirectory(path);
  };

  const handleSelect = () => {
    playSound("success");
    const folderName = currentPath.split("/").pop() || "";
    onSelect(currentPath, folderName);
    onClose();
  };

  const handleClose = () => {
    playSound("click");
    onClose();
  };

  // Shorten display path
  const displayPath = currentPath.replace(/^\/Users\/[^/]+/, "~");

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60]"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="glass-card p-5 w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2 text-foreground">
            <Folder size={18} className="text-accent-cyan" />
            Select Folder
          </h3>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-foreground-muted hover:text-foreground hover:bg-white/10 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Current path */}
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-background border border-card-border font-mono text-sm overflow-hidden">
          <span
            className="truncate text-foreground-muted"
            title={currentPath}
          >
            {displayPath}
          </span>
        </div>

        {/* Navigation buttons */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => handleNavigate("~")}
            disabled={isLoading}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-background border border-card-border hover:border-foreground-muted transition-colors disabled:opacity-50 text-foreground"
          >
            <Home size={14} />
            Home
          </button>
          {parentPath && (
            <button
              onClick={() => handleNavigate(parentPath)}
              disabled={isLoading}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-background border border-card-border hover:border-foreground-muted transition-colors disabled:opacity-50 text-foreground"
            >
              <ChevronUp size={14} />
              Up
            </button>
          )}
        </div>

        {/* Search input */}
        <div className="relative mb-3">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search folders..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-card-border focus:border-accent-cyan outline-none transition-colors text-sm text-foreground"
          />
        </div>

        {/* Directory list */}
        <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[300px] rounded-lg bg-background border border-card-border">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-foreground-muted py-8">
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400 py-8">
              {error}
            </div>
          ) : filteredDirectories.length === 0 ? (
            <div className="flex items-center justify-center h-full text-foreground-muted py-8">
              {searchQuery ? "No matching folders" : "No subdirectories"}
            </div>
          ) : (
            <div className="divide-y divide-card-border">
              {filteredDirectories.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => handleNavigate(dir.path)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-foreground hover:bg-white/5 transition-colors"
                >
                  <Folder
                    size={18}
                    className="text-accent-amber shrink-0"
                  />
                  <span className="truncate">{dir.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-4">
          <button
            onClick={handleClose}
            className="flex-1 py-2 rounded-lg border border-card-border text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSelect}
            className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg bg-accent-cyan text-background font-medium hover:glow-cyan transition-all"
          >
            <Check size={18} />
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
}
