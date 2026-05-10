import { io, type Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient, Role } from "../shared/types.js";

// Same-origin in prod; Vite proxies /socket.io to :3001 in dev.
export const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: true });

export function createRoom(
  name: string,
): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    socket.emit("room:create", { name }, (res) => resolve(res));
  });
}

export function joinRoom(
  name: string,
  code: string,
  resumePlayerId?: string,
): Promise<{ ok: true; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    socket.emit("room:join", { name, code, resumePlayerId }, (res) => resolve(res));
  });
}

export const send = {
  setRoles: (roles: Role[]) => socket.emit("lobby:setRoles", { roles }),
  setDaySeconds: (seconds: number) => socket.emit("lobby:setDaySeconds", { seconds }),
  voteVoicePack: (packId: string) => socket.emit("lobby:voteVoicePack", { packId }),
  start: () => socket.emit("lobby:start"),
  nightAction: (action: Parameters<ClientToServer["night:action"]>[0]) =>
    socket.emit("night:action", action),
  dayReady: (ready: boolean) => socket.emit("day:ready", { ready }),
  vote: (targetId: string | "no_kill") => socket.emit("vote:cast", { targetId }),
  reset: () => socket.emit("room:reset"),
  leave: () => socket.emit("room:leave"),
  addNote: (text: string) => socket.emit("note:add", { text }),
  removeNote: (index: number) => socket.emit("note:remove", { index }),
};
