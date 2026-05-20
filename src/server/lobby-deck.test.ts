import { describe, expect, test } from "vitest";
import type { Role } from "../shared/types.js";
import {
  PRIORITY_LIST,
  pickNextPriorityToAdd,
  pickNextPriorityToRemoveIdx,
} from "./lobby-deck.js";

describe("priority list shape", () => {
  test("does not include Masons (host manages them in pairs)", () => {
    expect(PRIORITY_LIST.includes("mason")).toBe(false);
  });

  test("Werewolf appears exactly once (the seed is the 1st)", () => {
    expect(PRIORITY_LIST.filter((r) => r === "werewolf").length).toBe(1);
  });

  test("Villager appears 3 times (max for the role)", () => {
    expect(PRIORITY_LIST.filter((r) => r === "villager").length).toBe(3);
  });

  test("priority order matches the user's spec", () => {
    expect(PRIORITY_LIST.slice(0, 8)).toEqual([
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
      "werewolf",
      "doppelganger",
    ]);
  });
});

describe("pickNextPriorityToAdd", () => {
  test("just the seed → next is Seer", () => {
    expect(pickNextPriorityToAdd(["werewolf"])).toBe("seer");
  });

  test("seed + Seer → next is Troublemaker", () => {
    expect(pickNextPriorityToAdd(["werewolf", "seer"])).toBe("troublemaker");
  });

  test("full priority + seed → null", () => {
    const full: Role[] = ["werewolf", ...PRIORITY_LIST];
    expect(pickNextPriorityToAdd(full)).toBeNull();
  });

  test("at slot 6 (werewolf), only seed → adds 2nd werewolf", () => {
    const deck: Role[] = [
      "werewolf",
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
    ];
    expect(pickNextPriorityToAdd(deck)).toBe("werewolf");
  });

  test("respects role maxCount even when the slot says add", () => {
    // 3 villagers is the max. Deck has all 3 already plus the seed + early
    // priority slots filled. Should NOT try to add a 4th villager.
    const deck: Role[] = [
      "werewolf",
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
      "werewolf",
      "doppelganger",
      "drunk",
      "hunter",
      "villager",
      "villager",
      "villager",
    ];
    expect(pickNextPriorityToAdd(deck)).toBeNull();
  });

  test("manual edit (removed Seer) → add fills the gap", () => {
    // Deck has the seed + everything except Seer.
    const deck: Role[] = ["werewolf", "troublemaker", "insomniac"];
    expect(pickNextPriorityToAdd(deck)).toBe("seer");
  });
});

describe("pickNextPriorityToRemoveIdx", () => {
  test("never returns the seed Werewolf when it's the only werewolf", () => {
    const deck: Role[] = ["werewolf", "seer"];
    const idx = pickNextPriorityToRemoveIdx(deck);
    // Either it picks Seer (idx 1) or returns -1 — never idx 0 (the seed).
    expect(idx).not.toBe(0);
    expect(deck[idx]).toBe("seer");
  });

  test("removes Tanner first when only the 7-card base + Tanner are present", () => {
    const deck: Role[] = [
      "werewolf",
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
    ];
    const idx = pickNextPriorityToRemoveIdx(deck);
    expect(deck[idx]).toBe("tanner");
  });

  test("when 2nd werewolf is present, remove it before Tanner", () => {
    const deck: Role[] = [
      "werewolf",
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
      "werewolf", // 2nd
    ];
    const idx = pickNextPriorityToRemoveIdx(deck);
    expect(deck[idx]).toBe("werewolf");
    // Confirms it's the LAST werewolf (idx 7), not the seed (idx 0).
    expect(idx).toBe(7);
  });

  test("preserves manually added Masons (not in priority list)", () => {
    // User manually added 2 Masons. Auto-remove should never touch them.
    const deck: Role[] = [
      "werewolf",
      "seer",
      "mason",
      "mason",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
    ];
    const idx = pickNextPriorityToRemoveIdx(deck);
    expect(deck[idx]).not.toBe("mason");
  });

  test("removes last villager before earlier slots", () => {
    const deck: Role[] = [
      "werewolf",
      "seer",
      "troublemaker",
      "insomniac",
      "robber",
      "minion",
      "tanner",
      "werewolf",
      "doppelganger",
      "drunk",
      "hunter",
      "villager",
      "villager",
    ];
    const idx = pickNextPriorityToRemoveIdx(deck);
    expect(deck[idx]).toBe("villager");
  });

  test("returns -1 when only the seed remains", () => {
    expect(pickNextPriorityToRemoveIdx(["werewolf"])).toBe(-1);
  });
});

describe("add + remove are inverses across player joins/leaves", () => {
  test("N=1..10 join sequence then leave sequence returns to seed", () => {
    let deck: Role[] = ["werewolf"];
    // Simulate 10 joins (target = N+3 cards each step starting at N=1 → 4 cards).
    for (let target = 4; target <= 13; target++) {
      while (deck.length < target) {
        const role = pickNextPriorityToAdd(deck);
        if (!role) break;
        deck.push(role);
      }
      expect(deck.length).toBe(target);
    }
    // Now simulate leaves back down to N=1.
    for (let target = 12; target >= 4; target--) {
      while (deck.length > target) {
        const idx = pickNextPriorityToRemoveIdx(deck);
        if (idx < 0) break;
        deck.splice(idx, 1);
      }
      expect(deck.length).toBe(target);
    }
    // Seed werewolf still alive at the end (plus 3 priority slots for N=1).
    expect(deck.filter((r) => r === "werewolf").length).toBeGreaterThanOrEqual(1);
  });
});
