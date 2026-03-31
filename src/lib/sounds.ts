export type SoundName = "click" | "launch" | "success";

let audioContext: AudioContext | null = null;

export function initAudio(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

const soundConfigs: Record<SoundName, () => void> = {
  click: () =>
    playTone({ frequency: 600, duration: 0.05, type: "sine", volume: 0.15 }),
  launch: () => playWhoosh(),
  success: () => playChime(),
};

function playTone(config: {
  frequency: number;
  duration: number;
  type: OscillatorType;
  volume: number;
}) {
  const ctx = initAudio();
  if (ctx.state === "suspended") ctx.resume();

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = config.type;
  oscillator.frequency.setValueAtTime(config.frequency, ctx.currentTime);

  gainNode.gain.setValueAtTime(config.volume, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + config.duration
  );

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + config.duration);
}

function playWhoosh() {
  const ctx = initAudio();
  if (ctx.state === "suspended") ctx.resume();

  const duration = 0.15;
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  oscillator.type = "sawtooth";
  oscillator.frequency.setValueAtTime(200, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(
    800,
    ctx.currentTime + duration
  );

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(
    3000,
    ctx.currentTime + duration * 0.3
  );
  filter.frequency.exponentialRampToValueAtTime(
    500,
    ctx.currentTime + duration
  );

  gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(
    0.001,
    ctx.currentTime + duration
  );

  oscillator.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

function playChime() {
  const ctx = initAudio();
  if (ctx.state === "suspended") ctx.resume();

  const notes = [523.25, 659.25]; // C5, E5
  const duration = 0.12;

  notes.forEach((freq, i) => {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(freq, ctx.currentTime);

    const startTime = ctx.currentTime + i * 0.08;
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.12, startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  });
}

export function playSound(sound: SoundName): void {
  try {
    soundConfigs[sound]();
  } catch {
    // Sounds are nice-to-have
  }
}
