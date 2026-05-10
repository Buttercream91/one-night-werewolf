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
// in callers if unset.
export function loadNarrator(): string | null {
  try {
    return localStorage.getItem(NARRATOR_KEY);
  } catch {
    return null;
  }
}

export function saveNarrator(packId: string) {
  try {
    localStorage.setItem(NARRATOR_KEY, packId);
  } catch {}
}
