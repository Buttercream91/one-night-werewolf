import { useEffect, useState } from "react";

// Background music for the night phase. Single HTMLAudioElement, looped,
// volume controlled per device via localStorage. Components subscribe via
// useMusicControls() to re-render when volume/muted/playing changes.
//
// "Ducking" temporarily drops the music volume to 25% of base while the
// narrator is speaking, then restores it. Cleanest way to keep narration
// intelligible without stopping the music outright.

const VOLUME_KEY = "onuw.musicVolume";
const MUTED_KEY = "onuw.musicMuted";
const DUCK_FACTOR = 0.25;

type Listener = () => void;
const listeners = new Set<Listener>();

let element: HTMLAudioElement | null = null;
let baseVolume = 0.5;
let muted = false;
let ducked = false;
let currentSrc: string | null = null;

try {
  const v = localStorage.getItem(VOLUME_KEY);
  if (v != null && !Number.isNaN(Number(v))) {
    baseVolume = Math.max(0, Math.min(1, Number(v)));
  }
  if (localStorage.getItem(MUTED_KEY) === "1") muted = true;
} catch {}

function applyVolume() {
  if (!element) return;
  element.volume = muted ? 0 : baseVolume * (ducked ? DUCK_FACTOR : 1);
}

function notify() {
  for (const l of listeners) l();
}

export function setMusicVolume(v: number) {
  baseVolume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(baseVolume));
  } catch {}
  applyVolume();
  notify();
}

export function setMusicMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTED_KEY, m ? "1" : "0");
  } catch {}
  applyVolume();
  notify();
}

export function startMusic(src: string) {
  if (currentSrc === src && element && !element.paused) return;
  if (!element) {
    element = new Audio();
    element.loop = true;
  }
  currentSrc = src;
  element.src = src;
  applyVolume();
  // Autoplay can be blocked until the user has interacted with the page; by
  // night phase they almost certainly have (they clicked Start), but swallow
  // the rejection just in case.
  element.play().catch(() => {});
  notify();
}

export function stopMusic() {
  if (!element) return;
  element.pause();
  element.currentTime = 0;
  currentSrc = null;
  notify();
}

export function duckMusic() {
  ducked = true;
  applyVolume();
}

export function unduckMusic() {
  ducked = false;
  applyVolume();
}

export function useMusicControls() {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    volume: baseVolume,
    muted,
    playing: !!element && !element.paused,
  };
}
