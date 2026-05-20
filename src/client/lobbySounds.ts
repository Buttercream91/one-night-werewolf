// Tiny synthesised tones the lobby plays when another player joins or
// leaves the room. Web Audio so we don't ship more mp3s; both effects are a
// two-note chime — rising for join, falling for leave. Browsers may block
// autoplay until the user clicks something; in that case the AudioContext
// fails to start and the tones just don't play, which is harmless.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

// Play a single brief tone. linear-ramped attack + decay so we don't get a
// clicky speaker pop. gain is intentionally low (UI sound shouldn't fight
// with the narrator or music).
function playTone(freq: number, durationMs: number, gain = 0.12, delayMs = 0) {
  const c = getCtx();
  if (!c) return;
  const startAt = c.currentTime + delayMs / 1000;
  const stopAt = startAt + durationMs / 1000;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  env.gain.value = 0;
  env.gain.linearRampToValueAtTime(gain, startAt + 0.02);
  env.gain.linearRampToValueAtTime(0, stopAt);
  osc.connect(env);
  env.connect(c.destination);
  osc.start(startAt);
  osc.stop(stopAt);
}

// C5 → E5 (rising)
export function playJoinSound() {
  playTone(523.25, 110);
  playTone(659.25, 130, 0.12, 100);
}

// E5 → C5 (falling)
export function playLeaveSound() {
  playTone(659.25, 100);
  playTone(523.25, 130, 0.1, 100);
}
