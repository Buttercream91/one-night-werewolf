import type { WinnerSide } from "../shared/types.js";
import type { Room } from "./rooms.js";

export interface VoteResolution {
  killedIds: string[];
  winners: WinnerSide[];
}

// Per the rulebook:
// 1. Each player votes for another player (or themselves, or "no_kill" abstain).
// 2. If no player receives more than one vote, nobody is killed.
// 3. Otherwise, all players tied with the most votes are killed.
// 4. If the Hunter is among the killed, the player the Hunter voted for also dies.
//
// Win conditions:
// - Tanner wins iff the Tanner is killed.
// - If there is at least one Werewolf in play (current role):
//     - Villagers win iff at least one Werewolf is killed.
//     - Otherwise Werewolf team wins (Werewolves + Minion).
// - Wolfless game (no Werewolves in play). House rule:
//     - If a "villager" (any non-werewolf/minion/tanner role) is killed,
//       Werewolf team wins (the Minion wins by virtue of being on that team).
//     - Else if the Minion is killed, Villagers win.
//     - Else if no one is killed (everyone abstained, or no majority),
//       Villagers win.
//     - Else (only the Tanner died) Tanner alone wins.
//
// Each player's personal win is computed client-side from their CURRENT role
// and the `winners` set we return.
export function resolveVotes(room: Room): VoteResolution {
  // Count votes (ignore no_kill).
  const counts = new Map<string, number>();
  for (const p of room.players) {
    if (p.vote && p.vote !== "no_kill") {
      counts.set(p.vote, (counts.get(p.vote) ?? 0) + 1);
    }
  }
  let maxVotes = 0;
  for (const c of counts.values()) maxVotes = Math.max(maxVotes, c);

  let killedIds: string[] = [];
  if (maxVotes >= 2) {
    for (const [id, c] of counts.entries()) {
      if (c === maxVotes) killedIds.push(id);
    }
  }

  // Hunter chain.
  const hunterDeaths: string[] = [];
  for (const id of killedIds) {
    const p = room.players.find((p) => p.id === id);
    if (!p) continue;
    if (room.currentRoleOf(p.id) === "hunter" && p.vote && p.vote !== "no_kill") {
      hunterDeaths.push(p.vote);
    }
  }
  // Append kill log entries (vote kills first, then hunter chain).
  for (const id of killedIds) room.actionLog.push({ kind: "killed", targetId: id, via: "vote" });
  for (const id of hunterDeaths)
    room.actionLog.push({ kind: "killed", targetId: id, via: "hunter" });
  if (killedIds.length === 0 && hunterDeaths.length === 0) {
    room.actionLog.push({ kind: "no_one_died" });
  }
  const allKilled = new Set([...killedIds, ...hunterDeaths]);
  killedIds = [...allKilled];

  // Win calculation.
  const killedRoles = new Set(killedIds.map((id) => room.currentRoleOf(id)));
  const werewolvesInPlay = room.players.some((p) => room.currentRoleOf(p.id) === "werewolf");
  const werewolfDied = killedRoles.has("werewolf");
  const tannerDied = killedRoles.has("tanner");

  const winners = new Set<WinnerSide>();
  if (tannerDied) winners.add("tanner");

  if (werewolvesInPlay) {
    if (werewolfDied) {
      winners.add("villager");
    } else {
      winners.add("werewolf");
    }
  } else {
    const killedRoles = killedIds.map((id) => room.currentRoleOf(id));
    const villagerKilled = killedRoles.some(
      (r) => r !== "werewolf" && r !== "minion" && r !== "tanner",
    );
    const minionKilled = killedRoles.includes("minion");

    if (villagerKilled) {
      // Wolf team wins (only the Minion is on that team in a wolfless game).
      winners.add("minion");
    } else if (minionKilled) {
      winners.add("villager");
    } else if (killedIds.length === 0) {
      winners.add("villager");
    }
    // Else only the Tanner died — Tanner alone wins (already added above).
  }

  return { killedIds, winners: [...winners] };
}
