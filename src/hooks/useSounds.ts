import { useCallback, useEffect, useRef } from "react";
import { initAudio, playSound, type SoundName } from "../lib/sounds";

export function useSounds() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;

    const handleFirstInteraction = () => {
      initAudio();
      initialized.current = true;
    };

    const events = ["click", "keydown", "touchstart"] as const;
    events.forEach((event) =>
      document.addEventListener(event, handleFirstInteraction, { once: true })
    );

    return () => {
      events.forEach((event) =>
        document.removeEventListener(event, handleFirstInteraction)
      );
    };
  }, []);

  const play = useCallback((sound: SoundName) => {
    playSound(sound);
  }, []);

  return { play };
}
