import { useEffect, useRef, useState } from "react";
import type { NightStep } from "../shared/types.js";
import { duckMusic, unduckMusic } from "./music.js";

// Narrator audio for the night phase. Shared between NightPhase (active
// players) and SpectatorView (spectators) so both hear the same clip when a
// new step starts. Single module-level Audio element so we don't double-play.
//
// `useStepAudio` returns `true` when the browser blocked autoplay; callers
// render a "Tap to enable narration" affordance that calls
// `unlockNarrationAudio()` from a user gesture.

let audioUnlocked = false;
const audioElement: HTMLAudioElement | null =
  typeof Audio === "undefined" ? null : new Audio();
if (audioElement) {
  // Restore music volume when the narrator clip ends / is interrupted. We
  // duckMusic() before playing each step's clip; these handlers bring it back.
  audioElement.addEventListener("ended", () => unduckMusic());
  audioElement.addEventListener("pause", () => unduckMusic());
}

export function unlockNarrationAudio() {
  if (!audioElement) return;
  audioElement.muted = true;
  const p = audioElement.play();
  if (p) {
    p.then(() => {
      audioElement.pause();
      audioElement.muted = false;
      audioUnlocked = true;
      window.dispatchEvent(new Event("onuw-audio-unlocked"));
    }).catch(() => {});
  }
}

export function useStepAudio(
  step: NightStep | undefined,
  url: string | undefined,
): boolean {
  const [blocked, setBlocked] = useState(false);
  const lastStep = useRef<NightStep | undefined>(undefined);

  useEffect(() => {
    function onUnlocked() {
      setBlocked(false);
    }
    window.addEventListener("onuw-audio-unlocked", onUnlocked);
    return () => window.removeEventListener("onuw-audio-unlocked", onUnlocked);
  }, []);

  useEffect(() => {
    if (!step || step === lastStep.current) return;
    lastStep.current = step;
    if (!url || !audioElement) return;
    audioElement.src = url;
    duckMusic();
    const p = audioElement.play();
    if (p) {
      p.then(() => {
        audioUnlocked = true;
        setBlocked(false);
      }).catch(() => {
        unduckMusic();
        if (!audioUnlocked) setBlocked(true);
      });
    }
  }, [step, url]);

  return blocked;
}
