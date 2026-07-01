import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Maximize2 } from "lucide-react";
import { quitApp } from "../../lib/ipc";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  // The title-bar X closes the whole program (matches the user's mental model),
  // exiting cleanly so no windowless zombie process lingers.
  const handleClose = () => quitApp().catch(console.error);

  return (
    <div
      className="h-10 flex items-center justify-between px-4 bg-background/30 backdrop-blur-2xl border-b border-white/10 select-none"
      onMouseDown={(e) => {
        // Only drag on the bar itself, not on buttons
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        if (e.buttons === 1) {
          appWindow.startDragging();
        }
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
        handleMaximize();
      }}
    >
      {/* macOS traffic light spacing */}
      <div className="w-20" />

      <div className="flex items-center gap-2 text-foreground-muted text-sm font-medium">
        <span className="text-accent-cyan">Claude</span>
        <span>Cockpit</span>
      </div>

      <div className="flex items-center gap-1" data-nodrag>
        <button
          onClick={handleMinimize}
          className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted hover:text-foreground"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={handleMaximize}
          className="p-1.5 rounded-md hover:bg-white/10 text-foreground-muted hover:text-foreground"
        >
          {isMaximized ? <Square size={12} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={handleClose}
          className="p-1.5 rounded-md hover:bg-red-500/20 text-foreground-muted hover:text-red-400"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
