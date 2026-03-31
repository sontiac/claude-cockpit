import { useCallback, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export function useNotifications() {
  const permissionChecked = useRef(false);

  const ensurePermission = useCallback(async () => {
    if (permissionChecked.current) return;
    permissionChecked.current = true;

    let granted = await isPermissionGranted();
    if (!granted) {
      const permission = await requestPermission();
      granted = permission === "granted";
    }
    return granted;
  }, []);

  const notify = useCallback(
    async (title: string, body?: string) => {
      await ensurePermission();
      sendNotification({ title, body });
    },
    [ensurePermission]
  );

  return { notify, ensurePermission };
}
