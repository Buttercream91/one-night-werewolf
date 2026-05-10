import { PLAYER_COLOR_IDS } from "../shared/types.js";

// Display color classes for each PlayerColorId. The strings have to live in a
// file under tailwind's content path so JIT picks them up — that's this file.
//
// `text` colors player names + log lines. `swatch` is the bg used in the
// lobby's color picker (slightly more saturated than text so the swatch
// reads even when small).
export const PLAYER_COLOR_CLASSES: Record<string, { text: string; swatch: string }> = {
  sky: { text: "text-sky-300", swatch: "bg-sky-400" },
  fuchsia: { text: "text-fuchsia-300", swatch: "bg-fuchsia-400" },
  lime: { text: "text-lime-300", swatch: "bg-lime-400" },
  orange: { text: "text-orange-300", swatch: "bg-orange-400" },
  cyan: { text: "text-cyan-300", swatch: "bg-cyan-400" },
  violet: { text: "text-violet-300", swatch: "bg-violet-400" },
  pink: { text: "text-pink-300", swatch: "bg-pink-400" },
  yellow: { text: "text-yellow-300", swatch: "bg-yellow-400" },
  teal: { text: "text-teal-300", swatch: "bg-teal-400" },
  red: { text: "text-red-300", swatch: "bg-red-400" },
};

// Index-based fallback for old room states where `color` isn't set yet.
const FALLBACK = PLAYER_COLOR_IDS;

interface PlayerLike {
  id: string;
  color?: string;
}

export function playerColor(playerId: string, players: PlayerLike[]): string {
  const p = players.find((pp) => pp.id === playerId);
  if (p?.color) {
    const meta = PLAYER_COLOR_CLASSES[p.color];
    if (meta) return meta.text;
  }
  const idx = players.findIndex((pp) => pp.id === playerId);
  if (idx < 0) return "text-slate-200";
  const fallbackId = FALLBACK[idx % FALLBACK.length];
  return PLAYER_COLOR_CLASSES[fallbackId].text;
}

export function swatchClass(colorId: string): string {
  return PLAYER_COLOR_CLASSES[colorId]?.swatch ?? "bg-slate-400";
}

// Tailwind class to wrap a tile so it visibly pulses while the player speaks.
// Levels above ~0.05 RMS register as "talking"; we use ring thickness +
// opacity tiers so quiet voices get a subtle hint and loud voices get a
// stronger glow.
export function speakingRingClass(level: number): string {
  if (level < 0.05) return "";
  if (level < 0.12) return "ring-1 ring-emerald-500/50";
  if (level < 0.22) return "ring-2 ring-emerald-400/80";
  return "ring-2 ring-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.5)]";
}
