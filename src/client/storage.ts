const KEY = "onuw.session";
const NARRATOR_KEY = "onuw.narrator";

export interface SessionData {
  roomCode: string;
  playerId: string;
  name: string;
}

export function loadSession(): SessionData | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data.roomCode === "string" && typeof data.playerId === "string") {
      return data as SessionData;
    }
  } catch {}
  return null;
}

export function saveSession(data: SessionData) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {}
}

export function clearSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

// Per-player narrator preference. Stored in localStorage so it persists
// across sessions on the same device. Falls back to DEFAULT_VOICE_PACK
// in callers if unset or pointing at a pack that no longer exists (so a
// stale pref like "brian" doesn't keep trying to play files we removed).
import { VOICE_PACKS } from "../shared/types.js";

export function loadNarrator(): string | null {
  try {
    const id = localStorage.getItem(NARRATOR_KEY);
    if (id && VOICE_PACKS.some((p) => p.id === id)) return id;
    return null;
  } catch {
    return null;
  }
}

export function saveNarrator(packId: string) {
  try {
    localStorage.setItem(NARRATOR_KEY, packId);
  } catch {}
}
