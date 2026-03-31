import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Maximize2 } from "lucide-react";

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      appWindow.unmaximize();
      setIsMaximized(false);
    } else {
      appWindow.maximize();
      setIsMaximized(true);
    }
  };
  const handleClose = () => appWindow.close();

  return (
    <div className="titlebar-drag h-10 flex items-center justify-between px-4 bg-background/80 backdrop-blur-md border-b border-card-border select-none">
      {/* macOS traffic light spacing */}
      <div className="w-20" />

      <div className="flex items-center gap-2 text-foreground-muted text-sm font-medium">
        <span className="text-accent-cyan">Claude</span>
        <span>Cockpit</span>
      </div>

      <div className="titlebar-nodrag flex items-center gap-1">
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
