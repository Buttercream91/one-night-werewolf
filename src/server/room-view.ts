import type { DevVision, PrivateView, PublicRoom } from "../shared/types.js";
import type { Room } from "./rooms.js";

// Build the broadcast payload every client (active or spectator) receives on
// every state change. Excludes private per-player data; the matching
// privateViewFor() supplies those separately.
//
// Lives in its own module so the data-shaping logic is testable / readable
// without dragging in the full Room class. Pure: relies only on Room's
// already-public fields.
export function toPublicRoom(room: Room): PublicRoom {
  const isReveal = room.phase === "reveal";
  const isVoting = room.phase === "vote";
  return {
    code: room.joinCode,
    name: room.roomName,
    phase: room.phase,
    serverNow: Date.now(),
    chatMessages: room.phase === "lobby" ? room.chatMessages : undefined,
    spectatorsMuted: room.spectatorsMuted || undefined,
    privateRoom: room.privateRoom || undefined,
    spectatorsAutoLock: room.spectatorsAutoLock || undefined,
    mutedExceptHost: room.mutedExceptHost || undefined,
    spectatorsBlind: room.spectatorsBlind || undefined,
    removeCardLimit: room.removeCardLimit || undefined,
    daybreakEnabled: room.daybreakEnabled || undefined,
    wolfCap: room.wolfCap,
    excludedRoles:
      room.excludedRoles.size > 0 ? [...room.excludedRoles] : undefined,
    centerCardCount: room.phase !== "lobby" ? room.centerCards.length : undefined,
    devMode: room.devMode || undefined,
    devSpeedMultiplier:
      room.devSpeedMultiplier !== 1 ? room.devSpeedMultiplier : undefined,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      isHost: p.id === room.hostId,
      spectating: p.spectating || undefined,
      forcedSpectating: p.forcedSpectating || undefined,
      hasMic: p.hasMic || undefined,
      color: p.color,
      bot: p.bot || undefined,
      originalRole: isReveal ? p.originalRole : undefined,
      finalRole: isReveal ? room.currentRoles.get(p.id) ?? p.originalRole : undefined,
      effectiveRole: isReveal && p.originalRole ? room.effectiveRoleOf(p.id) : undefined,
      votedFor: isReveal || isVoting ? p.vote ?? null : undefined,
      killed: isReveal ? room.killedIds.includes(p.id) : undefined,
    })),
    selectedRoles: room.selectedRoles,
    nightStep: room.nightStep,
    nightStepEndsAt: room.nightStepEndsAt,
    nightStepVoiceFiles: room.nightStepVoiceFiles,
    nightIntroFlippedIds:
      room.nightStep === "intro"
        ? room.players
            .filter(
              (p) =>
                !p.spectating &&
                !!p.originalRole &&
                !p.bot &&
                p.connected &&
                !room.nightPendingActors.has(p.id),
            )
            .map((p) => p.id)
        : undefined,
    shieldedPlayerIds:
      room.phase !== "lobby" && room.shieldedPlayerIds.size > 0
        ? [...room.shieldedPlayerIds]
        : undefined,
    horizontalCenterIndex:
      room.phase !== "lobby" ? room.horizontalCenterIndex : undefined,
    dayEndsAt: room.dayEndsAt,
    daySeconds: room.daySeconds,
    voteEndsAt: room.voteEndsAt,
    readyPlayerIds: room.players.filter((p) => p.ready).map((p) => p.id),
    paused: room.paused || undefined,
    accusations:
      room.phase === "day" || room.phase === "vote" || room.phase === "reveal"
        ? room.accusations
        : undefined,
    lobbyReadyIds:
      room.phase === "lobby"
        ? room.players.filter((p) => p.lobbyReady).map((p) => p.id)
        : undefined,
    centerCards: isReveal ? room.centerCards : undefined,
    winners: room.winners,
    actionLog: isReveal ? room.actionLog : undefined,
  };
}

// Per-player private view. Includes hidden state the player is allowed to
// see (their own role, notes, prompts) and, for spectators or the dev-mode
// host, a snapshot of the whole table so they can follow along.
export function privateViewFor(room: Room, playerId: string): PrivateView {
  const p = room.players.find((p) => p.id === playerId);
  if (!p) return { myId: playerId, notes: [], userNotes: [] };
  const view: PrivateView = {
    myId: p.id,
    myOriginalRole: p.originalRole,
    myKnownCurrentRole: p.knownCurrentRole,
    cardFaceDown: p.cardFaceDown,
    notes: p.notes,
    userNotes: p.userNotes,
    prompt: p.prompt,
  };
  // Spectators see the full table while a round is in progress: every active
  // player's current role + their personal notes, plus the centre. Suppressed
  // entirely when the host has hidden game state from spectators (anti-cheat
  // — stops a spectator from leaking to a player sitting next to them).
  if (p.spectating && room.phase !== "lobby" && !room.spectatorsBlind) {
    view.spectatorVision = {
      players: room.players
        .filter((q) => !q.spectating && q.originalRole != null)
        .map((q) => ({
          id: q.id,
          currentRole: room.currentRoles.get(q.id) ?? q.originalRole!,
          originalRole: q.originalRole!,
          notes: q.notes,
          userNotes: q.userNotes,
        })),
      centerCards: room.centerCards.slice(),
    };
  }
  // Dev mode god-view for the host: every active player's live role +
  // original role + notes, plus centre cards and the running action log.
  // Lets the dev panel show the table state in real time during testing.
  if (room.devMode && room.hostId === playerId && room.phase !== "lobby") {
    const dev: DevVision = {
      players: room.players
        .filter((q) => !q.spectating && q.originalRole != null)
        .map((q) => ({
          id: q.id,
          currentRole: room.currentRoles.get(q.id) ?? q.originalRole!,
          originalRole: q.originalRole!,
          notes: q.notes,
          userNotes: q.userNotes,
          bot: q.bot || undefined,
        })),
      centerCards: room.centerCards.slice(),
      actionLog: room.actionLog.slice(),
    };
    view.devVision = dev;
  }
  return view;
}
