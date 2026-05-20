import { useEffect, useRef, useState } from "react";
import type { NightStep } from "../shared/types.js";
import { duckMusic, unduckMusic } from "./music.js";

// Narrator audio for the night phase. Shared between NightPhase (active
// players) and SpectatorView (spectators) so both hear the same clip when a
// new step starts. Single module-level Audio element so we don't double-play.
//
// `useStepAudio` accepts the URL sequence to play at the start of `step`. For
// most steps that's a one-element list (e.g. ["/voice/bill/Werewolves.mp3"]);
// the doppelganger_act step assembles a phrase from atomic clips so the
// narrator names only the in-play actionable roles. Clips play back-to-back
// using the single shared audio element.
//
// Returns `true` when the browser blocked autoplay; callers render a
// "Tap to enable narration" affordance that calls `unlockNarrationAudio()`
// from a user gesture.

let audioUnlocked = false;
const audioElement: HTMLAudioElement | null =
  typeof Audio === "undefined" ? null : new Audio();

// Active sequence playback state. `queue` holds the upcoming URLs (the current
// one is already on audioElement.src). When the current clip ends we shift
// the next one off and play it. `seqId` invalidates a sequence when a newer
// step starts mid-playback — late `ended` events for the old id are ignored.
let queue: string[] = [];
let seqId = 0;

if (audioElement) {
  audioElement.addEventListener("ended", () => {
    // Snapshot the id at the moment "ended" fires; if it changes (because a
    // new step kicked off a fresh sequence), we abandon what's left.
    const myId = seqId;
    if (queue.length > 0 && myId === seqId) {
      const next = queue.shift()!;
      audioElement.src = next;
      audioElement.play().catch(() => unduckMusic());
      return;
    }
    unduckMusic();
  });
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
  urls: string[] | undefined,
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
    if (!urls || urls.length === 0 || !audioElement) return;
    // Bump the sequence id so a late `ended` from the previous step can't
    // pop something off the new queue.
    seqId++;
    queue = urls.slice(1); // remaining clips after the first
    audioElement.src = urls[0];
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
  }, [step, urls?.join("|")]);

  return blocked;
}
