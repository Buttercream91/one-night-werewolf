import { customAlphabet } from "nanoid";
import type { Server } from "socket.io";
import type {
  Accusation,
  ActionLogEntry,
  ChatMessage,
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
import {
  DAYBREAK_ROLES,
  deckTargetSize,
  NIGHT_ORDER,
  PLAYER_COLOR_IDS,
  ROLE_META,
  WOLF_ROLES,
} from "../shared/types.js";
import {
  pickNextPriorityToAdd,
  pickNextPriorityToRemoveIdx,
} from "./lobby-deck.js";
import {
  applyNightAction,
  defaultActionFor,
  isStepInPlay,
  setupNightStep,
  STEP_SECONDS,
  stepFilesFor,
} from "./night.js";
import { privateViewFor, toPublicRoom } from "./room-view.js";
import { resolveVotes } from "./vote.js";

const newCode = customAlphabet("BCDFGHJKLMNPQRSTVWXYZ", 4);
const newId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);
const MAX_CHAT_MESSAGES = 50;
// Fixed countdown on the vote phase. Any non-bot blocker who hasn't voted
// when this expires gets treated as no_kill, then resolveAndReveal runs.
const VOTE_SECONDS = 20;

type IO = Server<ClientToServer, ServerToClient>;

export interface ServerPlayer {
  id: string;
  name: string;
  socketId: string;
  connected: boolean;
  // Game-time data:
  originalRole?: Role;
  doppelgangerCopied?: Role; // role this player copied if originalRole === doppelganger
  // Daybreak — Paranormal Investigator's team lock. Set when the PI viewed
  // a non-villager-team card and "becomes" that role's team. Card stays PI;
  // only team alignment changes (read via effectiveRoleOf for win logic).
  piTeamRole?: Role;
  // Daybreak — Paranormal Investigator picks remaining in the current step
  // (starts at 2, decremented on each view; cleared / set to 0 when the PI
  // becomes a non-villager team or stops early).
  piPicksRemaining?: number;
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
  color?: string; // PlayerColorId — auto-assigned on join, changeable in lobby.
  bot?: boolean; // Host-added auto-acting player for solo testing.
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
  // Optional friendly name set by the host at create time.
  roomName?: string;
  io: IO;
  hostId: string | null = null;
  phase: Phase = "lobby";
  players: ServerPlayer[] = [];
  // Always seeded with one Werewolf — the deck must always have at least one,
  // and the lobby UI also enforces this so the slot can't be removed.
  selectedRoles: Role[] = ["werewolf"];
  daySeconds = 300;
  // Host-toggled flag: when true, every spectator is treated as canSpeak=false
  // regardless of phase. Reduces lobby chatter when there are many spectators.
  spectatorsMuted = false;
  // True when the host marked the room private at create time. Private rooms
  // never appear in the rooms:listPublic results.
  privateRoom = false;
  // Host-toggled gating: when true, new joiners arrive forcedSpectating=true
  // so they can't opt themselves into the active player list — the host has
  // to release them via the regular force-spectate menu.
  spectatorsAutoLock = false;
  // Host-only "announcement mode" — everyone but the host has their mic
  // gated off. Used to silence the room while the host speaks.
  mutedExceptHost = false;
  // Host-toggled flag to suppress spectatorVision in PrivateView. With this
  // on, spectators get no card/role/notes/centre data — only the public room
  // state. Stops a spectator next to a player from leaking the game.
  spectatorsBlind = false;
  // Host-toggled flag: when true, the deck size validation in startGame
  // accepts any size >= active players + 3 instead of requiring exact match.
  // Extras are dealt into the centre, growing the unknown pool.
  removeCardLimit = false;
  // Host-enabled Daybreak expansion. Off by default — disabling it removes
  // any Daybreak roles currently in selectedRoles so the deck stays valid.
  daybreakEnabled = false;
  // Maximum number of wolf-team cards (Werewolf, Alpha/Mystic/Dream Wolf)
  // allowed in the deck. Default 3 per Daybreak guidance. Host can dial it
  // between 1 and 5 via the role-section menu. Hard cap is also enforced by
  // each role's ROLE_META.maxCount.
  wolfCap = 3;
  // Dev mode (host-only). Enables the dev panel's server-side actions.
  devMode = false;
  // Multiplier applied to upcoming night-step + day-phase durations. 1 by
  // default; the dev panel lets the host set 1/2/5/10 etc.
  devSpeedMultiplier = 1;
  // Lobby chat ring buffer. Capped at MAX_CHAT_MESSAGES; cleared on game
  // start. Broadcast as part of PublicRoom only in the lobby phase.
  chatMessages: ChatMessage[] = [];

  // Game-time:
  centerCards: Role[] = [];
  originalCenterCards: Role[] = [];
  // Daybreak — index of the centre card the Alpha Wolf is meant to swap with
  // (rendered horizontally on the client). Set at deal time when Alpha Wolf
  // is in the deck. undefined otherwise. The card itself behaves like any
  // other centre card for Seer / Drunk / Witch / Lone Wolf interactions.
  horizontalCenterIndex?: number;
  currentRoles = new Map<string, Role>(); // playerId -> live role
  nightStep?: NightStep;
  nightStepEndsAt?: number;
  nightStepVoiceFiles?: string[];
  nightStepTimer?: NodeJS.Timeout;
  nightPendingActors = new Set<string>();
  // Daybreak — IDs of players whose cards are protected by the Sentinel's
  // shield. Populated during the Sentinel step; every subsequent night
  // action checks this set before touching the target. Cleared at game
  // start and at reset.
  shieldedPlayerIds = new Set<string>();
  dayEndsAt?: number;
  dayTimer?: NodeJS.Timeout;
  voteEndsAt?: number;
  voteTimer?: NodeJS.Timeout;
  pausedVoteRemainingMs?: number;
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
    const spectating = opts.spectating ?? false;
    // Auto-lock applies when the room has the toggle on AND the new player is
    // a spectator (which is the default for room:join). Hosts and dedicated
    // active joiners aren't locked.
    const forcedSpectating = spectating && this.spectatorsAutoLock ? true : undefined;
    const player: ServerPlayer = {
      id: newId(),
      name,
      socketId,
      connected: true,
      notes: [],
      userNotes: [],
      spectating,
      forcedSpectating,
      // Spectators don't get colors — colors are reserved for the active
      // player list. They get one assigned on opt-in to the active list.
      color: spectating ? undefined : this.pickFreeColor(),
    };
    this.players.push(player);
    if (!spectating) this.autoAdjustDeck();
    return player;
  }

  // Pick the first PLAYER_COLOR_ID not already used by another active player.
  // Spectators are ignored when checking conflicts.
  private pickFreeColor(): string {
    const used = new Set(
      this.players
        .filter((p) => !p.spectating && p.color)
        .map((p) => p.color as string),
    );
    return PLAYER_COLOR_IDS.find((c) => !used.has(c)) ?? PLAYER_COLOR_IDS[0];
  }

  removePlayer(playerId: string) {
    const wasActive = !!this.players.find((p) => p.id === playerId && !p.spectating);
    this.players = this.players.filter((p) => p.id !== playerId);
    if (this.hostId === playerId) {
      this.hostId = this.pickFallbackHost(playerId);
    }
    if (wasActive) this.autoAdjustDeck();
  }

  // Pick a sensible new host. Prefer a connected, non-spectator, non-bot
  // player; fall back to any connected non-bot player; finally fall back to
  // null. Bots are skipped because they have no real socket to act through.
  private pickFallbackHost(excludeId: string): string | null {
    const active = this.players.find(
      (p) => p.id !== excludeId && p.connected && !p.spectating && !p.bot,
    );
    if (active) return active.id;
    const anyConnected = this.players.find(
      (p) => p.id !== excludeId && p.connected && !p.bot,
    );
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

  startGame(opts?: { skipReadyCheck?: boolean; manualRoles?: Record<string, Role> }): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Game already started" };
    const activePlayers = this.players.filter((p) => !p.spectating);
    const numPlayers = activePlayers.length;
    if (numPlayers < 3) return { ok: false, error: "Need at least 3 active players" };
    if (numPlayers > 10) return { ok: false, error: "Maximum 10 active players" };
    // Target deck size: normally N+3, plus an extra slot when Alpha Wolf is
    // selected (the horizontal centre wolf card is drawn from selectedRoles
    // at deal time, so the host needs one extra pick to feed the deal).
    const target = deckTargetSize(numPlayers, this.selectedRoles);
    if (this.removeCardLimit) {
      if (this.selectedRoles.length < target) {
        return {
          ok: false,
          error: `Need at least ${target} role cards (currently ${this.selectedRoles.length})`,
        };
      }
    } else if (this.selectedRoles.length !== target) {
      return {
        ok: false,
        error: `Need exactly ${target} role cards (currently ${this.selectedRoles.length})`,
      };
    }
    // Only non-host, non-bot active players need to ready up. forceStart can
    // bypass this entirely.
    if (!opts?.skipReadyCheck) {
      const notReady = activePlayers.filter(
        (p) => p.id !== this.hostId && !p.bot && !p.lobbyReady,
      );
      if (notReady.length > 0) {
        return { ok: false, error: `Waiting on ${notReady.length} player(s) to ready up` };
      }
    }
    const counts = countRoles(this.selectedRoles);
    for (const [role, count] of Object.entries(counts)) {
      const max = ROLE_META[role as Role].maxCount;
      if (count > max) return { ok: false, error: `Too many ${role}s (max ${max})` };
    }
    if ((counts.minion ?? 0) > 0 && (counts.werewolf ?? 0) === 0) {
      return { ok: false, error: "Minion requires at least one Werewolf in the deck" };
    }
    if ((counts.mason ?? 0) === 1) {
      return { ok: false, error: "Masons come in pairs — pick 0 or 2" };
    }
    // Daybreak gate — the host must explicitly enable the expansion before
    // any of its roles can be in the deck.
    if (!this.daybreakEnabled) {
      const stray = DAYBREAK_ROLES.find((r) => (counts[r] ?? 0) > 0);
      if (stray) {
        return {
          ok: false,
          error: `${ROLE_META[stray].label} is a Daybreak role — enable the Daybreak expansion to use it.`,
        };
      }
    }
    // Wolf cap — defensive, since the lobby UI already blocks picks above
    // the cap. Counts every wolf-team role (Werewolf + Alpha/Mystic/Dream).
    const wolfCount = this.selectedRoles.filter((r) => WOLF_ROLES.includes(r)).length;
    if (wolfCount > this.wolfCap) {
      return {
        ok: false,
        error: `Too many wolves (${wolfCount}/${this.wolfCap}) — lower the count or raise the cap in the deck menu.`,
      };
    }

    // Reset shared per-game state on every player (active and spectator).
    this.players.forEach((p) => {
      p.originalRole = undefined;
      p.doppelgangerCopied = undefined;
      p.piTeamRole = undefined;
      p.piPicksRemaining = undefined;
      p.knownCurrentRole = undefined;
      p.cardFaceDown = false;
      p.notes = [];
      p.userNotes = [];
      p.prompt = undefined;
      p.vote = null;
      p.ready = false;
      p.lobbyReady = false;
    });
    // Deal pipeline. We work on a mutable copy of selectedRoles, optionally
    // pulling out one wolf for the Alpha Wolf horizontal slot, then either
    // honouring manualRoles (dev mode) or doing a fresh shuffle for the
    // remaining cards.
    const working = this.selectedRoles.slice();
    let horizontalCard: Role | undefined;
    if (this.selectedRoles.includes("alpha_wolf")) {
      // Multiset-weighted random pick of one wolf-team card from selectedRoles.
      // Removed from `working` so it can't also be dealt — no duplicates.
      const wolfIndexes = working
        .map((r, i) => (WOLF_ROLES.includes(r) ? i : -1))
        .filter((i) => i >= 0);
      if (wolfIndexes.length > 0) {
        const pickIdx =
          wolfIndexes[Math.floor(Math.random() * wolfIndexes.length)];
        horizontalCard = working[pickIdx];
        working.splice(pickIdx, 1);
      }
    }

    let centerDeck: Role[];
    if (opts?.manualRoles) {
      function take(role: Role): boolean {
        const i = working.indexOf(role);
        if (i < 0) return false;
        working.splice(i, 1);
        return true;
      }
      for (const p of activePlayers) {
        const assigned = opts.manualRoles[p.id];
        if (!assigned) continue;
        if (!take(assigned)) {
          return {
            ok: false,
            error: `Manual role ${assigned} for ${p.name} isn't in the selected deck`,
          };
        }
        p.originalRole = assigned;
      }
      const shuffled = shuffle(working);
      let cursor = 0;
      for (const p of activePlayers) {
        if (!p.originalRole) {
          p.originalRole = shuffled[cursor++];
        }
      }
      centerDeck = shuffled.slice(cursor);
    } else {
      const deck = shuffle(working);
      activePlayers.forEach((p, i) => {
        p.originalRole = deck[i];
      });
      // Default is exactly 3 (working = N+3); when removeCardLimit is on the
      // centre can be larger.
      centerDeck = deck.slice(numPlayers);
    }
    this.centerCards = centerDeck;
    if (horizontalCard !== undefined) {
      this.centerCards.push(horizontalCard);
      this.horizontalCenterIndex = this.centerCards.length - 1;
    } else {
      this.horizontalCenterIndex = undefined;
    }
    this.originalCenterCards = this.centerCards.slice();
    this.currentRoles.clear();
    for (const p of activePlayers) {
      if (p.originalRole) {
        this.currentRoles.set(p.id, p.originalRole);
        // Persistent "You are the X" note so once the card flips face-down
        // the player can still recall what they were dealt.
        p.notes.push({ kind: "starting_role", role: p.originalRole });
      }
    }
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];
    this.accusations = [];
    this.shieldedPlayerIds.clear();
    this.chatMessages = []; // start the new round's chat fresh

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
      p.piTeamRole = undefined;
      p.piPicksRemaining = undefined;
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
    this.horizontalCenterIndex = undefined;
    this.currentRoles.clear();
    this.nightStep = undefined;
    this.nightStepEndsAt = undefined;
    this.nightStepVoiceFiles = undefined;
    this.nightPendingActors.clear();
    this.dayEndsAt = undefined;
    this.killedIds = [];
    this.winners = undefined;
    this.actionLog = [];
    this.accusations = [];
    this.shieldedPlayerIds.clear();
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
    this.pausedVoteRemainingMs = undefined;
    this.voteEndsAt = undefined;
    if (this.voteTimer) {
      clearTimeout(this.voteTimer);
      this.voteTimer = undefined;
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
    const ms = (STEP_SECONDS[step] * 1000) / Math.max(1, this.devSpeedMultiplier);
    this.nightStepEndsAt = Date.now() + ms;
    this.nightStepVoiceFiles = stepFilesFor(step, this.selectedRoles);
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
    // "Lone wolf" peek check: the actor only gets the centre peek when they
    // are the sole wolf in play. With Daybreak, any wolf-family role
    // (Werewolf / Alpha / Mystic / Dream + DG copies of any) counts toward
    // the wolf headcount — a Dream Wolf cancels lone status even though they
    // never wake (the live wolf "knows" they're not alone).
    const totalWolves = this.players.filter((p) => isAnyWolf(p)).length;
    const isLoneWolf = totalWolves === 1;
    for (const actorId of [...this.nightPendingActors]) {
      const player = this.players.find((p) => p.id === actorId);
      if (!player || !player.originalRole) continue;
      // Doppelganger needs a fallback target if they didn't pick. Grab any other player.
      const fallbackTargetId =
        step === "doppelganger"
          ? this.players.find((p) => p.id !== player.id && !p.spectating)?.id
          : undefined;
      const action = defaultActionFor(
        step,
        isLoneWolf,
        fallbackTargetId,
        player.doppelgangerCopied,
      );
      applyNightAction(this, player, action);
      player.prompt = undefined;
    }
    this.nightPendingActors.clear();
    // Card-flip housekeeping. After intro every active player's card flips
    // face-down (it was face-up for the dealt-card reveal). After any acting
    // step the actor's card flips face-down too — they got a brief look
    // during the step but otherwise should be staring at the card back. The
    // exception is the Insomniac, who keeps their card face-up through the
    // rest of the round so they can see it during day/vote.
    this.applyEndOfStepCardFlips(step);
    this.nightStep = nextNightStep(step);
    this.nightStepEndsAt = undefined;
    this.nightStepVoiceFiles = undefined;
    // runNightStep() will skip past any further unselected role steps.
    this.runNightStep();
  }

  // Card visibility rules at the end of each night step. See endNightStep().
  private applyEndOfStepCardFlips(step: NightStep) {
    if (step === "intro") {
      for (const p of this.players) {
        if (p.spectating) continue;
        if (!p.originalRole) continue;
        p.cardFaceDown = true;
      }
      return;
    }
    if (step === "insomniac") {
      // Insomniac (and DG-as-Insomniac) keeps their card face-up afterwards.
      for (const p of this.players) {
        if (p.spectating) continue;
        const isInsomniacActor =
          p.originalRole === "insomniac" ||
          (p.originalRole === "doppelganger" && p.doppelgangerCopied === "insomniac");
        if (isInsomniacActor) p.cardFaceDown = false;
      }
      return;
    }
    // Every other acting step: any actor (real or DG-copy) flips back to
    // face-down after their brief reveal. Drunk swaps already set the flag
    // true and stay that way; we leave them alone.
    if (
      step === "doppelganger" ||
      step === "doppelganger_act" ||
      step === "werewolves" ||
      step === "minion" ||
      step === "masons" ||
      step === "seer" ||
      step === "robber" ||
      step === "troublemaker" ||
      step === "drunk"
    ) {
      for (const p of this.players) {
        if (p.spectating) continue;
        if (!p.originalRole) continue;
        if (p.cardFaceDown) continue;
        // Only flip the actors of this step (so a player who didn't wake on
        // this step doesn't get retroactively masked — they were already
        // face-down from intro).
        const acted = this.actedOnStep(p, step);
        if (acted) p.cardFaceDown = true;
      }
    }
  }

  // True if `player` was an actor on `step` — used to decide whose card to
  // flip face-down at step end. Mirrors the actor selection inside night.ts
  // but doesn't need to import it (just role identity + DG copy).
  private actedOnStep(p: ServerPlayer, step: NightStep): boolean {
    if (!p.originalRole) return false;
    if (step === "doppelganger") return p.originalRole === "doppelganger";
    // doppelganger_act / the new DG sub-steps all share the same shape — the
    // DG counts as having acted iff their copy matches the slot.
    if (step === "doppelganger_act") return isDgActActor(p);
    if (step === "doppelganger_insomniac") {
      return p.originalRole === "doppelganger" && p.doppelgangerCopied === "insomniac";
    }
    if (step === "doppelganger_revealer") {
      return p.originalRole === "doppelganger" && p.doppelgangerCopied === "revealer";
    }
    if (step === "doppelganger_curator") {
      return p.originalRole === "doppelganger" && p.doppelgangerCopied === "curator";
    }
    // Werewolves step: any awake wolf (including DG copies of Alpha/Mystic).
    if (step === "werewolves") return isAwakeWolfP(p);
    const target: Role =
      step === "masons" ? "mason" : (step as Role);
    if (p.originalRole === target) return true;
    // DG copies of werewolf/minion/mason/insomniac/revealer/curator/bodyguard
    // still act on those steps (concurrent or after-real-role patterns). The
    // DG-act roles (Sentinel/Alpha/Mystic/AppSeer/PI/Witch/VillageIdiot and
    // the base four) acted earlier and shouldn't be counted again here.
    const dgActSet = [
      "seer", "robber", "troublemaker", "drunk",
      "sentinel", "alpha_wolf", "mystic_wolf",
      "apprentice_seer", "paranormal_investigator",
      "witch", "village_idiot",
    ];
    if (
      p.originalRole === "doppelganger" &&
      p.doppelgangerCopied === target &&
      !dgActSet.includes(target)
    ) {
      return true;
    }
    return false;
  }

  // Players submit their action. The step does NOT advance early — we wait
  // out the full duration so timing leaks no information. Exception: intro
  // has nothing to leak (everyone is flipping their card), so it can advance
  // as soon as every pending player has flipped.
  submitNightAction(playerId: string, action: NightAction): ActionResult {
    if (this.phase !== "night") return { ok: false, error: "Not night phase" };
    if (this.paused) return { ok: false, error: "Game is paused" };
    if (!this.nightPendingActors.has(playerId)) return { ok: false, error: "Not your turn" };
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: "Unknown player" };
    // Snapshot the prompt reference before applying — if applyNightAction
    // replaces it with a new prompt object (e.g. PI's "look at one more"
    // continuation), the player still owes another decision and we must
    // keep them in nightPendingActors.
    const promptBefore = player.prompt;
    const result = applyNightAction(this, player, action);
    if (!result.ok) return result;
    if (player.prompt && player.prompt !== promptBefore) {
      // Multi-step action: keep them pending with the new prompt.
    } else {
      this.nightPendingActors.delete(playerId);
      player.prompt = undefined;
    }
    // Intro: short-circuit when every pending human has flipped. There's no
    // info leak here — the narrator's whole point is "wait for everyone".
    if (this.nightStep === "intro" && this.nightPendingActors.size === 0) {
      if (this.nightStepTimer) {
        clearTimeout(this.nightStepTimer);
        this.nightStepTimer = undefined;
      }
      this.endNightStep();
      this.broadcast();
    }
    return { ok: true };
  }

  // ---- Day ----

  beginDay() {
    this.phase = "day";
    this.nightStep = undefined;
    const mult = Math.max(1, this.devSpeedMultiplier);
    const dayMs = (this.daySeconds * 1000) / mult;
    this.dayEndsAt = Date.now() + dayMs;
    this.players.forEach((p) => {
      // Bots auto-ready every day so the "X/Y ready" counter is accurate
      // and the host doesn't have to click anything to roll the day along.
      // The completion check already filters bots out, so this is purely
      // cosmetic — but the cosmetic gap was confusing in testing.
      p.ready = !!p.bot;
      p.vote = null;
      p.prompt = undefined;
    });
    if (this.dayTimer) clearTimeout(this.dayTimer);
    this.dayTimer = setTimeout(
      () => {
        this.beginVote();
        this.broadcast();
      },
      dayMs + 100,
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
    const blockers = this.players.filter((q) => q.connected && !q.spectating && !q.bot);
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
    // 20s vote countdown. When it expires, any unvoted blocker is treated
    // as no_kill and the round resolves. Speed multiplier scales it for
    // dev testing.
    const mult = Math.max(1, this.devSpeedMultiplier);
    const voteMs = (VOTE_SECONDS * 1000) / mult;
    this.voteEndsAt = Date.now() + voteMs;
    if (this.voteTimer) clearTimeout(this.voteTimer);
    this.voteTimer = setTimeout(() => {
      this.forceResolveVote();
      this.broadcast();
    }, voteMs + 100);
  }

  // Called by the vote timer when time's up. Stamps no_kill on anyone who
  // hasn't voted (active, connected, non-bot — bots' votes default null and
  // are filtered out of the tally anyway), then resolves.
  private forceResolveVote() {
    if (this.phase !== "vote") return;
    for (const p of this.players) {
      if (p.spectating) continue;
      if (p.bot) continue;
      if (p.vote == null) p.vote = "no_kill";
    }
    this.resolveAndReveal();
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
    const blockers = this.players.filter((q) => q.connected && !q.spectating && !q.bot);
    if (blockers.length > 0 && blockers.every((q) => q.vote != null)) {
      this.resolveAndReveal();
    }
    return { ok: true };
  }

  resolveAndReveal() {
    if (this.voteTimer) {
      clearTimeout(this.voteTimer);
      this.voteTimer = undefined;
    }
    this.voteEndsAt = undefined;
    const { killedIds, winners } = resolveVotes(this);
    this.killedIds = killedIds;
    this.winners = winners;
    this.phase = "reveal";
  }

  // ---- Public state ----
  // Data-shaping for socket broadcasts lives in room-view.ts so the Room
  // class stays focused on game state + transitions.

  toPublicRoom(): PublicRoom {
    return toPublicRoom(this);
  }

  privateViewFor(playerId: string): PrivateView {
    return privateViewFor(this, playerId);
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

  // ---- Lobby deck auto-adjust ----

  // Keeps selectedRoles.length aligned with active-player-count + 3 as people
  // join, leave, or toggle spectator. Roles are added/removed from the
  // PRIORITY_LIST (Werewolf is the always-on seed; Doppelganger, Masons, and
  // anything else the user manually toggled lives outside this auto-managed
  // pool). With removeCardLimit on, we only ever grow (never shrink past
  // existing manual oversize). Lobby-only — never touches an active deal.
  autoAdjustDeck() {
    if (this.phase !== "lobby") return;
    const activeCount = this.players.filter((p) => !p.spectating).length;
    // Alpha Wolf in the deck bumps the target by +1 (extra centre slot).
    const target = deckTargetSize(activeCount, this.selectedRoles);
    let safety = 32;
    while (this.selectedRoles.length < target && safety-- > 0) {
      const role = pickNextPriorityToAdd(this.selectedRoles, {
        wolfCap: this.wolfCap,
      });
      if (!role) break;
      this.selectedRoles.push(role);
    }
    if (this.removeCardLimit) return;
    safety = 32;
    while (this.selectedRoles.length > target && safety-- > 0) {
      const idx = pickNextPriorityToRemoveIdx(this.selectedRoles);
      if (idx < 0) break;
      this.selectedRoles.splice(idx, 1);
    }
  }

  // ---- Internal helpers used by night.ts ----

  currentRoleOf(playerId: string): Role {
    const p = this.players.find((p) => p.id === playerId);
    return this.currentRoles.get(playerId) ?? (p?.originalRole as Role);
  }

  // The role this player is on the team of for win-condition / hunter-chain
  // purposes. For everyone except the Doppelganger this equals currentRoleOf
  // — your team is determined by the card you're physically holding. The
  // Doppelganger is the exception: their team locks in the moment they view
  // a card and doesn't change even if their physical card is later swapped
  // away. Use this for vote/win logic; use currentRoleOf for physical-card
  // checks (Seer view, Insomniac self-look, swap targets).
  effectiveRoleOf(playerId: string): Role {
    const p = this.players.find((p) => p.id === playerId);
    if (p?.originalRole === "doppelganger" && p.doppelgangerCopied) {
      return p.doppelgangerCopied;
    }
    // Daybreak — Paranormal Investigator's team locks to the role they
    // viewed when it's non-villager-team (Werewolf / Minion / Tanner). Their
    // physical card stays "paranormal_investigator" but win logic uses the
    // locked role.
    if (p?.originalRole === "paranormal_investigator" && p.piTeamRole) {
      return p.piTeamRole;
    }
    return this.currentRoleOf(playerId);
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

  setPlayerColor(playerId: string, color: string): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Can only change color in the lobby" };
    if (!(PLAYER_COLOR_IDS as readonly string[]).includes(color)) {
      return { ok: false, error: "Unknown color" };
    }
    const p = this.players.find((p) => p.id === playerId);
    if (!p) return { ok: false, error: "Unknown player" };
    if (p.spectating) return { ok: false, error: "Spectators don't have a color" };
    // Uniqueness only enforced among active players — spectator records may
    // still hold stale colors from a previous opt-in.
    if (
      this.players.some(
        (q) => q.id !== playerId && !q.spectating && q.color === color,
      )
    ) {
      return { ok: false, error: "That color is already taken" };
    }
    p.color = color;
    return { ok: true };
  }

  setSpectatorsMuted(hostId: string, muted: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    this.spectatorsMuted = muted;
    return { ok: true };
  }

  setSpectatorsAutoLock(hostId: string, autoLock: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    this.spectatorsAutoLock = autoLock;
    return { ok: true };
  }

  setMutedExceptHost(hostId: string, muted: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    this.mutedExceptHost = muted;
    return { ok: true };
  }

  setSpectatorsBlind(hostId: string, blind: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    this.spectatorsBlind = blind;
    return { ok: true };
  }

  setRemoveCardLimit(hostId: string, remove: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    if (this.phase !== "lobby") {
      return { ok: false, error: "Only configurable in the lobby" };
    }
    this.removeCardLimit = remove;
    return { ok: true };
  }

  // Toggle the Daybreak expansion. Disabling it strips Daybreak roles out of
  // the current deck so the room stays valid; the auto-adjuster then tops up
  // with base-priority roles if there's room.
  setDaybreakEnabled(hostId: string, enabled: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    if (this.phase !== "lobby") {
      return { ok: false, error: "Only configurable in the lobby" };
    }
    this.daybreakEnabled = enabled;
    if (!enabled) {
      this.selectedRoles = this.selectedRoles.filter(
        (r) => !DAYBREAK_ROLES.includes(r),
      );
      this.autoAdjustDeck();
    }
    return { ok: true };
  }

  // Host adjusts the maximum total wolves (Werewolf + Alpha/Mystic/Dream).
  // Clamped to 1..5; any current excess wolves are trimmed from the right.
  setWolfCap(hostId: string, cap: number): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    if (this.phase !== "lobby") {
      return { ok: false, error: "Only configurable in the lobby" };
    }
    const next = Math.max(1, Math.min(5, Math.floor(cap)));
    this.wolfCap = next;
    // Trim excess wolves if the new cap is lower than the current count.
    let wolfCount = this.selectedRoles.filter((r) => WOLF_ROLES.includes(r)).length;
    while (wolfCount > next) {
      const idx = lastIndexOfAny(this.selectedRoles, WOLF_ROLES);
      if (idx < 0) break;
      // Never strip the seed Werewolf at index 0 — keep at least one Werewolf
      // unless the host explicitly set cap to 0 (which we don't allow anyway).
      if (this.selectedRoles[idx] === "werewolf" && wolfCount === 1) break;
      this.selectedRoles.splice(idx, 1);
      wolfCount--;
    }
    this.autoAdjustDeck();
    return { ok: true };
  }

  // ---- Dev mode (host-only, gated by devMode) ----

  setDevMode(hostId: string, enabled: boolean): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    this.devMode = enabled;
    if (!enabled) this.devSpeedMultiplier = 1;
    return { ok: true };
  }

  setDevSpeed(hostId: string, multiplier: number): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    this.devSpeedMultiplier = Math.max(1, Math.min(20, Math.floor(multiplier)));
    return { ok: true };
  }

  addBots(hostId: string, count: number, spectating: boolean): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    if (this.phase !== "lobby") return { ok: false, error: "Add bots in the lobby only" };
    const n = Math.max(1, Math.min(10, Math.floor(count)));
    const startN = this.players.filter((p) => p.bot).length + 1;
    for (let i = 0; i < n; i++) {
      // Cap at 10 each side just like real joins.
      const activeCount = this.players.filter((p) => !p.spectating).length;
      const spectatorCount = this.players.filter((p) => p.spectating).length;
      if (spectating && spectatorCount >= 10) break;
      if (!spectating && activeCount >= 10) break;
      const name = `Bot ${startN + i}`;
      const player = this.addPlayer(name, "", { spectating });
      player.bot = true;
      // Bots are always ready so they never block the host pressing Start.
      if (!spectating) player.lobbyReady = true;
    }
    return { ok: true };
  }

  clearBots(hostId: string): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    if (this.phase !== "lobby") return { ok: false, error: "Clear bots in the lobby only" };
    const removedActive = this.players.some((p) => p.bot && !p.spectating);
    this.players = this.players.filter((p) => !p.bot);
    if (removedActive) this.autoAdjustDeck();
    return { ok: true };
  }

  forceStart(hostId: string, manualRoles?: Record<string, Role>): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    return this.startGame({ skipReadyCheck: true, manualRoles });
  }

  skipNightStep(hostId: string): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    if (this.phase !== "night") return { ok: false, error: "Not in night" };
    if (this.nightStepTimer) {
      clearTimeout(this.nightStepTimer);
      this.nightStepTimer = undefined;
    }
    this.endNightStep();
    return { ok: true };
  }

  skipToPhase(hostId: string, target: Phase): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    if (target === "lobby") return { ok: false, error: "Use Reset to go back to lobby" };
    const order = { lobby: 0, night: 1, day: 2, vote: 3, reveal: 4 } as const;
    if (order[this.phase] >= order[target]) {
      return { ok: false, error: "Target phase is at or before the current phase" };
    }
    // Safety cap — advance one phase at a time.
    let steps = 8;
    while (this.phase !== target && order[this.phase] < order[target] && steps-- > 0) {
      if (this.phase === "night") {
        // Burn through every remaining night step, applying defaults.
        let nightSteps = 20;
        while (this.nightStep && nightSteps-- > 0) {
          if (this.nightStepTimer) {
            clearTimeout(this.nightStepTimer);
            this.nightStepTimer = undefined;
          }
          this.endNightStep();
          // endNightStep transitions to day when steps run out — break to
          // re-check the outer condition.
          if (this.phase !== "night") break;
        }
      } else if (this.phase === "day") {
        if (this.dayTimer) {
          clearTimeout(this.dayTimer);
          this.dayTimer = undefined;
        }
        this.beginVote();
      } else if (this.phase === "vote") {
        // Set everyone who hasn't voted to no_kill so resolve has a vote map.
        for (const p of this.players) {
          if (!p.spectating && p.vote == null) p.vote = "no_kill";
        }
        this.resolveAndReveal();
      }
    }
    return { ok: true };
  }

  forceBotVotes(
    hostId: string,
    opts: { mode: "target" | "random" | "matchMe"; targetId?: string },
  ): ActionResult {
    const r = this.requireDev(hostId);
    if (!r.ok) return r;
    if (this.phase !== "vote") return { ok: false, error: "Only in vote phase" };

    // Build the random pool once — every active (non-spectator) player ID
    // plus "no_kill". Bots and the host are valid targets too.
    const randomPool: string[] = ["no_kill"];
    for (const p of this.players) {
      if (!p.spectating) randomPool.push(p.id);
    }

    let fixedTarget: string | null = null;
    if (opts.mode === "target") {
      if (typeof opts.targetId !== "string") {
        return { ok: false, error: "Target required" };
      }
      if (opts.targetId !== "no_kill" && !this.hasPlayer(opts.targetId)) {
        return { ok: false, error: "Unknown target" };
      }
      fixedTarget = opts.targetId;
    } else if (opts.mode === "matchMe") {
      const host = this.players.find((q) => q.id === hostId);
      fixedTarget = host?.vote ?? "no_kill";
    }

    for (const p of this.players) {
      if (!p.bot || p.spectating) continue;
      p.vote =
        opts.mode === "random"
          ? randomPool[Math.floor(Math.random() * randomPool.length)]
          : (fixedTarget as string);
    }
    // Try to resolve if every non-bot blocker has voted.
    const blockers = this.players.filter(
      (q) => q.connected && !q.spectating && !q.bot,
    );
    if (blockers.length === 0 || blockers.every((q) => q.vote != null)) {
      this.resolveAndReveal();
    }
    return { ok: true };
  }

  private requireDev(hostId: string): ActionResult {
    if (this.hostId !== hostId) return { ok: false, error: "Only the host can do that" };
    if (!this.devMode) return { ok: false, error: "Dev mode isn't enabled" };
    return { ok: true };
  }

  // Append a chat message from a player. Validates phase + text. Trims and
  // caps length; the message log is also capped at MAX_CHAT_MESSAGES so a
  // long-running lobby doesn't accumulate forever.
  addChatMessage(playerId: string, text: string): ActionResult {
    if (this.phase !== "lobby") return { ok: false, error: "Chat is lobby-only" };
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: "Unknown player" };
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return { ok: false, error: "Empty message" };
    const msg: ChatMessage = {
      id: newId(),
      fromId: playerId,
      fromName: player.name,
      text: trimmed,
      ts: Date.now(),
    };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > MAX_CHAT_MESSAGES) {
      this.chatMessages.splice(0, this.chatMessages.length - MAX_CHAT_MESSAGES);
    }
    return { ok: true };
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
      if (this.voteEndsAt && this.voteTimer) {
        this.pausedVoteRemainingMs = Math.max(0, this.voteEndsAt - Date.now());
        clearTimeout(this.voteTimer);
        this.voteTimer = undefined;
        this.voteEndsAt = undefined;
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
      if (this.pausedVoteRemainingMs != null) {
        const ms = this.pausedVoteRemainingMs;
        this.voteEndsAt = Date.now() + ms;
        this.voteTimer = setTimeout(() => {
          this.forceResolveVote();
          this.broadcast();
        }, ms + 100);
        this.pausedVoteRemainingMs = undefined;
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
      // Hand them a fresh color now that they're displayed in the active list.
      if (!p.color) p.color = this.pickFreeColor();
      // Active player count went up — grow the deck via the priority list.
      this.autoAdjustDeck();
      return { ok: true };
    }

    // Becoming a spectator: cap the spectator list at 10 too.
    const spectatorCount = this.players.filter((q) => q.spectating && q.id !== playerId).length;
    if (spectatorCount >= 10) {
      return { ok: false, error: "Spectator list is full (10 max)" };
    }
    // Free up their color so another active player can claim it.
    p.color = undefined;

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
      const totalWolves = this.players.filter((q) => isAnyWolf(q)).length;
      const isLoneWolf = totalWolves === 1;
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
      const blockers = this.players.filter((q) => q.connected && !q.spectating && !q.bot);
      if (blockers.length > 0 && blockers.every((q) => q.ready)) {
        this.beginVote();
      }
    }
    // Vote: re-check completion. Spectators don't vote at all — they're
    // skipped entirely from the resolve check.
    if (this.phase === "vote") {
      const blockers = this.players.filter((q) => q.connected && !q.spectating && !q.bot);
      if (blockers.length > 0 && blockers.every((q) => q.vote != null)) {
        this.resolveAndReveal();
      }
    }
    // Clear any accusations they made — spectators shouldn't keep asserting things.
    this.accusations = this.accusations.filter((a) => a.accuserId !== playerId);
    // Active player count went down — shrink the deck via the priority list
    // (lobby only; mid-game we leave the dealt deck alone).
    if (this.phase === "lobby") this.autoAdjustDeck();
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

  // Public-lobby browser snapshot. Returns lightweight metadata for every
  // non-private room currently in the lobby phase — once a game starts it
  // disappears from the list.
  listPublic(): Array<{
    code: string;
    roomName?: string;
    hostName: string;
    playerCount: number;
    spectatorCount: number;
  }> {
    const out: Array<{
      code: string;
      roomName?: string;
      hostName: string;
      playerCount: number;
      spectatorCount: number;
    }> = [];
    for (const room of this.byCode.values()) {
      if (room.privateRoom) continue;
      if (room.phase !== "lobby") continue;
      const host = room.hostId ? room.players.find((p) => p.id === room.hostId) : null;
      out.push({
        code: room.joinCode,
        roomName: room.roomName,
        hostName: host?.name ?? "?",
        playerCount: room.players.filter((p) => !p.spectating).length,
        spectatorCount: room.players.filter((p) => p.spectating).length,
      });
    }
    // Most recently created (likely most active) first — `byCode` insertion
    // order tracks creation, so reverse for newest-first.
    return out.reverse();
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

// True if this player is any kind of wolf (Werewolf / Alpha / Mystic / Dream)
// either directly or via a Doppelganger copy. Used by endNightStep's lone-
// wolf-peek heuristic so a Dream Wolf in play cancels lone status even
// though they never wake.
function isAnyWolf(p: ServerPlayer): boolean {
  if (!p.originalRole) return false;
  const wolfRoles: Role[] = ["werewolf", "alpha_wolf", "mystic_wolf", "dream_wolf"];
  if (wolfRoles.includes(p.originalRole)) return true;
  if (p.originalRole === "doppelganger" && p.doppelgangerCopied) {
    return wolfRoles.includes(p.doppelgangerCopied);
  }
  return false;
}

// Awake wolves (Werewolf / Alpha Wolf / Mystic Wolf or DG copies of them).
// Dream Wolves are wolves but don't wake — excluded here.
function isAwakeWolfP(p: ServerPlayer): boolean {
  if (!p.originalRole) return false;
  const awake: Role[] = ["werewolf", "alpha_wolf", "mystic_wolf"];
  if (awake.includes(p.originalRole)) return true;
  if (p.originalRole === "doppelganger" && p.doppelgangerCopied) {
    return awake.includes(p.doppelgangerCopied);
  }
  return false;
}

// True if this player is a Doppelganger who copied one of the roles that
// act inside the doppelganger_act step.
function isDgActActor(p: ServerPlayer): boolean {
  if (p.originalRole !== "doppelganger" || !p.doppelgangerCopied) return false;
  const dgActSet: Role[] = [
    "seer", "robber", "troublemaker", "drunk",
    "sentinel", "alpha_wolf", "mystic_wolf",
    "apprentice_seer", "paranormal_investigator",
    "witch", "village_idiot",
  ];
  return dgActSet.includes(p.doppelgangerCopied);
}

// Last index in `arr` whose value is one of `needles`. Used by setWolfCap to
// trim a wolf-team role from the rightmost position when the cap shrinks.
function lastIndexOfAny<T>(arr: T[], needles: T[]): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (needles.includes(arr[i])) return i;
  }
  return -1;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
