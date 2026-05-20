import { beforeEach, describe, expect, test } from "vitest";
import { rooms, type Room, type ServerPlayer } from "./rooms.js";
import { resolveVotes } from "./vote.js";

// Stub the io so Room operations don't blow up.
const fakeIO = { to: () => ({ emit: () => {} }) } as any;
rooms.attachIO(fakeIO);

// Build a minimal room with the given player roles already dealt. Each entry
// is `[name, originalRole, doppelgangerCopied?]`. Centre cards are passed in
// to round out the deck so currentRoleOf works for everyone.
function makeRoom(
  players: Array<[string, string, string?]>,
  centre: string[] = [],
): { room: Room; ids: Record<string, string> } {
  const room = rooms.create();
  const ids: Record<string, string> = {};
  for (const [name, role, copied] of players) {
    const p = room.addPlayer(name, "s-" + name);
    p.originalRole = role as any;
    if (copied) p.doppelgangerCopied = copied as any;
    ids[name] = p.id;
  }
  // Skip the normal startGame flow; just install currentRoles directly so
  // the tests can dictate the post-night state without simulating actions.
  room.phase = "vote";
  room.centerCards = centre as any;
  room.actionLog = [];
  room.killedIds = [];
  for (const p of room.players) {
    if (p.originalRole) room.setCurrentRole(p.id, p.originalRole);
  }
  return { room, ids };
}

function castEveryoneVotes(
  room: Room,
  ids: Record<string, string>,
  voteMap: Record<string, string>,
) {
  for (const [voter, target] of Object.entries(voteMap)) {
    const p = room.players.find((q) => q.id === ids[voter]);
    if (!p) throw new Error(`unknown voter ${voter}`);
    p.vote = target === "no_kill" ? "no_kill" : ids[target];
  }
}

describe("resolveVotes — basic outcomes", () => {
  test("no kills when no one has 2+ votes", () => {
    const { room, ids } = makeRoom([
      ["A", "werewolf"],
      ["B", "seer"],
      ["C", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "C", C: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([]);
    expect(r.winners).toContain("werewolf");
  });

  test("tied 2-2 between wolf and villager → both die, village wins (a wolf died)", () => {
    const { room, ids } = makeRoom([
      ["A", "werewolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "B", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds.sort()).toEqual([ids.A, ids.B].sort());
    expect(r.winners).toContain("villager");
  });
});

describe("resolveVotes — Daybreak wolf-team kills", () => {
  test("Killing an Alpha Wolf counts as a wolf-team death (village wins)", () => {
    const { room, ids } = makeRoom([
      ["A", "alpha_wolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
    expect(r.winners).not.toContain("werewolf");
  });

  test("Killing a Mystic Wolf counts as a wolf-team death", () => {
    const { room, ids } = makeRoom([
      ["A", "mystic_wolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("Killing a Dream Wolf counts as a wolf-team death", () => {
    const { room, ids } = makeRoom([
      ["A", "dream_wolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("DG-as-Alpha-Wolf killed: village wins (the user's bug report)", () => {
    // Reproduces the exact bug: Alan (DG copied Alpha Wolf) gets killed,
    // village should win. With the old literal-"werewolf" check the wolves
    // were winning instead.
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "alpha_wolf"],
      ["B", "alpha_wolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("Only wolves of Daybreak types in play still counts as 'wolves in play'", () => {
    // No literal Werewolf, only an Alpha Wolf. Wolves should still be
    // considered to be in play — if nobody dies, wolves win.
    const { room, ids } = makeRoom([
      ["A", "alpha_wolf"],
      ["B", "seer"],
      ["C", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "no_kill", B: "no_kill", C: "no_kill" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([]);
    expect(r.winners).toContain("werewolf");
  });
});

describe("resolveVotes — Doppelganger team locking", () => {
  test("DG-as-Werewolf killed → village wins even if DG holds the Doppelganger card", () => {
    // DG's physical card stays "doppelganger"; only doppelgangerCopied marks
    // them as a wolf for team purposes.
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "werewolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("DG-as-Wolf NOT killed, real wolf in play → wolf side wins", () => {
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "werewolf"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    // Everyone abstains — no one dies, wolves win (no wolf was killed).
    castEveryoneVotes(room, ids, {
      A: "no_kill",
      B: "no_kill",
      C: "no_kill",
      D: "no_kill",
    });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([]);
    expect(r.winners).toContain("werewolf");
    expect(r.winners).not.toContain("villager");
  });

  test("DG-as-Hunter killed → hunter chain fires from their copied ability", () => {
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "hunter"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    // A votes for B (their hunter target). Then everyone kills A.
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds.sort()).toEqual([ids.A, ids.B].sort());
    // B was a werewolf → villagers win.
    expect(r.winners).toContain("villager");
  });
});

describe("resolveVotes — Tanner", () => {
  test("Tanner killed alone with a Werewolf in play → both Tanner and Wolves win", () => {
    // Per ONUW: Tanner's win condition is "I die" (always wins when killed).
    // The wolf-team condition is "no wolf died" (still satisfied here).
    // Villagers fail because no wolf was killed. Both teams can win in the
    // same round.
    const { room, ids } = makeRoom([
      ["A", "tanner"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "A", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("tanner");
    expect(r.winners).toContain("werewolf");
    expect(r.winners).not.toContain("villager");
  });

  test("Tanner killed alongside a Werewolf → Tanner + Villagers both win", () => {
    const { room, ids } = makeRoom([
      ["A", "tanner"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "A", B: "A", C: "B", D: "B" });
    const r = resolveVotes(room);
    expect(r.killedIds.sort()).toEqual([ids.A, ids.B].sort());
    expect(r.winners).toContain("tanner");
    expect(r.winners).toContain("villager");
  });
});

describe("resolveVotes — Bodyguard saves", () => {
  test("Bodyguard saves the top-vote target → cascades to second place", () => {
    const { room, ids } = makeRoom([
      ["A", "bodyguard"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    // Top tier: B with 3 votes. Bodyguard A saves B → cascade.
    // Second tier: D with 1 vote → D dies (cascade ignores the 2-vote min).
    castEveryoneVotes(room, ids, { A: "B", B: "D", C: "B", D: "B" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.D]);
  });

  test("Bodyguard saves a non-top target → no effect on the kill", () => {
    const { room, ids } = makeRoom([
      ["A", "bodyguard"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    // Top tier: B with 3 votes. Bodyguard A saves D (irrelevant). B dies.
    castEveryoneVotes(room, ids, { A: "D", B: "C", C: "B", D: "B" });
    const r = resolveVotes(room);
    // Wait — A voted D (1 vote), B voted C (1), C voted B (1), D voted B (1).
    // Top is B with 2, not 3. Let me adjust the test.
    expect(r.killedIds).toEqual([ids.B]);
  });

  test("Multiple Bodyguards saving different targets → both saves apply", () => {
    const { room, ids } = makeRoom([
      ["A", "bodyguard"],
      ["B", "bodyguard"],
      ["C", "werewolf"],
      ["D", "seer"],
    ]);
    // C gets 2 votes, D gets 2 votes (tied). Both saved by different BGs.
    // No tier survives → cascade to next (empty) → no_one_died.
    castEveryoneVotes(room, ids, { A: "C", B: "D", C: "D", D: "C" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([]);
  });

  test("Mixed tier — some saved, some not → only unsaved die", () => {
    const { room, ids } = makeRoom([
      ["A", "bodyguard"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    // C and D both get 2 votes (top tier). C is bodyguarded; D is not.
    castEveryoneVotes(room, ids, { A: "C", B: "C", C: "D", D: "D" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.D]);
  });

  test("DG-as-Bodyguard's vote also saves their target", () => {
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "bodyguard"],
      ["B", "werewolf"],
      ["C", "seer"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "D", C: "B", D: "B" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.D]);
  });
});

describe("resolveVotes — Daybreak artifact team locks", () => {
  test("Claw artifact: killing the bearer counts as a Werewolf kill (village wins)", () => {
    const { room, ids } = makeRoom([
      ["A", "villager"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    room.playerArtifacts.set(ids.A, "claw");
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
    expect(r.winners).not.toContain("werewolf");
  });

  test("Cudgel artifact: killing the bearer satisfies the Tanner win", () => {
    const { room, ids } = makeRoom([
      ["A", "villager"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    room.playerArtifacts.set(ids.A, "cudgel");
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("tanner");
  });

  test("Brand artifact on a Werewolf: killing them no longer counts as a wolf-kill", () => {
    const { room, ids } = makeRoom([
      ["A", "werewolf"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    room.playerArtifacts.set(ids.A, "brand");
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    // A is "villager" via Brand. The room has no Werewolf effectively (Brand
    // turned the only one). Wolfless house rule: villager killed → wolf-team
    // wins via the Minion bucket (no minion either here, but the bucket is
    // still added).
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("minion");
    expect(r.winners).not.toContain("villager");
  });

  test("Artifact trumps Doppelganger team lock", () => {
    // DG copies Werewolf → team would be werewolf, but a Brand artifact
    // re-tags them as villager. Killing them = no wolf kill.
    const { room, ids } = makeRoom([
      ["A", "doppelganger", "werewolf"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    room.playerArtifacts.set(ids.A, "brand");
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    // Real Werewolf B is still alive → wolf team wins.
    expect(r.winners).toContain("werewolf");
    expect(r.winners).not.toContain("villager");
  });
});

describe("resolveVotes — Paranormal Investigator team lock", () => {
  test("PI who viewed a Wolf and got killed counts as a wolf-team death", () => {
    const { room, ids } = makeRoom([
      ["A", "paranormal_investigator"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    // Simulate the PI having viewed a werewolf during the night.
    const pi = room.players.find((p) => p.id === ids.A)!;
    pi.piTeamRole = "werewolf";
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("PI locked to Tanner satisfies the Tanner win if killed", () => {
    const { room, ids } = makeRoom([
      ["A", "paranormal_investigator"],
      ["B", "werewolf"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    const pi = room.players.find((p) => p.id === ids.A)!;
    pi.piTeamRole = "tanner";
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("tanner");
  });
});

describe("resolveVotes — wolfless games (house rule)", () => {
  test("wolfless, villager killed → wolf-team (minion) wins", () => {
    const { room, ids } = makeRoom([
      ["A", "minion"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "C", C: "B", D: "B" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.B]);
    expect(r.winners).toContain("minion");
  });

  test("wolfless, minion killed → villagers win", () => {
    const { room, ids } = makeRoom([
      ["A", "minion"],
      ["B", "seer"],
      ["C", "villager"],
      ["D", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "B", B: "A", C: "A", D: "A" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([ids.A]);
    expect(r.winners).toContain("villager");
  });

  test("wolfless, no one killed → villagers win", () => {
    const { room, ids } = makeRoom([
      ["A", "minion"],
      ["B", "seer"],
      ["C", "villager"],
    ]);
    castEveryoneVotes(room, ids, { A: "no_kill", B: "no_kill", C: "no_kill" });
    const r = resolveVotes(room);
    expect(r.killedIds).toEqual([]);
    expect(r.winners).toContain("villager");
  });
});
