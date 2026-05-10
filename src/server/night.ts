import type { NightAction, NightPrompt, NightStep, Role } from "../shared/types.js";
import type { Room, ServerPlayer } from "./rooms.js";

type ActionResult = { ok: true } | { ok: false; error: string };

// Per-step audio file (under client public/voice/<pack>/). Played at the start
// of the step on every player's device. SAME for everyone whether or not the
// role is filled, so unfilled roles can't be detected.
// Resolved per room based on selected voice pack via voiceUrl() below.
const STEP_FILE: Record<NightStep, string | null> = {
  intro: "Intro.mp3",
  doppelganger: "Doppelganger.mp3",
  werewolves: "Werewolves.mp3",
  minion: "Minion.mp3",
  masons: "Mason.mp3",
  seer: "Seer.mp3",
  robber: "Robber.mp3",
  troublemaker: "Troublemaker.mp3",
  drunk: "Drunk.mp3",
  insomniac: "Insomniac.mp3",
  outro: "Outro.mp3",
};

export function voiceUrlFor(pack: string, step: NightStep): string | undefined {
  const file = STEP_FILE[step];
  if (!file) return undefined;
  return `/voice/${pack}/${file}`;
}

// Should this step play during the night? Intro/outro always do. A role-specific
// step runs only if at least one card of that role is in the deck — which
// players can already see in the lobby, so skipping it leaks no information.
export function isStepInPlay(selectedRoles: Role[], step: NightStep): boolean {
  if (step === "intro" || step === "outro") return true;
  if (step === "doppelganger") return selectedRoles.includes("doppelganger");
  const role: Role =
    step === "werewolves" ? "werewolf" : step === "masons" ? "mason" : (step as Role);
  return selectedRoles.includes(role);
}

// Fixed total duration per step (announcement audio length + action buffer).
// Empty steps wait the same as filled ones so players can't tell which roles
// are unfilled by how fast the night transitions.
// Audio durations measured from the MP3 files; buffer added for action time.
export const STEP_SECONDS: Record<NightStep, number> = {
  intro: 6,
  doppelganger: 14, // ~6s audio + ~8s to pick a player
  werewolves: 14,
  minion: 16,
  masons: 8,
  seer: 16,
  robber: 14,
  troublemaker: 15,
  drunk: 9,
  insomniac: 7,
  outro: 6,
};

// Action applied to actors who don't submit before their step ends.
// Drunk MUST swap; Doppelganger MUST pick (per rulebook). For Doppelganger we
// fall back to a random non-self player at the room level (needs the player list).
export function defaultActionFor(
  step: NightStep,
  isLoneWolf: boolean,
  fallbackTargetId?: string,
): NightAction {
  switch (step) {
    case "doppelganger":
      // If we couldn't find a fallback target the action will fail validation;
      // that's fine — it just means the Doppelganger silently gets nothing.
      return { kind: "doppelganger_copy", targetId: fallbackTargetId ?? "" };
    case "werewolves":
      return isLoneWolf ? { kind: "werewolf_lone_view", centerIndex: null } : { kind: "ack" };
    case "minion":
    case "masons":
    case "insomniac":
      return { kind: "ack" };
    case "seer":
      return { kind: "seer_skip" };
    case "robber":
      return { kind: "robber_swap", targetId: null };
    case "troublemaker":
      return { kind: "troublemaker_swap", targetIds: null };
    case "drunk": {
      const idx = Math.floor(Math.random() * 3) as 0 | 1 | 2;
      return { kind: "drunk_swap", centerIndex: idx };
    }
    case "intro":
    case "outro":
      return { kind: "ack" }; // never used (no pending actors)
  }
}

// Set up prompts and immediate notes for a single night step. Adds player IDs
// to room.nightPendingActors for any player whose action we need to wait on.
// If no players act this step, leaves pending empty (caller still waits the
// step's full duration, then advances — that's how unfilled roles stay hidden).
export function setupNightStep(room: Room, step: NightStep) {
  if (step === "intro" || step === "outro") return;

  const actors = effectiveActorsForStep(room, step);
  if (actors.length === 0) return;

  switch (step) {
    case "doppelganger": {
      for (const d of actors) {
        const eligible = room.players.filter((p) => p.id !== d.id).map((p) => p.id);
        d.prompt = {
          kind: "doppelganger_choose",
          message:
            "You are the Doppelganger. Look at another player's card — you become a copy of that role.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(d.id);
      }
      return;
    }
    case "werewolves": {
      if (actors.length >= 2) {
        room.actionLog.push({
          kind: "werewolves_revealed",
          actorIds: actors.map((a) => a.id),
        });
        for (const w of actors) {
          const others = actors.filter((o) => o.id !== w.id).map((o) => o.id);
          w.notes.push({ kind: "fellow_werewolves", playerIds: others });
          w.prompt = ack("You are a Werewolf. The other werewolf is in your team list.");
          room.nightPendingActors.add(w.id);
        }
      } else {
        const w = actors[0];
        w.prompt = {
          kind: "werewolf_lone",
          message: "You are the lone Werewolf. You may peek at one center card.",
        };
        room.nightPendingActors.add(w.id);
      }
      return;
    }
    case "minion": {
      const wolves = effectiveActorsForRole(room, "werewolf").map((p) => p.id);
      for (const m of actors) {
        m.notes.push({ kind: "minion_sees_werewolves", playerIds: wolves });
        m.prompt = ack(
          wolves.length === 0
            ? "You are the Minion. There are no Werewolves in play — protect the center."
            : "You are the Minion. You see the Werewolves; they do not see you.",
        );
        room.actionLog.push({ kind: "minion_saw_werewolves", actorId: m.id, werewolfIds: wolves });
        room.nightPendingActors.add(m.id);
      }
      return;
    }
    case "masons": {
      const others = actors.length > 1;
      if (others) {
        room.actionLog.push({ kind: "masons_revealed", actorIds: actors.map((a) => a.id) });
      }
      for (const m of actors) {
        const otherIds = actors.filter((o) => o.id !== m.id).map((o) => o.id);
        if (otherIds.length === 0) {
          m.notes.push({ kind: "no_other_masons" });
          m.prompt = ack("You are a Mason. There is no other Mason in play.");
          room.actionLog.push({ kind: "lone_mason", actorId: m.id });
        } else {
          m.notes.push({ kind: "fellow_mason", playerIds: otherIds });
          m.prompt = ack("You are a Mason. The other Mason is in your team list.");
        }
        room.nightPendingActors.add(m.id);
      }
      return;
    }
    case "seer": {
      for (const s of actors) {
        s.prompt = {
          kind: "seer_choose",
          message: "You are the Seer. Look at one other player's card OR two of the center cards.",
        };
        room.nightPendingActors.add(s.id);
      }
      return;
    }
    case "robber": {
      for (const r of actors) {
        const eligible = room.players.filter((p) => p.id !== r.id).map((p) => p.id);
        r.prompt = {
          kind: "robber_choose",
          message:
            "You are the Robber. You may swap your card with another player's and view your new card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(r.id);
      }
      return;
    }
    case "troublemaker": {
      for (const t of actors) {
        const eligible = room.players.filter((p) => p.id !== t.id).map((p) => p.id);
        t.prompt = {
          kind: "troublemaker_choose",
          message: "You are the Troublemaker. You may swap two other players' cards.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(t.id);
      }
      return;
    }
    case "drunk": {
      for (const d of actors) {
        d.prompt = {
          kind: "drunk_choose",
          message:
            "You are the Drunk. Swap your card with one of the center cards (you will not see it).",
        };
        room.nightPendingActors.add(d.id);
      }
      return;
    }
    case "insomniac": {
      for (const i of actors) {
        const current = room.currentRoleOf(i.id);
        i.knownCurrentRole = current;
        i.notes.push({ kind: "insomniac_self", role: current });
        i.prompt = ack(`You are the Insomniac. Your card is now: ${labelFor(current)}.`);
        room.actionLog.push({ kind: "insomniac_saw", actorId: i.id, role: current });
        room.nightPendingActors.add(i.id);
      }
      return;
    }
  }
}

export function applyNightAction(
  room: Room,
  player: ServerPlayer,
  action: NightAction,
): ActionResult {
  const step = room.nightStep;
  if (!step) return { ok: false, error: "No night step" };
  const original = player.originalRole;
  if (!original) return { ok: false, error: "No role assigned" };

  switch (action.kind) {
    case "ack": {
      const validAck =
        (step === "werewolves" && effectiveActorsForRole(room, "werewolf").length >= 2 && isEffective(player, "werewolf")) ||
        (step === "minion" && isEffective(player, "minion")) ||
        (step === "masons" && isEffective(player, "mason")) ||
        (step === "insomniac" && isEffective(player, "insomniac"));
      return validAck ? { ok: true } : { ok: false, error: "Ack not valid here" };
    }

    case "doppelganger_copy": {
      if (step !== "doppelganger" || original !== "doppelganger") {
        return { ok: false, error: "Not doppelganger step" };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id) return { ok: false, error: "Invalid target" };
      const copied = room.currentRoleOf(target.id);
      if (copied === "doppelganger") return { ok: false, error: "Cannot copy a Doppelganger" };
      player.doppelgangerCopied = copied;
      room.setCurrentRole(player.id, copied);
      player.knownCurrentRole = copied;
      player.notes.push({ kind: "doppelganger_copied", targetId: target.id, role: copied });
      room.actionLog.push({
        kind: "doppelganger_copied",
        actorId: player.id,
        targetId: target.id,
        copiedRole: copied,
      });
      return { ok: true };
    }

    case "werewolf_lone_view": {
      if (step !== "werewolves" || !isEffective(player, "werewolf")) {
        return { ok: false, error: "Not the lone wolf step" };
      }
      if (effectiveActorsForRole(room, "werewolf").length !== 1) {
        return { ok: false, error: "Not the lone wolf" };
      }
      if (action.centerIndex === null) {
        room.actionLog.push({ kind: "lone_wolf_skipped", actorId: player.id });
        return { ok: true };
      }
      if (![0, 1, 2].includes(action.centerIndex)) {
        return { ok: false, error: "Invalid center index" };
      }
      const role = room.centerCards[action.centerIndex];
      player.notes.push({ kind: "lone_wolf_center", index: action.centerIndex, role });
      room.actionLog.push({
        kind: "lone_wolf_peeked",
        actorId: player.id,
        centerIndex: action.centerIndex,
        role,
      });
      return { ok: true };
    }

    case "seer_skip": {
      if (step !== "seer" || !isEffective(player, "seer")) return { ok: false, error: "Not seer step" };
      room.actionLog.push({ kind: "seer_skipped", actorId: player.id });
      return { ok: true };
    }
    case "seer_view_player": {
      if (step !== "seer" || !isEffective(player, "seer")) return { ok: false, error: "Not seer step" };
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id) return { ok: false, error: "Invalid target" };
      const role = room.currentRoleOf(target.id);
      player.notes.push({ kind: "seer_player", playerId: target.id, role });
      room.actionLog.push({
        kind: "seer_saw_player",
        actorId: player.id,
        targetId: target.id,
        role,
      });
      return { ok: true };
    }
    case "seer_view_center": {
      if (step !== "seer" || !isEffective(player, "seer")) return { ok: false, error: "Not seer step" };
      const [a, b] = action.indices;
      if (a === b || ![0, 1, 2].includes(a) || ![0, 1, 2].includes(b)) {
        return { ok: false, error: "Pick two distinct center cards" };
      }
      const cards = [
        { index: a, role: room.centerCards[a] },
        { index: b, role: room.centerCards[b] },
      ];
      player.notes.push({ kind: "seer_center", cards });
      room.actionLog.push({ kind: "seer_saw_center", actorId: player.id, cards });
      return { ok: true };
    }

    case "robber_swap": {
      if (step !== "robber" || !isEffective(player, "robber")) return { ok: false, error: "Not robber step" };
      if (action.targetId === null) {
        room.actionLog.push({ kind: "robber_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id) return { ok: false, error: "Invalid target" };
      room.swapPlayerRoles(player.id, target.id);
      const newRole = room.currentRoleOf(player.id);
      player.knownCurrentRole = newRole;
      player.notes.push({ kind: "robber_new_role", targetId: target.id, role: newRole });
      room.actionLog.push({
        kind: "robber_swapped",
        actorId: player.id,
        targetId: target.id,
        newRole,
      });
      return { ok: true };
    }

    case "troublemaker_swap": {
      if (step !== "troublemaker" || !isEffective(player, "troublemaker")) {
        return { ok: false, error: "Not troublemaker step" };
      }
      if (action.targetIds === null) {
        room.actionLog.push({ kind: "troublemaker_skipped", actorId: player.id });
        return { ok: true };
      }
      const [aId, bId] = action.targetIds;
      if (aId === bId || aId === player.id || bId === player.id) {
        return { ok: false, error: "Pick two other distinct players" };
      }
      const a = room.players.find((p) => p.id === aId);
      const b = room.players.find((p) => p.id === bId);
      if (!a || !b) return { ok: false, error: "Unknown player" };
      room.swapPlayerRoles(a.id, b.id);
      room.actionLog.push({
        kind: "troublemaker_swapped",
        actorId: player.id,
        targetIds: [aId, bId],
      });
      return { ok: true };
    }

    case "drunk_swap": {
      if (step !== "drunk" || !isEffective(player, "drunk")) return { ok: false, error: "Not drunk step" };
      if (![0, 1, 2].includes(action.centerIndex)) return { ok: false, error: "Invalid center index" };
      room.swapPlayerWithCenter(player.id, action.centerIndex);
      player.cardFaceDown = true;
      player.knownCurrentRole = undefined;
      room.actionLog.push({
        kind: "drunk_swapped",
        actorId: player.id,
        centerIndex: action.centerIndex,
      });
      return { ok: true };
    }
  }
}

// "Effective role" = original role OR a Doppelganger who copied that role.
// Used in actor selection and validation so the Doppelganger acts in the
// copied role's step exactly as a real X would.
function isEffective(player: ServerPlayer, role: Role): boolean {
  if (player.originalRole === role) return true;
  if (player.originalRole === "doppelganger" && player.doppelgangerCopied === role) return true;
  return false;
}

function effectiveActorsForRole(room: Room, role: Role): ServerPlayer[] {
  return room.players.filter((p) => isEffective(p, role));
}

function effectiveActorsForStep(room: Room, step: NightStep): ServerPlayer[] {
  if (step === "intro" || step === "outro") return [];
  if (step === "doppelganger") {
    return room.players.filter((p) => p.originalRole === "doppelganger");
  }
  const role: Role =
    step === "werewolves" ? "werewolf" : step === "masons" ? "mason" : (step as Role);
  return effectiveActorsForRole(room, role);
}

function ack(message: string): NightPrompt {
  return { kind: "ack", message };
}

function labelFor(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
