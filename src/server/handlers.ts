import type { Socket } from "socket.io";
import type { ClientToServer, Role, ServerToClient } from "../shared/types.js";
import { rooms } from "./rooms.js";

export function registerRoomHandlers(socket: Socket<ClientToServer, ServerToClient>) {
  let attachedRoomCode: string | null = null;
  let attachedPlayerId: string | null = null;

  function attach(code: string, playerId: string) {
    attachedRoomCode = code;
    attachedPlayerId = playerId;
    socket.join(code);
  }

  function detach() {
    if (attachedRoomCode) socket.leave(attachedRoomCode);
    attachedRoomCode = null;
    attachedPlayerId = null;
  }

  function currentRoom() {
    if (!attachedRoomCode) return null;
    return rooms.get(attachedRoomCode);
  }

  socket.on("room:create", ({ name, private: isPrivate }, cb) => {
    if (!validName(name)) return cb({ ok: false, error: "Name required" });
    const room = rooms.create();
    room.privateRoom = !!isPrivate;
    const player = room.addPlayer(name.trim(), socket.id);
    room.setHost(player.id);
    attach(room.code, player.id);
    socket.emit("joined", { roomCode: room.joinCode, playerId: player.id, name: player.name });
    room.broadcast();
    cb({ ok: true, code: room.joinCode, playerId: player.id });
  });

  socket.on("rooms:listPublic", (cb) => {
    cb({ rooms: rooms.listPublic() });
  });

  socket.on("room:join", ({ name, code, resumePlayerId }, cb) => {
    const room = rooms.getByJoinCode(code);
    if (!room) return cb({ ok: false, error: "Room not found" });
    if (!validName(name)) return cb({ ok: false, error: "Name required" });
    let playerId: string;
    if (resumePlayerId && room.hasPlayer(resumePlayerId)) {
      const ok = room.reconnectPlayer(resumePlayerId, socket.id, name.trim());
      if (!ok) return cb({ ok: false, error: "Could not resume" });
      playerId = resumePlayerId;
    } else {
      const dupe = room.findPlayerByName(name.trim());
      if (dupe && !dupe.connected) {
        room.reconnectPlayer(dupe.id, socket.id, name.trim());
        playerId = dupe.id;
      } else if (dupe) {
        return cb({ ok: false, error: "Name already taken in this room" });
      } else {
        // New joiners always start as spectators. In the lobby they can opt
        // into the upcoming game; mid-game they're a spectator until the
        // next round begins.
        const player = room.addPlayer(name.trim(), socket.id, { spectating: true });
        playerId = player.id;
      }
    }
    attach(room.code, playerId);
    socket.emit("joined", { roomCode: room.joinCode, playerId, name: name.trim() });
    room.broadcast();
    cb({ ok: true, playerId });
  });

  socket.on("room:leave", () => {
    if (!attachedRoomCode || !attachedPlayerId) return;
    const room = rooms.get(attachedRoomCode);
    if (!room) return;
    room.removePlayer(attachedPlayerId);
    if (room.players.length === 0) rooms.remove(room.code);
    else room.broadcast();
    detach();
  });

  socket.on("room:spectate", ({ spectating }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.setSpectator(attachedPlayerId, !!spectating);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("disconnect", () => {
    if (!attachedRoomCode || !attachedPlayerId) return;
    const room = rooms.get(attachedRoomCode);
    if (!room) return;
    room.markDisconnected(attachedPlayerId);
    if (room.phase === "lobby") {
      room.removePlayer(attachedPlayerId);
      if (room.players.length === 0) {
        rooms.remove(room.code);
        return;
      }
    }
    room.broadcast();
  });

  socket.on("lobby:setRoles", ({ roles }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (room.hostId !== attachedPlayerId) return;
    if (room.phase !== "lobby") return;
    const next = (roles ?? []).filter(isRole);
    // Enforce the always-on Werewolf invariant.
    if (!next.includes("werewolf")) next.unshift("werewolf");
    room.selectedRoles = next;
    room.broadcast();
  });

  socket.on("note:add", ({ text }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof text !== "string") return;
    room.addUserNote(attachedPlayerId, text);
    room.broadcast();
  });

  socket.on("note:remove", ({ index }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof index !== "number") return;
    room.removeUserNote(attachedPlayerId, index);
    room.broadcast();
  });

  socket.on("lobby:setDaySeconds", ({ seconds }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (room.hostId !== attachedPlayerId) return;
    if (room.phase !== "lobby") return;
    room.daySeconds = Math.max(60, Math.min(900, Math.floor(seconds)));
    room.broadcast();
  });

  socket.on("lobby:setColor", ({ color }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof color !== "string") return;
    const result = room.setPlayerColor(attachedPlayerId, color);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:ready", ({ ready }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    room.setLobbyReady(attachedPlayerId, !!ready);
    room.broadcast();
  });

  socket.on("lobby:kick", ({ playerId }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof playerId !== "string") return;
    const result = room.kickPlayer(attachedPlayerId, playerId);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:forceSpectate", ({ playerId, spectating }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof playerId !== "string") return;
    const result = room.forceSpectate(attachedPlayerId, playerId, !!spectating);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:promoteHost", ({ playerId }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof playerId !== "string") return;
    const result = room.transferHost(attachedPlayerId, playerId);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:muteSpectators", ({ muted }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.setSpectatorsMuted(attachedPlayerId, !!muted);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:setSpectatorsAutoLock", ({ autoLock }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.setSpectatorsAutoLock(attachedPlayerId, !!autoLock);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:muteAllExceptHost", ({ muted }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.setMutedExceptHost(attachedPlayerId, !!muted);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("lobby:announceReadyCheck", () => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (room.hostId !== attachedPlayerId) return;
    if (room.phase !== "lobby") return;
    room.io.to(room.code).emit("room:announce", { kind: "readyCheck" });
  });

  socket.on("lobby:start", () => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (room.hostId !== attachedPlayerId) return;
    const result = room.startGame();
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("night:action", (action) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.submitNightAction(attachedPlayerId, action);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("day:ready", ({ ready }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    room.setDayReady(attachedPlayerId, !!ready);
    room.broadcast();
  });

  socket.on("day:accuse", ({ targetId, role }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof targetId !== "string") return;
    if (role !== null && !isRole(role)) return;
    const result = room.setAccusation(attachedPlayerId, targetId, role);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("vote:cast", ({ targetId }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.castVote(attachedPlayerId, targetId);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("room:pause", ({ paused }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    const result = room.setPaused(attachedPlayerId, !!paused);
    if (!result.ok) return socket.emit("error", { message: result.error });
    room.broadcast();
  });

  socket.on("audio:setReady", ({ ready }) => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    room.setHasMic(attachedPlayerId, !!ready);
    room.broadcast();
  });

  // WebRTC signaling relays. We look up the target by playerId and forward
  // to that socket only. The sender's playerId is appended as `from` so the
  // recipient can identify the peer without trusting client-supplied data.
  function relaySignaling(
    eventName: "webrtc:offer" | "webrtc:answer" | "webrtc:ice",
    payload: { target: string; [k: string]: unknown },
  ) {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (typeof payload?.target !== "string") return;
    const target = room.players.find((p) => p.id === payload.target);
    if (!target || !target.connected) return;
    const { target: _omitTarget, ...rest } = payload;
    socket.to(target.socketId).emit(eventName, { from: attachedPlayerId, ...rest } as never);
  }

  socket.on("webrtc:offer", (p) => relaySignaling("webrtc:offer", p));
  socket.on("webrtc:answer", (p) => relaySignaling("webrtc:answer", p));
  socket.on("webrtc:ice", (p) => relaySignaling("webrtc:ice", p));

  socket.on("room:reset", () => {
    const room = currentRoom();
    if (!room || !attachedPlayerId) return;
    if (room.hostId !== attachedPlayerId) return;
    room.resetToLobby();
    room.broadcast();
  });
}

function validName(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 24;
}

const ROLE_VALUES = new Set<Role>([
  "doppelganger",
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "hunter",
  "tanner",
  "villager",
]);
function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLE_VALUES.has(value as Role);
}
