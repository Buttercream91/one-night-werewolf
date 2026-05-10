import { customAlphabet } from "nanoid";
import type { Server } from "socket.io";
import type {
  ActionLogEntry,
  ClientToServer,
  NightAction,
  NightNote,
  NightPrompt,
  NightStep,
  Phase,
  PrivateView,
  PublicRoom,
  Role,
  ServerToClient,
  WinnerSide,
} from "../shared/types.js";
import { DEFAULT_VOICE_PACK, NIGHT_ORDER, ROLE_META, VOICE_PACKS } from "../shared/types.js";
import {
  applyNightAction,
  defaultActionFor,
  isStepInPlay,
  setupNightStep,
  STEP_SECONDS,
  voiceUrlFor,
} from "./night.js";
import { resolveVotes } from "./vote.js";

const newCode = customAlphabet("BCDFGHJKLMNPQRSTVWXYZ", 4);
const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

type IO = Server<ClientToServer, ServerToClient>;

export interface ServerPlayer {
  id: string;
  name: string;
  socketId: string;
  connected: boolean;
  // Lobby:
  voicePackVote?: string;
  // Game-time data:
  originalRole?: Role;
  doppelgangerCopied?: Role; // role this player copied if originalRole === doppelganger
  notes: NightNote[];
  userNotes: string[]; // free-form text notes the player typed
  prompt?: NightPrompt;
  knownCurrentRole?: Role;
  cardFaceDown?: boolean; // true after Drunk swap — player holds a card they haven't seen
  vote?: string | null;
  ready?: boolean;
}

type ActionResult = { ok: true } | { ok: false; error: string };

export class Room {
  code: string;
  io: IO;
  hostId: string | null = null;
  phase: Phase = "lobby";
  players: ServerPlayer[] = [];
  // Always seeded with one Werewolf — the deck must always have at least one,
  // and the lobby UI also enforces this so the slot can't be removed.
  selectedRoles: Role[] = ["werewolf"];
  daySeconds = 300;
  voicePack: string = DEFAULT_VOICE_PACK; // resolved (winning vote or default) at game start

  // Game-time:
  centerCards: Role[] = [];
  originalCenterCards: Role[] = [];
  currentRoles = new Map<string, Role>(); // playerId -> live role
  nightStep?: NightStep;
  nightStepEndsAt?: number;
  nightStepVoiceUrl?: string;
  nightStepTimer?: NodeJS.Timeout;
  nightPendingActors = new Set<string>();
  dayEndsAt?: number;
  dayTimer?: NodeJS.Timeout;
  winners?: WinnerSide[];
  killedIds: string[] = [];
  actionLog: ActionLogEntry[] = [];

  constructor(code: string, io: IO) {
    this.code = code;
    this.io = io;
  }

  // ---- Player management ----

  addPlayer(name: string, socketId: string): ServerPlayer {
    const player: ServerPlayer = {
      id: newId(),
      name,
      socketId,
      connected: true,
      notes: [],
      userNotes: [],
    };
    this.players.push(player);
    return player;
  }

  removePlayer(playerId: string) {
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.hostId === playerId) {
      this.hostId = this.players[0]?.id ?? null;
    }
  }

  hasPlayer(id: string) {
    return this.players.some((p) => p.id === id);
  }

  findPlayerByName(name: string) {
    return this.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  reconnectPlayer(playerId: string, socketId: string, name: string): boolean {
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return false;
    p.socketId = socketId;
    p.connected = true;
    if (this.phase === "lobby") p.name = name;
    return true;
  }

  markDisconnected(playerId: string) {
    const p = this.players.find((p) => p.id === playerId);
    if (p) p.connected = false;
  }

  setHost(playerId: string) {
    this.hostId = playerId;
  }

  // ---- Lobby → game ----

  startGame(): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Game already started" };
    const numPlayers = this.players.length;
    if (numPlayers < 3) return { ok: false, error: "Need at least 3 players" };
    if (numPlayers > 10) return { ok: false, error: "Maximum 10 players" };
    if (this.selectedRoles.length !== numPlayers + 3) {
      return {
        ok: false,
        error: `Need exactly ${numPlayers + 3} role cards (currently ${this.selectedRoles.length})`,
      };
    }
    const counts = countRoles(this.selectedRoles);
    for (const [role, count] of Object.entries(counts)) {
      const max = ROLE_META[role as Role].maxCount;
      if (count > max) return { ok: false, error: `Too many ${role}s (max ${max})` };
    }
    if ((counts.minion ?? 0) > 0 && (counts.werewolf ?? 0) === 0) {
      return { ok: false, error: "Minion requires at least one Werewolf in the deck" };
    }

    // Resolve voice pack from votes: most-voted pack wins, ties broken by
    // lowest index in VOICE_PACKS, default if no votes.
    this.voicePack = tallyVoicePack(this.players);

    const deck = shuffle(this.selectedRoles.slice());
    this.players.forEach((p, i) => {
      p.originalRole = deck[i];
      p.doppelgangerCopied = undefined;
      p.knownCurrentRole = undefined;
      p.cardFaceDown = false;
      p.notes = [];
      p.userNotes = [];
      p.prompt = undefined;
      p.vote = null;
      p.ready = false;
    });
    this.centerCards = deck.slice(numPlayers, numPlayers + 3);
    this.originalCenterCards = this.centerCards.slice();
    this.currentRoles.clear();
    for (const p of this.players) {
      if (p.originalRole) this.currentRoles.set(p.id, p.originalRole);
    }
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];

    this.phase = "night";
    this.nightStep = NIGHT_ORDER[0];
    this.runNightStep();
    return { ok: true };
  }

  resetToLobby() {
    this.phase = "lobby";
    this.players.forEach((p) => {
      p.originalRole = undefined;
      p.doppelgangerCopied = undefined;
      p.knownCurrentRole = undefined;
      p.cardFaceDown = false;
      p.notes = [];
      p.userNotes = [];
      p.prompt = undefined;
      p.vote = null;
      p.ready = false;
    });
    this.centerCards = [];
    this.originalCenterCards = [];
    this.currentRoles.clear();
    this.nightStep = undefined;
    this.nightStepEndsAt = undefined;
    this.nightStepVoiceUrl = undefined;
    this.nightPendingActors.clear();
    this.dayEndsAt = undefined;
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];
    if (this.dayTimer) {
      clearTimeout(this.dayTimer);
      this.dayTimer = undefined;
    }
    if (this.nightStepTimer) {
      clearTimeout(this.nightStepTimer);
      this.nightStepTimer = undefined;
    }
    this.players = this.players.filter((p) => p.connected);
    if (this.hostId && !this.hasPlayer(this.hostId)) {
      this.hostId = this.players[0]?.id ?? null;
    }
  }

  // ---- Night ----

  // Begin a step: set up prompts/notes for actors, schedule the step's fixed
  // duration. We always wait the full duration so empty steps look identical
  // to filled ones — players can't deduce unfilled roles from timing.
  runNightStep() {
    // Skip steps for roles that aren't in the deck. Players already know from
    // the lobby which roles were excluded, so no information leak.
    while (this.nightStep && !isStepInPlay(this.selectedRoles, this.nightStep)) {
      this.nightStep = nextNightStep(this.nightStep);
    }
    if (!this.nightStep) {
      this.beginDay();
      return;
    }
    const step = this.nightStep;
    this.nightPendingActors.clear();
    setupNightStep(this, step);
    const ms = STEP_SECONDS[step] * 1000;
    this.nightStepEndsAt = Date.now() + ms;
    this.nightStepVoiceUrl = voiceUrlFor(this.voicePack, step);
    if (this.nightStepTimer) clearTimeout(this.nightStepTimer);
    this.nightStepTimer = setTimeout(() => {
      this.endNightStep();
      this.broadcast();
    }, ms);
  }

  // Auto-apply default actions for any actor who didn't submit, then advance.
  endNightStep() {
    if (!this.nightStep) return;
    const step = this.nightStep;
    // Effective wolf count includes Doppelganger-as-Werewolf.
    const effectiveWolves = this.players.filter(
      (p) =>
        p.originalRole === "werewolf" ||
        (p.originalRole === "doppelganger" && p.doppelgangerCopied === "werewolf"),
    ).length;
    const isLoneWolf = effectiveWolves === 1;
    for (const actorId of [...this.nightPendingActors]) {
      const player = this.players.find((p) => p.id === actorId);
      if (!player || !player.originalRole) continue;
      // Doppelganger needs a fallback target if they didn't pick. Grab any other player.
      const fallbackTargetId =
        step === "doppelganger"
          ? this.players.find((p) => p.id !== player.id)?.id
          : undefined;
      const action = defaultActionFor(step, isLoneWolf, fallbackTargetId);
      applyNightAction(this, player, action);
      player.prompt = undefined;
    }
    this.nightPendingActors.clear();
    this.nightStep = nextNightStep(step);
    this.nightStepEndsAt = undefined;
    this.nightStepVoiceUrl = undefined;
    // runNightStep() will skip past any further unselected role steps.
    this.runNightStep();
  }

  // Players submit their action. The step does NOT advance early — we wait
  // out the full duration so timing leaks no information. The actor's prompt
  // is cleared so they see "you've acted" until the step ends.
  submitNightAction(playerId: string, action: NightAction): ActionResult {
    if (this.phase !== "night") return { ok: false, error: "Not night phase" };
    if (!this.nightPendingActors.has(playerId)) return { ok: false, error: "Not your turn" };
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: "Unknown player" };
    const result = applyNightAction(this, player, action);
    if (!result.ok) return result;
    this.nightPendingActors.delete(playerId);
    player.prompt = undefined;
    return { ok: true };
  }

  // ---- Day ----

  beginDay() {
    this.phase = "day";
    this.nightStep = undefined;
    this.dayEndsAt = Date.now() + this.daySeconds * 1000;
    this.players.forEach((p) => {
      p.ready = false;
      p.vote = null;
      p.prompt = undefined;
    });
    if (this.dayTimer) clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(
      () => {
        this.beginVote();
        this.broadcast();
      },
      this.daySeconds * 1000 + 100,
    );
  }

  setDayReady(playerId: string, ready: boolean) {
    if (this.phase !== "day") return;
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    p.ready = ready;
    if (this.players.filter((p) => p.connected).every((p) => p.ready)) {
      this.beginVote();
    }
  }

  beginVote() {
    this.phase = "vote";
    this.dayEndsAt = undefined;
    if (this.dayTimer) {
      clearTimeout(this.dayTimer);
      this.dayTimer = undefined;
    }
  }

  castVote(playerId: string, targetId: string): ActionResult {
    if (this.phase !== "vote") return { ok: false, error: "Not voting phase" };
    const voter = this.players.find((p) => p.id === playerId);
    if (!voter) return { ok: false, error: "Unknown player" };
    if (targetId !== "no_kill" && !this.hasPlayer(targetId)) {
      return { ok: false, error: "Unknown vote target" };
    }
    const wasUnset = voter.vote == null;
    voter.vote = targetId;
    if (wasUnset) {
      this.actionLog.push({ kind: "vote", voterId: playerId, targetId: targetId as string });
    }
    if (this.players.every((p) => p.vote != null)) {
      this.resolveAndReveal();
    }
    return { ok: true };
  }

  resolveAndReveal() {
    const { killedIds, winners } = resolveVotes(this);
    this.killedIds = killedIds;
    this.winners = winners;
    this.phase = "reveal";
  }

  // ---- Public state ----

  toPublicRoom(): PublicRoom {
    const isReveal = this.phase === "reveal";
    const isVoting = this.phase === "vote";
    return {
      code: this.code,
      phase: this.phase,
      serverNow: Date.now(),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.id === this.hostId,
        voicePackVote: this.phase === "lobby" ? p.voicePackVote : undefined,
        originalRole: isReveal ? p.originalRole : undefined,
        finalRole: isReveal ? this.currentRoles.get(p.id) ?? p.originalRole : undefined,
        votedFor: isReveal || isVoting ? p.vote ?? null : undefined,
        killed: isReveal ? this.killedIds.includes(p.id) : undefined,
      })),
      selectedRoles: this.selectedRoles,
      voicePack: this.voicePack,
      nightStep: this.nightStep,
      nightStepEndsAt: this.nightStepEndsAt,
      nightStepVoiceUrl: this.nightStepVoiceUrl,
      dayEndsAt: this.dayEndsAt,
      daySeconds: this.daySeconds,
      readyPlayerIds: this.players.filter((p) => p.ready).map((p) => p.id),
      centerCards: isReveal ? this.centerCards : undefined,
      winners: this.winners,
      actionLog: isReveal ? this.actionLog : undefined,
    };
  }

  privateViewFor(playerId: string): PrivateView {
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return { myId: playerId, notes: [], userNotes: [] };
    return {
      myId: p.id,
      myOriginalRole: p.originalRole,
      myKnownCurrentRole: p.knownCurrentRole,
      cardFaceDown: p.cardFaceDown,
      notes: p.notes,
      userNotes: p.userNotes,
      prompt: p.prompt,
    };
  }

  // Free-form text notes the player adds themselves (visible only to them).
  addUserNote(playerId: string, text: string) {
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    const trimmed = text.trim().slice(0, 280);
    if (!trimmed) return;
    if (p.userNotes.length >= 50) return; // sanity cap
    p.userNotes.push(trimmed);
  }

  removeUserNote(playerId: string, index: number) {
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    if (index < 0 || index >= p.userNotes.length) return;
    p.userNotes.splice(index, 1);
  }

  broadcast() {
    const room = this.toPublicRoom();
    this.io.to(this.code).emit("room:state", room);
    for (const p of this.players) {
      if (!p.connected) continue;
      this.io.to(p.socketId).emit("you:state", this.privateViewFor(p.id));
    }
  }

  // ---- Internal helpers used by night.ts ----

  currentRoleOf(playerId: string): Role {
    const p = this.players.find((p) => p.id === playerId);
    return this.currentRoles.get(playerId) ?? (p?.originalRole as Role);
  }

  swapPlayerRoles(aId: string, bId: string) {
    const ra = this.currentRoleOf(aId);
    const rb = this.currentRoleOf(bId);
    this.currentRoles.set(aId, rb);
    this.currentRoles.set(bId, ra);
  }

  swapPlayerWithCenter(playerId: string, idx: number) {
    const rp = this.currentRoleOf(playerId);
    const rc = this.centerCards[idx];
    this.currentRoles.set(playerId, rc);
    this.centerCards[idx] = rp;
  }

  setCurrentRole(playerId: string, role: Role) {
    this.currentRoles.set(playerId, role);
  }

  // Lobby: cast or change a vote for a voice pack. Defaults silently to no-op
  // if the pack id is unknown.
  voteVoicePack(playerId: string, packId: string) {
    if (this.phase !== "lobby") return;
    if (!VOICE_PACKS.find((v) => v.id === packId)) return;
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    p.voicePackVote = packId;
    // Update the room's preview pack to whoever's currently leading, so
    // the lobby UI can show the running winner.
    this.voicePack = tallyVoicePack(this.players);
  }
}

function nextNightStep(step: NightStep): NightStep | undefined {
  const i = NIGHT_ORDER.indexOf(step);
  return NIGHT_ORDER[i + 1];
}

// ---- Registry ----

class RoomRegistry {
  private byCode = new Map<string, Room>();
  private io: IO | null = null;

  attachIO(io: IO) {
    this.io = io;
  }

  create(): Room {
    if (!this.io) throw new Error("RoomRegistry has no io attached");
    let code = newCode();
    while (this.byCode.has(code)) code = newCode();
    const room = new Room(code, this.io);
    this.byCode.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  remove(code: string) {
    this.byCode.delete(code);
  }
}

export const rooms = new RoomRegistry();

// ---- Helpers ----

function countRoles(roles: Role[]): Partial<Record<Role, number>> {
  const c: Partial<Record<Role, number>> = {};
  for (const r of roles) c[r] = (c[r] ?? 0) + 1;
  return c;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pick the winning voice pack from current votes. Ties broken by VOICE_PACKS order.
// Returns DEFAULT_VOICE_PACK if there are no votes.
function tallyVoicePack(players: ServerPlayer[]): string {
  const counts = new Map<string, number>();
  for (const p of players) {
    if (p.voicePackVote) counts.set(p.voicePackVote, (counts.get(p.voicePackVote) ?? 0) + 1);
  }
  if (counts.size === 0) return DEFAULT_VOICE_PACK;
  let bestId = DEFAULT_VOICE_PACK;
  let bestCount = -1;
  let bestIndex = Infinity;
  for (const pack of VOICE_PACKS) {
    const c = counts.get(pack.id) ?? 0;
    const idx = VOICE_PACKS.indexOf(pack);
    if (c > bestCount || (c === bestCount && idx < bestIndex)) {
      bestId = pack.id;
      bestCount = c;
      bestIndex = idx;
    }
  }
  return bestId;
}
