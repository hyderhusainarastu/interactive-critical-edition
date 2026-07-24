export type SoundName = "click" | "send" | "receive" | "success" | "error" | "toggle";

let context: AudioContext | null = null;

export function canPlaySound(enabled: boolean, reducedMotion = false) {
  return enabled && !reducedMotion && typeof window !== "undefined" && "AudioContext" in window;
}

function getContext() {
  if (typeof window === "undefined") return null;
  context ??= new AudioContext();
  return context;
}

/** A tiny, no-asset interaction palette. It deliberately never throws. */
export function playSound(name: SoundName, enabled = true, options?: { force?: boolean }) {
  if (!options?.force && !enabled) return;
  try {
    const audio = getContext();
    if (!audio) return;
    const tones: Record<SoundName, [number[], number, number]> = {
      click: [[330], 0.035, 0.018], send: [[420, 560], 0.055, 0.022], receive: [[560, 390], 0.06, 0.018],
      success: [[620, 740], 0.09, 0.022], error: [[180, 135], 0.09, 0.018], toggle: [[470], 0.045, 0.018],
    };
    const [frequencies, duration, gain] = tones[name];
    frequencies.forEach((frequency, index) => {
      const start = audio.currentTime + index * 0.045;
      const oscillator = audio.createOscillator();
      const volume = audio.createGain();
      oscillator.type = name === "error" ? "triangle" : "sine";
      oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0.0001, start);
      volume.gain.exponentialRampToValueAtTime(gain, start + 0.008);
      volume.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(volume).connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.01);
    });
  } catch {
    // Browsers may reject audio before a user gesture; interaction still works.
  }
}
