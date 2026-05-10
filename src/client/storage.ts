const KEY = "onuw.session";

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
