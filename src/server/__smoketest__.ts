// Quick end-to-end exercise of the game engine. Run with:
//   npx tsx src/server/__smoketest__.ts
// Stubs Socket.io with a no-op so we can drive the Room class directly.

import { rooms } from "./rooms.js";

const fakeIO = {
  to: () => ({ emit: () => {} }),
} as any;

rooms.attachIO(fakeIO);

const room = rooms.create();
const players = ["Alan", "Bea", "Cam", "Dee", "Eli"].map((name) =>
  room.addPlayer(name, "sock-" + name),
);
room.setHost(players[0].id);
room.selectedRoles = [
  "doppelganger",
  "werewolf",
  "werewolf",
  "seer",
  "robber",
  "troublemaker",
  "villager",
  "minion",
];

const start = room.startGame();
if (!start.ok) {
  console.error("startGame failed:", start.error);
  process.exit(1);
}

console.log(
  "Original deal:",
  room.players.map((p) => `${p.name}=${p.originalRole}`).join(", "),
);
console.log("Center:", room.centerCards);

// Drive the night by responding to whichever step we're at with sensible actions.
// Steps no longer auto-advance on the last submission — they advance on a timer.
// Call endNightStep() manually to fast-forward through the smoke test.
let safety = 50;
while (room.phase === "night" && safety-- > 0) {
  const step = room.nightStep!;
  const pending = [...room.nightPendingActors];
  console.log(`\n== Step: ${step} (pending: ${pending.length})`);
  for (const id of pending) {
    const player = room.players.find((p) => p.id === id)!;
    const action = chooseAction(room, player.originalRole!, step, player.id);
    console.log(`  ${player.name} (${player.originalRole}) -> ${JSON.stringify(action)}`);
    const r = room.submitNightAction(id, action);
    if (!r.ok) {
      console.error("  ERROR:", r.error);
      process.exit(1);
    }
  }
  if (room.nightStepTimer) clearTimeout(room.nightStepTimer);
  room.endNightStep();
}

console.log(
  "\nAfter night, current roles:",
  room.players.map((p) => `${p.name}=${room.currentRoleOf(p.id)}`).join(", "),
);
console.log("Center after night:", room.centerCards);

// Skip the day timer; jump to vote.
room.beginVote();

// Each player votes for the next player (so everyone gets exactly 1 vote — nobody dies).
console.log("\nCasting votes (everyone gets 1 → no kills expected)");
for (let i = 0; i < room.players.length; i++) {
  const v = room.players[i];
  const target = room.players[(i + 1) % room.players.length];
  const r = room.castVote(v.id, target.id);
  if (!r.ok) console.error("vote error:", r.error);
}

console.log("Killed:", room.killedIds.map((id) => room.players.find((p) => p.id === id)?.name));
console.log("Winners:", room.winners);

// Now test a wolf-killing vote.
room.resetToLobby();
room.players.forEach((p, i) => {
  p.socketId = "sock-" + i;
  p.connected = true;
});
room.selectedRoles = [
  "doppelganger",
  "werewolf",
  "werewolf",
  "seer",
  "robber",
  "troublemaker",
  "villager",
  "minion",
];
const s2 = room.startGame();
if (!s2.ok) {
  console.error(s2.error);
  process.exit(1);
}
let safety2 = 50;
while (room.phase === "night" && safety2-- > 0) {
  for (const id of [...room.nightPendingActors]) {
    const p = room.players.find((p) => p.id === id)!;
    room.submitNightAction(id, chooseAction(room, p.originalRole!, room.nightStep!, p.id));
  }
  if (room.nightStepTimer) clearTimeout(room.nightStepTimer);
  room.endNightStep();
}
room.beginVote();
const wolf = room.players.find((p) => room.currentRoleOf(p.id) === "werewolf");
if (wolf) {
  for (const p of room.players) {
    if (p.id === wolf.id) {
      const others = room.players.filter((x) => x.id !== p.id);
      room.castVote(p.id, others[0].id);
    } else {
      room.castVote(p.id, wolf.id);
    }
  }
  console.log(
    "\nAll vote wolf — winners:",
    room.winners,
    "killed:",
    room.killedIds.map((id) => room.players.find((p) => p.id === id)?.name),
  );
} else {
  console.log("\nNo wolves left in play after night swaps; skipping wolf-kill test.");
}

console.log("\nSmoke test complete.");

function chooseAction(room: any, _originalRole: string, _step: string, playerId: string): any {
  const player = room.players.find((p: any) => p.id === playerId);
  const prompt = player?.prompt;
  if (!prompt) return { kind: "ack" };
  switch (prompt.kind) {
    case "ack":
      return { kind: "ack" };
    case "doppelganger_choose":
      return { kind: "doppelganger_copy", targetId: prompt.eligiblePlayerIds[0] };
    case "werewolf_lone":
      return { kind: "werewolf_lone_view", centerIndex: null };
    case "seer_choose":
      return { kind: "seer_skip" };
    case "robber_choose":
      return { kind: "robber_swap", targetId: null };
    case "troublemaker_choose":
      return { kind: "troublemaker_swap", targetIds: null };
    case "drunk_choose":
      return { kind: "drunk_swap", centerIndex: 0 };
  }
}
