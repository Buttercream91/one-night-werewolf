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
