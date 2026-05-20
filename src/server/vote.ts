import type { Role, WinnerSide } from "../shared/types.js";
import { WOLF_ROLES } from "../shared/types.js";
import type { Room } from "./rooms.js";

// "Counts as a wolf" for the village kill-condition and wolves-in-play
// checks. Includes the Daybreak wolves (Alpha / Mystic / Dream) plus the
// base Werewolf. The Minion is wolf-team but NEVER counts as a wolf for
// the kill check — that's by design (killing the Minion alone is a wolf
// win, not a village win).
function isWolfKillRole(role: Role): boolean {
  return WOLF_ROLES.includes(role);
}

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

  // Daybreak — Bodyguard's vote saves their pick. We resolve in tiers:
  // start at the top vote count, drop any IDs that a Bodyguard voted for,
  // and if everyone in that tier was saved cascade to the next tier (the
  // "second-most votes" rule). The 2-vote minimum still gates the original
  // kill — if max votes < 2 nobody was going to die anyway, so the save
  // doesn't trigger.
  const savedBy = new Map<string, string[]>(); // saved player → bodyguard IDs
  for (const p of room.players) {
    if (room.effectiveRoleOf(p.id) !== "bodyguard") continue;
    if (!p.vote || p.vote === "no_kill") continue;
    const list = savedBy.get(p.vote) ?? [];
    list.push(p.id);
    savedBy.set(p.vote, list);
  }
  let killedIds: string[] = [];
  if (maxVotes >= 2) {
    // Group all vote-getters by count, walk tiers descending.
    const tiers = new Map<number, string[]>();
    for (const [id, c] of counts.entries()) {
      const arr = tiers.get(c) ?? [];
      arr.push(id);
      tiers.set(c, arr);
    }
    const sortedCounts = [...tiers.keys()].sort((a, b) => b - a);
    for (const c of sortedCounts) {
      const tier = tiers.get(c)!;
      const dying = tier.filter((id) => !savedBy.has(id));
      // Anyone in this tier who WAS bodyguarded gets a save entry, even if
      // the kill ends up falling here anyway (e.g. mixed tier).
      for (const savedId of tier) {
        const guards = savedBy.get(savedId);
        if (!guards) continue;
        for (const bg of guards) {
          room.actionLog.push({
            kind: "bodyguard_saved",
            bodyguardId: bg,
            savedId,
          });
        }
      }
      if (dying.length > 0) {
        killedIds = dying;
        break;
      }
      // Whole tier saved — cascade to next-most.
    }
  }

  // Hunter chain. Uses effectiveRoleOf so a Doppelganger who copied a Hunter
  // still triggers the chain when killed (their physical card is still the
  // Doppelganger card, but their locked-in team / ability is Hunter).
  const hunterDeaths: string[] = [];
  for (const id of killedIds) {
    const p = room.players.find((p) => p.id === id);
    if (!p) continue;
    if (room.effectiveRoleOf(p.id) === "hunter" && p.vote && p.vote !== "no_kill") {
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

  // Win calculation. effectiveRoleOf is the locked-in team identity — for
  // the Doppelganger that's the role they copied, regardless of card swaps.
  // For everyone else it's the role on their physical card (which can change
  // via Robber/Troublemaker/Drunk). The wolf-kill check looks at WOLF_ROLES
  // (Werewolf + Daybreak's Alpha/Mystic/Dream), not just the literal
  // werewolf — killing any wolf-type role earns the village win.
  const killedRoles = new Set(killedIds.map((id) => room.effectiveRoleOf(id)));
  const werewolvesInPlay = room.players.some((p) =>
    isWolfKillRole(room.effectiveRoleOf(p.id)),
  );
  const werewolfDied = [...killedRoles].some((r) => isWolfKillRole(r));
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
    const killedRoles = killedIds.map((id) => room.effectiveRoleOf(id));
    // Wolfless branch only fires when no wolf-type role is in play, but
    // be defensive against future role additions by checking via the helper.
    const villagerKilled = killedRoles.some(
      (r) => !isWolfKillRole(r) && r !== "minion" && r !== "tanner",
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
