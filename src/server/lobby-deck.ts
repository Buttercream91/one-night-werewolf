import type { Role } from "../shared/types.js";
import { ROLE_META } from "../shared/types.js";

// Order roles are auto-added to the deck as players join (and auto-removed
// in reverse as players leave). The first Werewolf is the always-on seed
// (not in this list — see seedCumulative). Masons are intentionally
// omitted: they must come in pairs and the host manages them by hand.
// Multi-instance roles (extra Werewolf, Villagers) appear at the slot they
// would be added.
export const PRIORITY_LIST: Role[] = [
  "seer",
  "troublemaker",
  "insomniac",
  "robber",
  "minion",
  "tanner",
  "werewolf", // 2nd werewolf (the seed is the 1st)
  "doppelganger",
  "drunk",
  "hunter",
  "villager",
  "villager",
  "villager",
];

// The 1st Werewolf is the seed — always in the deck, never removed by
// auto-adjust. Treat it as if it sat in the slot before the priority list
// so cumulative counts for werewolf line up with the deck reality.
function seedCumulative(): Partial<Record<Role, number>> {
  return { werewolf: 1 };
}

// Choose the next role to add when the deck needs to grow. Walks the
// priority list left-to-right and returns the first slot whose role appears
// in the deck fewer times than its cumulative count up to that slot (seed
// Werewolf counted). Returns null when every slot is already satisfied
// (deck is at-or-above its priority target).
export function pickNextPriorityToAdd(deck: Role[]): Role | null {
  const cumulative = seedCumulative();
  for (const role of PRIORITY_LIST) {
    cumulative[role] = (cumulative[role] ?? 0) + 1;
    const inDeck = deck.filter((r) => r === role).length;
    if (inDeck < cumulative[role]!) {
      // Defensive — PRIORITY_LIST already respects ROLE_META maxCount, but
      // a manual pre-fill could have already maxed out e.g. Villagers.
      if (inDeck < ROLE_META[role].maxCount) return role;
    }
  }
  return null;
}

// Choose the deck index to remove when the deck needs to shrink. Walks the
// priority list right-to-left; the first slot whose role currently sits at
// or above its cumulative count (seed Werewolf counted) is the one to drop.
// Returns the deck index of the last instance of that role. Never returns
// the seed Werewolf — the seed sits "before" the priority list so its slot
// is unreachable by the reverse walk.
export function pickNextPriorityToRemoveIdx(deck: Role[]): number {
  const cumulative = seedCumulative();
  for (const role of PRIORITY_LIST) {
    cumulative[role] = (cumulative[role] ?? 0) + 1;
  }
  for (let i = PRIORITY_LIST.length - 1; i >= 0; i--) {
    const role = PRIORITY_LIST[i];
    const required = cumulative[role]!;
    const inDeck = deck.filter((r) => r === role).length;
    if (inDeck >= required) {
      return deck.lastIndexOf(role);
    }
    cumulative[role]! -= 1;
  }
  return -1;
}
