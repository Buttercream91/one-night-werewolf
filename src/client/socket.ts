import { io, type Socket } from "socket.io-client";
import type { ClientToServer, ServerToClient, Role } from "../shared/types.js";

// Same-origin in prod; Vite proxies /socket.io to :3001 in dev.
export const socket: Socket<ServerToClient, ClientToServer> = io({ autoConnect: true });

export function createRoom(
  name: string,
  opts: { private?: boolean; roomName?: string } = {},
): Promise<{ ok: true; code: string; playerId: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    socket.emit(
      "room:create",
      { name, private: opts.private, roomName: opts.roomName },
      (res) => resolve(res),
    );
  });
}

export function listPublicRooms(): Promise<
  Array<{
    code: string;
    roomName?: string;
    hostName: string;
    playerCount: number;
    spectatorCount: number;
  }>
> {
  return new Promise((resolve) => {
    socket.emit("rooms:listPublic", (res) => resolve(res.rooms));
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
  setColor: (color: string) => socket.emit("lobby:setColor", { color }),
  setRemoveCardLimit: (remove: boolean) =>
    socket.emit("lobby:setRemoveCardLimit", { remove }),
  lobbyReady: (ready: boolean) => socket.emit("lobby:ready", { ready }),
  kick: (playerId: string) => socket.emit("lobby:kick", { playerId }),
  forceSpectate: (playerId: string, spectating: boolean) =>
    socket.emit("lobby:forceSpectate", { playerId, spectating }),
  promoteHost: (playerId: string) => socket.emit("lobby:promoteHost", { playerId }),
  muteSpectators: (muted: boolean) => socket.emit("lobby:muteSpectators", { muted }),
  setSpectatorsAutoLock: (autoLock: boolean) =>
    socket.emit("lobby:setSpectatorsAutoLock", { autoLock }),
  muteAllExceptHost: (muted: boolean) => socket.emit("lobby:muteAllExceptHost", { muted }),
  setSpectatorsBlind: (blind: boolean) => socket.emit("lobby:setSpectatorsBlind", { blind }),
  announceReadyCheck: () => socket.emit("lobby:announceReadyCheck"),
  start: () => socket.emit("lobby:start"),
  nightAction: (action: Parameters<ClientToServer["night:action"]>[0]) =>
    socket.emit("night:action", action),
  dayReady: (ready: boolean) => socket.emit("day:ready", { ready }),
  accuse: (targetId: string, role: Role | null) =>
    socket.emit("day:accuse", { targetId, role }),
  vote: (targetId: string | "no_kill") => socket.emit("vote:cast", { targetId }),
  reset: () => socket.emit("room:reset"),
  leave: () => socket.emit("room:leave"),
  spectate: (spectating: boolean) => socket.emit("room:spectate", { spectating }),
  pause: (paused: boolean) => socket.emit("room:pause", { paused }),
  addNote: (text: string) => socket.emit("note:add", { text }),
  removeNote: (index: number) => socket.emit("note:remove", { index }),
  chat: (text: string) => socket.emit("lobby:chat:send", { text }),
};
