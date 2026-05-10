import { customAlphabet } from "nanoid";
import type { Server } from "socket.io";
import type {
  Accusation,
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
import { NIGHT_ORDER, ROLE_META } from "../shared/types.js";
import {
  applyNightAction,
  defaultActionFor,
  isStepInPlay,
  setupNightStep,
  STEP_SECONDS,
  stepFileFor,
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
  // Game-time data:
  originalRole?: Role;
  doppelgangerCopied?: Role; // role this player copied if originalRole === doppelganger
  notes: NightNote[];
  userNotes: string[]; // free-form text notes the player typed
  prompt?: NightPrompt;
  knownCurrentRole?: Role;
  cardFaceDown?: boolean; // true after Drunk swap — player holds a card they haven't seen
  vote?: string | null;
  ready?: boolean; // Day phase "ready to vote"
  lobbyReady?: boolean; // Lobby "ready for host to start"
  spectating?: boolean; // Player tapped "Back to lobby" during the round.
  forcedSpectating?: boolean; // Host moved them to spectator; only host releases.
  hasMic?: boolean; // Voice-chat presence flag — set after the client gets mic.
}

type ActionResult = { ok: true } | { ok: false; error: string };

export class Room {
  // Stable internal identifier — used as the registry key, the socket.io room
  // name, and the broadcast target. Never changes for the lifetime of the room.
  code: string;
  // Public code that players type to join. Initially equals `code`; rotates
  // when the host kicks a player so the kicked player can't rejoin with the
  // code they have. Always uppercase A–Z (no vowels).
  joinCode: string;
  io: IO;
  hostId: string | null = null;
  phase: Phase = "lobby";
  players: ServerPlayer[] = [];
  // Always seeded with one Werewolf — the deck must always have at least one,
  // and the lobby UI also enforces this so the slot can't be removed.
  selectedRoles: Role[] = ["werewolf"];
  daySeconds = 300;

  // Game-time:
  centerCards: Role[] = [];
  originalCenterCards: Role[] = [];
  currentRoles = new Map<string, Role>(); // playerId -> live role
  nightStep?: NightStep;
  nightStepEndsAt?: number;
  nightStepVoiceFile?: string;
  nightStepTimer?: NodeJS.Timeout;
  nightPendingActors = new Set<string>();
  dayEndsAt?: number;
  dayTimer?: NodeJS.Timeout;
  // Active accusations. An accuser may hold accusations against multiple
  // distinct targets, so this is a flat array. (accuserId, targetId) pairs
  // are unique — re-accusing the same target replaces the existing entry.
  accusations: Accusation[] = [];
  // Paused state. While paused, both phase timers are cleared and the
  // remaining ms (captured at pause time) is held here so resume can recreate
  // them. Player actions (vote, ready, accuse, night) are rejected.
  paused = false;
  pausedNightRemainingMs?: number;
  pausedDayRemainingMs?: number;
  winners?: WinnerSide[];
  killedIds: string[] = [];
  actionLog: ActionLogEntry[] = [];

  constructor(code: string, io: IO) {
    this.code = code;
    this.joinCode = code;
    this.io = io;
  }

  // ---- Player management ----

  addPlayer(name: string, socketId: string, opts: { spectating?: boolean } = {}): ServerPlayer {
    const player: ServerPlayer = {
      id: newId(),
      name,
      socketId,
      connected: true,
      notes: [],
      userNotes: [],
      spectating: opts.spectating ?? false,
    };
    this.players.push(player);
    return player;
  }

  removePlayer(playerId: string) {
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.hostId === playerId) {
      this.hostId = this.pickFallbackHost(playerId);
    }
  }

  // Pick a sensible new host. Prefer a connected, non-spectator player; fall
  // back to any connected player; finally fall back to null. Used when the
  // current host leaves the room or moves themselves to spectator (a host
  // who's spectating shouldn't gate the round / new-game button).
  private pickFallbackHost(excludeId: string): string | null {
    const active = this.players.find(
      (p) => p.id !== excludeId && p.connected && !p.spectating,
    );
    if (active) return active.id;
    const anyConnected = this.players.find((p) => p.id !== excludeId && p.connected);
    return anyConnected?.id ?? null;
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
    if (p) {
      p.connected = false;
      p.hasMic = false; // Mic implicitly off when the socket drops.
    }
  }

  setHasMic(playerId: string, hasMic: boolean) {
    const p = this.players.find((p) => p.id === playerId);
    if (p) p.hasMic = hasMic;
  }

  setHost(playerId: string) {
    this.hostId = playerId;
  }

  // ---- Lobby → game ----

  startGame(): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Game already started" };
    const activePlayers = this.players.filter((p) => !p.spectating);
    const numPlayers = activePlayers.length;
    if (numPlayers < 3) return { ok: false, error: "Need at least 3 active players" };
    if (numPlayers > 10) return { ok: false, error: "Maximum 10 active players" };
    if (this.selectedRoles.length !== numPlayers + 3) {
      return {
        ok: false,
        error: `Need exactly ${numPlayers + 3} role cards (currently ${this.selectedRoles.length})`,
      };
    }
    // Only non-host active players need to ready up.
    const notReady = activePlayers.filter((p) => p.id !== this.hostId && !p.lobbyReady);
    if (notReady.length > 0) {
      return { ok: false, error: `Waiting on ${notReady.length} player(s) to ready up` };
    }
    const counts = countRoles(this.selectedRoles);
    for (const [role, count] of Object.entries(counts)) {
      const max = ROLE_META[role as Role].maxCount;
      if (count > max) return { ok: false, error: `Too many ${role}s (max ${max})` };
    }
    if ((counts.minion ?? 0) > 0 && (counts.werewolf ?? 0) === 0) {
      return { ok: false, error: "Minion requires at least one Werewolf in the deck" };
    }

    const deck = shuffle(this.selectedRoles.slice());
    // Reset shared per-game state on every player (active and spectator).
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
      p.lobbyReady = false;
    });
    // Deal cards only to non-spectator players. Spectators stay in the room
    // with no role and no card; they watch via spectatorVision.
    activePlayers.forEach((p, i) => {
      p.originalRole = deck[i];
    });
    this.centerCards = deck.slice(numPlayers, numPlayers + 3);
    this.originalCenterCards = this.centerCards.slice();
    this.currentRoles.clear();
    for (const p of activePlayers) {
      if (p.originalRole) this.currentRoles.set(p.id, p.originalRole);
    }
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];
    this.accusations = [];

    this.phase = "night";
    this.nightStep = NIGHT_ORDER[0];
    this.runNightStep();
    return { ok: true };
  }

  resetToLobby() {
    this.phase = "lobby";
    // Spectators stay spectators across the round boundary — they need to
    // explicitly elect into the next game. Active players who chose to step
    // out mid-round (set spectating mid-game) likewise stay spectator until
    // they opt back in.
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
      p.lobbyReady = false;
    });
    this.centerCards = [];
    this.originalCenterCards = [];
    this.currentRoles.clear();
    this.nightStep = undefined;
    this.nightStepEndsAt = undefined;
    this.nightStepVoiceFile = undefined;
    this.nightPendingActors.clear();
    this.dayEndsAt = undefined;
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];
    this.accusations = [];
    if (this.dayTimer) {
      clearTimeout(this.dayTimer);
      this.dayTimer = undefined;
    }
    if (this.nightStepTimer) {
      clearTimeout(this.nightStepTimer);
      this.nightStepTimer = undefined;
    }
    this.paused = false;
    this.pausedNightRemainingMs = undefined;
    this.pausedDayRemainingMs = undefined;
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
    this.nightStepVoiceFile = stepFileFor(step);
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
    this.nightStepVoiceFile = undefined;
    // runNightStep() will skip past any further unselected role steps.
    this.runNightStep();
  }

  // Players submit their action. The step does NOT advance early — we wait
  // out the full duration so timing leaks no information. The actor's prompt
  // is cleared so they see "you've acted" until the step ends.
  submitNightAction(playerId: string, action: NightAction): ActionResult {
    if (this.phase !== "night") return { ok: false, error: "Not night phase" };
    if (this.paused) return { ok: false, error: "Game is paused" };
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

  setAccusation(accuserId: string, targetId: string, role: Role | null): ActionResult {
    if (this.phase !== "day") return { ok: false, error: "Only during the day" };
    if (this.paused) return { ok: false, error: "Game is paused" };
    const accuser = this.players.find((p) => p.id === accuserId);
    if (!accuser || accuser.spectating) {
      return { ok: false, error: "Spectators don't accuse" };
    }
    const target = this.players.find((p) => p.id === targetId);
    if (!target || target.spectating) return { ok: false, error: "Unknown target" };
    // Drop any existing entry for this (accuser, target) pair — re-accusing
    // replaces, role=null clears.
    this.accusations = this.accusations.filter(
      (a) => !(a.accuserId === accuserId && a.targetId === targetId),
    );
    if (role !== null) {
      if (!this.selectedRoles.includes(role)) {
        return { ok: false, error: "Role isn't in this round's deck" };
      }
      this.accusations.push({ accuserId, targetId, role });
    }
    return { ok: true };
  }

  setDayReady(playerId: string, ready: boolean) {
    if (this.phase !== "day") return;
    if (this.paused) return;
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    if (p.spectating) return;
    p.ready = ready;
    // Only connected, non-spectating players block the advance.
    const blockers = this.players.filter((q) => q.connected && !q.spectating);
    if (blockers.length > 0 && blockers.every((q) => q.ready)) {
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
    if (this.paused) return { ok: false, error: "Game is paused" };
    const voter = this.players.find((p) => p.id === playerId);
    if (!voter) return { ok: false, error: "Unknown player" };
    if (voter.spectating) return { ok: false, error: "Spectators don't vote" };
    if (targetId !== "no_kill") {
      const target = this.players.find((p) => p.id === targetId);
      if (!target || target.spectating) return { ok: false, error: "Unknown vote target" };
    }
    const wasUnset = voter.vote == null;
    voter.vote = targetId;
    if (wasUnset) {
      this.actionLog.push({ kind: "vote", voterId: playerId, targetId: targetId as string });
    }
    // Spectators and disconnected players don't gate the resolve.
    const blockers = this.players.filter((q) => q.connected && !q.spectating);
    if (blockers.length > 0 && blockers.every((q) => q.vote != null)) {
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
      code: this.joinCode,
      phase: this.phase,
      serverNow: Date.now(),
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        connected: p.connected,
        isHost: p.id === this.hostId,
        spectating: p.spectating || undefined,
        forcedSpectating: p.forcedSpectating || undefined,
        hasMic: p.hasMic || undefined,
        originalRole: isReveal ? p.originalRole : undefined,
        finalRole: isReveal ? this.currentRoles.get(p.id) ?? p.originalRole : undefined,
        votedFor: isReveal || isVoting ? p.vote ?? null : undefined,
        killed: isReveal ? this.killedIds.includes(p.id) : undefined,
      })),
      selectedRoles: this.selectedRoles,
      nightStep: this.nightStep,
      nightStepEndsAt: this.nightStepEndsAt,
      nightStepVoiceFile: this.nightStepVoiceFile,
      dayEndsAt: this.dayEndsAt,
      daySeconds: this.daySeconds,
      readyPlayerIds: this.players.filter((p) => p.ready).map((p) => p.id),
      paused: this.paused || undefined,
      accusations:
        this.phase === "day" || this.phase === "vote" || this.phase === "reveal"
          ? this.accusations
          : undefined,
      lobbyReadyIds:
        this.phase === "lobby"
          ? this.players.filter((p) => p.lobbyReady).map((p) => p.id)
          : undefined,
      centerCards: isReveal ? this.centerCards : undefined,
      winners: this.winners,
      actionLog: isReveal ? this.actionLog : undefined,
    };
  }

  privateViewFor(playerId: string): PrivateView {
    const p = this.players.find((p) => p.id === playerId);
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
    // Spectators see the full table while a round is in progress: every
    // active player's current role + their personal notes, plus the centre.
    if (p.spectating && this.phase !== "lobby") {
      view.spectatorVision = {
        players: this.players
          .filter((q) => !q.spectating && q.originalRole != null)
          .map((q) => ({
            id: q.id,
            currentRole: this.currentRoles.get(q.id) ?? q.originalRole!,
            originalRole: q.originalRole!,
            notes: q.notes,
            userNotes: q.userNotes,
          })),
        centerCards: this.centerCards.slice(),
      };
    }
    return view;
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

  setLobbyReady(playerId: string, ready: boolean) {
    if (this.phase !== "lobby") return;
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return;
    p.lobbyReady = ready;
  }

  // Host pauses or resumes the round. Pause stops both phase timers and
  // captures their remaining ms so resume can rebuild them. Player actions
  // (vote, accuse, ready, night) are rejected while paused — handlers check
  // room.paused before mutating game state.
  setPaused(hostId: string, paused: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can pause" };
    if (this.phase === "lobby" || this.phase === "reveal") {
      return { ok: false, error: "Nothing to pause" };
    }
    if (paused === this.paused) return { ok: true };
    if (paused) {
      // Capture remaining time and stop the timers.
      if (this.nightStepEndsAt && this.nightStepTimer) {
        this.pausedNightRemainingMs = Math.max(0, this.nightStepEndsAt - Date.now());
        clearTimeout(this.nightStepTimer);
        this.nightStepTimer = undefined;
        this.nightStepEndsAt = undefined;
      }
      if (this.dayEndsAt && this.dayTimer) {
        this.pausedDayRemainingMs = Math.max(0, this.dayEndsAt - Date.now());
        clearTimeout(this.dayTimer);
        this.dayTimer = undefined;
        this.dayEndsAt = undefined;
      }
      this.paused = true;
    } else {
      // Re-create timers using the captured remaining ms.
      if (this.pausedNightRemainingMs != null && this.nightStep) {
        const ms = this.pausedNightRemainingMs;
        this.nightStepEndsAt = Date.now() + ms;
        this.nightStepTimer = setTimeout(() => {
          this.endNightStep();
          this.broadcast();
        }, ms);
        this.pausedNightRemainingMs = undefined;
      }
      if (this.pausedDayRemainingMs != null) {
        const ms = this.pausedDayRemainingMs;
        this.dayEndsAt = Date.now() + ms;
        this.dayTimer = setTimeout(() => {
          this.beginVote();
          this.broadcast();
        }, ms + 100);
        this.pausedDayRemainingMs = undefined;
      }
      this.paused = false;
    }
    return { ok: true };
  }

  // Toggle a player's spectating status.
  //
  // In lobby phase: both directions work. The player chooses whether to play
  // the upcoming round or watch — opting back in is constrained by the
  // active-player cap (10 max).
  //
  // Mid-game: only spectating=true is honoured. Once the deck is dealt you
  // can step out, but you can't step back into a round you weren't dealt
  // into. The card you held stays in the deck (other roles' info may already
  // reference it), but you stop acting, voting, or holding up phase
  // advancement.
  setSpectator(playerId: string, spectating: boolean): ActionResult {
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return { ok: false, error: "Unknown player" };
    if (p.spectating === spectating) return { ok: true };

    if (!spectating) {
      // Becoming a player.
      if (p.forcedSpectating) {
        return {
          ok: false,
          error: "Host moved you to spectator. Only the host can release you.",
        };
      }
      if (this.phase !== "lobby") {
        return { ok: false, error: "Can only join the active player list in the lobby" };
      }
      const activeCount = this.players.filter((q) => !q.spectating).length;
      if (activeCount >= 10) {
        return { ok: false, error: "Active player list is full (10 max)" };
      }
      p.spectating = false;
      return { ok: true };
    }

    // Becoming a spectator.
    p.spectating = true;
    p.prompt = undefined;
    p.lobbyReady = false;
    // If the host moves to spectator, transfer the host role so the round
    // and the New Game button aren't gated on someone who's stepped out.
    if (this.hostId === playerId) {
      const next = this.pickFallbackHost(playerId);
      if (next) this.hostId = next;
    }
    // If they had a pending night action, default it now so the step doesn't
    // wait on them and other roles' visible info stays consistent.
    if (this.phase === "night" && this.nightStep && this.nightPendingActors.has(playerId)) {
      const effectiveWolves = this.players.filter(
        (q) =>
          q.originalRole === "werewolf" ||
          (q.originalRole === "doppelganger" && q.doppelgangerCopied === "werewolf"),
      ).length;
      const isLoneWolf = effectiveWolves === 1;
      const fallbackTargetId =
        this.nightStep === "doppelganger"
          ? this.players.find((q) => q.id !== p.id && !q.spectating)?.id
          : undefined;
      const action = defaultActionFor(this.nightStep, isLoneWolf, fallbackTargetId);
      applyNightAction(this, p, action);
      this.nightPendingActors.delete(playerId);
    }
    // Day: re-check completion now that the spectator no longer counts.
    if (this.phase === "day") {
      const blockers = this.players.filter((q) => q.connected && !q.spectating);
      if (blockers.length > 0 && blockers.every((q) => q.ready)) {
        this.beginVote();
      }
    }
    // Vote: re-check completion. Spectators don't vote at all — they're
    // skipped entirely from the resolve check.
    if (this.phase === "vote") {
      const blockers = this.players.filter((q) => q.connected && !q.spectating);
      if (blockers.length > 0 && blockers.every((q) => q.vote != null)) {
        this.resolveAndReveal();
      }
    }
    // Clear any accusations they made — spectators shouldn't keep asserting things.
    this.accusations = this.accusations.filter((a) => a.accuserId !== playerId);
    return { ok: true };
  }

  // Host force-spectates a player or releases them from forced-spectator.
  // When forcing, the player is immediately moved to spectator with the
  // lock flag set; they can't toggle back without host action. Releasing
  // (spectating=false) clears the lock — the player stays a spectator but
  // is now free to opt back into the active list themselves.
  forceSpectate(hostId: string, targetId: string, spectating: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    if (hostId === targetId) {
      return { ok: false, error: "Use the regular Spectate button on yourself" };
    }
    const target = this.players.find((p) => p.id === targetId);
    if (!target) return { ok: false, error: "Player not in this room" };
    if (spectating) {
      target.forcedSpectating = true;
      // Reuse the regular spectator transition for all the auto-action /
      // ready / vote / accusation cleanup.
      const wasSpectating = target.spectating;
      if (!wasSpectating) {
        const result = this.setSpectator(targetId, true);
        if (!result.ok) {
          target.forcedSpectating = false;
          return result;
        }
      }
    } else {
      target.forcedSpectating = false;
    }
    return { ok: true };
  }

  // Hand the host role to another player in the room. Old host becomes a
  // regular player. Allowed at any time; useful if the current host needs
  // to step out (e.g. spectate) but wants to keep the round going.
  transferHost(currentHostId: string, targetId: string): ActionResult {
    if (this.hostId !== currentHostId) return { ok: false, error: "Only the host can do that" };
    if (currentHostId === targetId) return { ok: true };
    const target = this.players.find((p) => p.id === targetId);
    if (!target) return { ok: false, error: "Player not in this room" };
    if (!target.connected) return { ok: false, error: "Can't hand off to a disconnected player" };
    this.hostId = targetId;
    return { ok: true };
  }

  // Host kicks a player from the lobby. Removes them from the room, notifies
  // their socket so the client can clear its session, and rotates the join
  // code so the kicked player (or anyone they've shared the code with) can't
  // rejoin with the old code.
  kickPlayer(hostId: string, targetId: string): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Can only kick from the lobby" };
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can kick" };
    if (hostId === targetId) return { ok: false, error: "Host can't kick themselves" };
    const target = this.players.find((p) => p.id === targetId);
    if (!target) return { ok: false, error: "Player not in this room" };

    // Tell the target client and disconnect them from this room. The socket
    // stays alive (so the kicked event lands) — we just take them out of the
    // socket.io room and the players list.
    this.io.to(target.socketId).emit("kicked", { reason: "You were removed by the host." });
    const sock = this.io.sockets.sockets.get(target.socketId);
    if (sock) sock.leave(this.code);
    this.removePlayer(targetId);

    // Rotate the join code so the kicked player can't reuse it.
    rooms.rotateJoinCode(this);
    return { ok: true };
  }
}

function nextNightStep(step: NightStep): NightStep | undefined {
  const i = NIGHT_ORDER.indexOf(step);
  return NIGHT_ORDER[i + 1];
}

// ---- Registry ----

class RoomRegistry {
  // Keyed by the stable internal `code`. Used for socket-attached lookups so
  // existing handlers keep working when the public join code rotates.
  private byCode = new Map<string, Room>();
  // Keyed by the rotating public `joinCode`. Used for player join requests.
  private byJoinCode = new Map<string, Room>();
  private io: IO | null = null;

  attachIO(io: IO) {
    this.io = io;
  }

  create(): Room {
    if (!this.io) throw new Error("RoomRegistry has no io attached");
    let code = newCode();
    while (this.byCode.has(code) || this.byJoinCode.has(code)) code = newCode();
    const room = new Room(code, this.io);
    this.byCode.set(code, room);
    this.byJoinCode.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.byCode.get(code.toUpperCase());
  }

  // Used when a player types a code to join.
  getByJoinCode(joinCode: string): Room | undefined {
    return this.byJoinCode.get(joinCode.toUpperCase());
  }

  remove(code: string) {
    const room = this.byCode.get(code);
    this.byCode.delete(code);
    if (room) this.byJoinCode.delete(room.joinCode);
  }

  // Generate a fresh join code (avoiding collisions with any existing room's
  // internal code OR another room's join code) and apply it. Caller is
  // responsible for broadcasting the new state.
  rotateJoinCode(room: Room) {
    let next = newCode();
    while (this.byCode.has(next) || this.byJoinCode.has(next)) next = newCode();
    this.byJoinCode.delete(room.joinCode);
    room.joinCode = next;
    this.byJoinCode.set(next, room);
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
