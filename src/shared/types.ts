// Shared types between client and server.
// IMPORTANT: never include another player's hidden role here unless the
// game logic has explicitly revealed it.

export type Role =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "hunter"
  | "tanner"
  | "villager";

export type Phase = "lobby" | "night" | "day" | "vote" | "reveal";

export interface PublicPlayer {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  // Bot players are added by the host via the dev panel for solo testing.
  // They have no socket; the server auto-defaults their night actions and
  // excludes them from ready/vote completion checks.
  bot?: boolean;
  // Player chose "Back to lobby" during an active game. Their card stays in
  // play (deck size is fixed at deal time), but they no longer act, vote, or
  // hold up phase advancement. Resets at game start / reset to lobby.
  spectating?: boolean;
  // Host force-set this player to spectator. The player can't return to
  // active on their own — only the host can release them. Implies spectating.
  forcedSpectating?: boolean;
  // True once this player has granted mic access and is ready to negotiate
  // peer connections. Other clients only initiate WebRTC offers to peers
  // whose hasMic is true; this avoids racing with mic-permission flow.
  hasMic?: boolean;
  // The player's display color id (one of PLAYER_COLOR_IDS). The actual
  // Tailwind classes live client-side in playerColor.ts so the palette can
  // be tuned without server changes.
  color?: string;
  // Reveal-only:
  originalRole?: Role;
  finalRole?: Role;
  // Role this player is on the team of at win time. Equals finalRole for
  // everyone except the Doppelganger, whose team locks in to the copied role
  // even if their physical card later changes. Used client-side to compute
  // per-player win banners.
  effectiveRole?: Role;
  votedFor?: string | null; // player id or "no_kill"
  killed?: boolean;
}

export interface PublicRoom {
  code: string;
  // Optional friendly name set by the host at create time. Shown in the
  // public lobby browser and in the room header alongside the code.
  name?: string;
  phase: Phase;
  // Server epoch ms at the moment this state was emitted. Clients use this to
  // compute a server-client clock offset so countdown timers don't drift if
  // the client's clock is skewed.
  serverNow: number;
  // Set when the host has muted all spectators. Spectator canSpeak is gated
  // by this flag in every phase.
  spectatorsMuted?: boolean;
  // Set when the host marks the room as private. Private rooms don't appear
  // in the public lobby browser.
  privateRoom?: boolean;
  // Set when new joiners should be force-locked to spectator on arrival.
  // Lets the host gate who can join the active player list.
  spectatorsAutoLock?: boolean;
  // Dev-mode flag — gates all dev:* server actions. Toggled by the host
  // from the 5-click DevPanel.
  devMode?: boolean;
  // Multiplier applied to upcoming night-step and day-phase durations.
  // 1 = normal. Higher = faster. Only effective when devMode is true.
  devSpeedMultiplier?: number;
  // Recent lobby chat messages (capped). Only present in the lobby phase
  // — cleared at game start.
  chatMessages?: ChatMessage[];
  // Set when the host has hit "Mute all" — every non-host mic is gated off
  // so the host can make announcements without interruption.
  mutedExceptHost?: boolean;
  // Set when the host has hidden the game state from spectators. Spectators
  // see only the public room data (player names, ready/vote status,
  // accusations) — no current roles, no notes, no centre cards. Used to
  // stop spectators from leaking info to nearby players.
  spectatorsBlind?: boolean;
  players: PublicPlayer[];
  // Lobby:
  selectedRoles: Role[]; // multiset; default length must equal active players + 3
  // Host has lifted the deck-size cap. With the limit removed, the deck can
  // exceed the active-player + 3 default — extras land in the centre at deal
  // time, so fewer-player games can still draw from a larger pool.
  removeCardLimit?: boolean;
  // Number of cards in the centre once the round begins. 3 by default, or
  // more when removeCardLimit was on at start.
  centerCardCount?: number;
  // IDs of non-host players who pressed Ready in the lobby. Host can't start
  // until everyone else here is checked off.
  lobbyReadyIds?: string[];
  // Host paused the round. Phase timers freeze and player actions are
  // rejected until the host resumes. Only meaningful in night/day/vote.
  paused?: boolean;
  // Reveal-only chronological log of every night action and the vote outcome.
  actionLog?: ActionLogEntry[];
  // Night:
  nightStep?: NightStep;
  nightStepEndsAt?: number; // epoch ms — fixed duration regardless of who's acting
  // Filenames under /voice/<pack>/ to play in sequence at the start of this
  // step (e.g. ["Werewolves.mp3"]). For dynamic steps like doppelganger_act
  // the server assembles multiple clips so the narrator can name only the
  // roles in play this round. Each player resolves their own pack from local
  // preference so different players hear different narrators.
  nightStepVoiceFiles?: string[];
  // Day:
  dayEndsAt?: number; // epoch ms
  daySeconds?: number; // configured length
  // Vote phase has a fixed 20s countdown that auto-resolves with no_kill for
  // anyone who hasn't voted.
  voteEndsAt?: number;
  readyPlayerIds?: string[];
  // Public accusations made during the day. Each accuser can hold at most
  // one active accusation, replacing any previous one.
  accusations?: Accusation[];
  // Reveal:
  centerCards?: Role[]; // [left, middle, right]
  winners?: WinnerSide[];
}

export type WinnerSide = "werewolf" | "villager" | "tanner" | "minion" | "hunter_target";

export interface Accusation {
  accuserId: string;
  targetId: string;
  role: Role;
}

// Chronological log of what happened during the night and at vote time.
// Revealed to all players at the reveal phase so the table can reconstruct
// the night. Player IDs are resolved to names client-side.
export type ActionLogEntry =
  | { kind: "doppelganger_copied"; actorId: string; targetId: string; copiedRole: Role }
  | { kind: "werewolves_revealed"; actorIds: string[] }
  | { kind: "lone_wolf_peeked"; actorId: string; centerIndex: number; role: Role }
  | { kind: "lone_wolf_skipped"; actorId: string }
  | { kind: "minion_saw_werewolves"; actorId: string; werewolfIds: string[] }
  | { kind: "masons_revealed"; actorIds: string[] }
  | { kind: "lone_mason"; actorId: string }
  | { kind: "seer_saw_player"; actorId: string; targetId: string; role: Role }
  | { kind: "seer_saw_center"; actorId: string; cards: Array<{ index: number; role: Role }> }
  | { kind: "seer_skipped"; actorId: string }
  // newRole = role the actor now holds (target's old role).
  // targetNewRole = role the target now holds (always the actor's old role,
  // which is just "robber" unless a Doppelganger-as-Robber acted).
  | {
      kind: "robber_swapped";
      actorId: string;
      targetId: string;
      newRole: Role;
      targetNewRole: Role;
    }
  | { kind: "robber_skipped"; actorId: string }
  // newRoles is the post-swap pair, aligned with targetIds (newRoles[i] is
  // the role targetIds[i] now holds). The Troublemaker doesn't see these
  // during the night — they're surfaced in the reveal log for the table.
  | {
      kind: "troublemaker_swapped";
      actorId: string;
      targetIds: [string, string];
      newRoles: [Role, Role];
    }
  | { kind: "troublemaker_skipped"; actorId: string }
  | { kind: "drunk_swapped"; actorId: string; centerIndex: number }
  | { kind: "insomniac_saw"; actorId: string; role: Role }
  | { kind: "vote"; voterId: string; targetId: string | "no_kill" }
  | { kind: "killed"; targetId: string; via: "vote" | "hunter" }
  | { kind: "no_one_died" };

// Which role is currently acting in the night phase.
// "intro" plays "Everyone close your eyes"; "outro" plays "Everyone wake up".
// Both are no-action steps that exist only to play their audio.
// "doppelganger" runs first per the rulebook — picks a player and copies them.
// "doppelganger_act" runs immediately after so a Doppelganger who copied a
// Seer/Robber/Troublemaker/Drunk can take that role's action right away,
// before the real holder of that role wakes. Skipped if no DG is in play, or
// if none of those four active roles are in the deck.
// Order otherwise matches the rulebook for the base game.
export type NightStep =
  | "intro"
  | "doppelganger"
  | "doppelganger_act"
  | "werewolves"
  | "minion"
  | "masons"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "outro";

export const NIGHT_ORDER: NightStep[] = [
  "intro",
  "doppelganger",
  "doppelganger_act",
  "werewolves",
  "minion",
  "masons",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "outro",
];

// Per-player private view.
export interface PrivateView {
  myId: string;
  myOriginalRole?: Role;
  // Updated after Robber swap or any role that newly reveals own card.
  myKnownCurrentRole?: Role;
  // True if the player's card is now face-down to them (Drunk after swap):
  // they took a center card without looking, so they don't know what they hold.
  cardFaceDown?: boolean;
  // Memory of what this player saw during the night.
  notes: NightNote[];
  // Free-form notes the player typed themselves (private to them).
  userNotes: string[];
  // The current night prompt for this player (if any).
  prompt?: NightPrompt;
  // Only populated when this player is a spectator — gives them full visibility
  // into every active player's current role and personal notes, refreshed on
  // every broadcast. Active players never receive this field.
  spectatorVision?: SpectatorVision;
  // Populated only for the host when room.devMode is on. Carries live role
  // assignments, centre cards, and the running action log so the dev panel
  // can show god-mode info.
  devVision?: DevVision;
}

// Live snapshot of the table that spectators see. Updates with every
// broadcast so role swaps (Robber, Troublemaker, Drunk) appear in real time.
export interface SpectatorVision {
  players: Array<{
    id: string;
    currentRole: Role;
    originalRole: Role;
    notes: NightNote[];
    userNotes: string[];
  }>;
  centerCards: Role[];
}

// God-mode view for the host when dev mode is on. Same shape as
// SpectatorVision plus the live action log so the host can verify what
// bots and other roles actually did during the round.
export interface DevVision {
  players: Array<{
    id: string;
    currentRole: Role;
    originalRole: Role;
    notes: NightNote[];
    userNotes: string[];
    bot?: boolean;
  }>;
  centerCards: Role[];
  actionLog: ActionLogEntry[];
}

export type NightNote =
  // Pushed at deal time so each player has a record of the card they were
  // originally given. Surfaces in the notes panel from the moment the round
  // starts, so once the card flips face-down they can still see what they were
  // dealt.
  | { kind: "starting_role"; role: Role }
  | { kind: "doppelganger_copied"; targetId: string; role: Role }
  | { kind: "fellow_werewolves"; playerIds: string[] }
  | { kind: "lone_wolf_center"; index: number; role: Role }
  | { kind: "minion_sees_werewolves"; playerIds: string[] }
  | { kind: "fellow_mason"; playerIds: string[] }
  | { kind: "no_other_masons" }
  | { kind: "seer_player"; playerId: string; role: Role }
  | { kind: "seer_center"; cards: Array<{ index: number; role: Role }> }
  | { kind: "robber_new_role"; targetId: string; role: Role }
  // Troublemaker doesn't see what the swapped roles are; the note is just a
  // record of which two players' cards they swapped, so they can reference
  // it during the day.
  | { kind: "troublemaker_swapped"; targetIds: [string, string] }
  // Drunk took a centre card without looking. We record which centre slot
  // so they can reference it during the day — they still don't know what
  // they actually hold.
  | { kind: "drunk_swapped"; centerIndex: number }
  | { kind: "insomniac_self"; role: Role };

// Action prompts sent to a single player during the night.
export type NightPrompt =
  | { kind: "doppelganger_choose"; message: string; eligiblePlayerIds: string[] }
  | {
      kind: "werewolf_lone";
      message: string; // "You are the lone wolf. Optionally view one center card."
    }
  | { kind: "seer_choose"; message: string }
  | { kind: "robber_choose"; message: string; eligiblePlayerIds: string[] }
  | { kind: "troublemaker_choose"; message: string; eligiblePlayerIds: string[] }
  | { kind: "drunk_choose"; message: string }
  | { kind: "ack"; message: string }; // No choice — just confirm "got it".

// Action submissions from a single player.
export type NightAction =
  | { kind: "ack" } // For roles with no choice (Werewolf seeing pack, Minion, Mason, Insomniac).
  | { kind: "doppelganger_copy"; targetId: string }
  | { kind: "werewolf_lone_view"; centerIndex: number | null } // null = skip
  | { kind: "seer_view_player"; targetId: string }
  | { kind: "seer_view_center"; indices: [number, number] }
  | { kind: "seer_skip" }
  | { kind: "robber_swap"; targetId: string | null } // null = skip
  | { kind: "troublemaker_swap"; targetIds: [string, string] | null }
  | { kind: "drunk_swap"; centerIndex: number };

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
}

// ---- Wire protocol ----

// Structural mirrors of DOM WebRTC types so the wire protocol can be referenced
// from server code (which doesn't have DOM lib loaded).
export interface SignalingDescription {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp?: string;
}
export interface SignalingIceCandidate {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface ServerToClient {
  "room:state": (room: PublicRoom) => void;
  "you:state": (view: PrivateView) => void;
  "error": (payload: { message: string }) => void;
  // Lightweight notification of room joining success — gives the client its id.
  "joined": (payload: { roomCode: string; playerId: string; name: string }) => void;
  // Sent to a player who was kicked by the host. The client clears its
  // session and returns to the home screen.
  "kicked": (payload: { reason: string }) => void;
  // WebRTC signaling forwarded to this client. `from` is the sender's playerId.
  "webrtc:offer": (payload: { from: string; sdp: SignalingDescription }) => void;
  "webrtc:answer": (payload: { from: string; sdp: SignalingDescription }) => void;
  "webrtc:ice": (payload: { from: string; candidate: SignalingIceCandidate }) => void;
  // Server-fanned announcement that every connected client plays as a
  // narrator clip (in their preferred pack, bill fallback).
  "room:announce": (payload: { kind: "readyCheck" }) => void;
}

export interface ClientToServer {
  "room:create": (
    payload: { name: string; private?: boolean; roomName?: string },
    cb: (res: { ok: true; code: string; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  // Lightweight metadata listing for the public lobby browser. Server filters
  // out private rooms and rooms not in the lobby phase before returning.
  "rooms:listPublic": (
    cb: (res: {
      rooms: Array<{
        code: string;
        roomName?: string;
        hostName: string;
        playerCount: number;
        spectatorCount: number;
      }>;
    }) => void,
  ) => void;
  // Lobby-only chat. Server validates length + phase, appends to room.
  "lobby:chat:send": (payload: { text: string }) => void;
  "note:add": (payload: { text: string }) => void;
  "note:remove": (payload: { index: number }) => void;
  "room:join": (
    payload: { name: string; code: string; resumePlayerId?: string },
    cb: (res: { ok: true; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  "room:leave": () => void;
  // Toggle this player's spectating status. In lobby phase, both directions
  // work (player picks whether to play or watch). Mid-game, only true is
  // honoured — once the deck is dealt, you can step out but you can't step in.
  "room:spectate": (payload: { spectating: boolean }) => void;
  "lobby:setRoles": (payload: { roles: Role[] }) => void;
  "lobby:setDaySeconds": (payload: { seconds: number }) => void;
  // Pick a color from PLAYER_COLOR_IDS. Server rejects if the color is
  // already used by another player in the room.
  "lobby:setColor": (payload: { color: string }) => void;
  // Host toggles the "deck can exceed players + 3" allowance.
  "lobby:setRemoveCardLimit": (payload: { remove: boolean }) => void;
  "lobby:ready": (payload: { ready: boolean }) => void;
  "lobby:kick": (payload: { playerId: string }) => void;
  // Host force-spectates a player (spectating=true) or releases them
  // (spectating=false, lifting the lock).
  "lobby:forceSpectate": (payload: { playerId: string; spectating: boolean }) => void;
  // Host hands the host role to another player. Old host becomes regular.
  "lobby:promoteHost": (payload: { playerId: string }) => void;
  // Host toggles a global mute flag for all spectators. Affects all phases.
  "lobby:muteSpectators": (payload: { muted: boolean }) => void;
  // Host toggles whether new joiners arrive force-spectated.
  "lobby:setSpectatorsAutoLock": (payload: { autoLock: boolean }) => void;
  // Host toggles "mute everyone except me" for announcement mode.
  "lobby:muteAllExceptHost": (payload: { muted: boolean }) => void;
  // Host toggles whether spectators see game state (cards, notes, centre).
  "lobby:setSpectatorsBlind": (payload: { blind: boolean }) => void;
  // Host fires a ready-check announcement — server fans out a room:announce
  // to every connected client, which plays the matching narrator clip.
  "lobby:announceReadyCheck": () => void;
  "lobby:start": () => void;
  "room:pause": (payload: { paused: boolean }) => void;
  "night:action": (payload: NightAction) => void;
  "day:ready": (payload: { ready: boolean }) => void;
  // role null clears this player's accusation against the given target. A
  // single accuser may hold accusations against multiple distinct targets;
  // re-accusing the same target with a new role replaces it.
  "day:accuse": (payload: { targetId: string; role: Role | null }) => void;
  "vote:cast": (payload: { targetId: string | "no_kill" }) => void;
  "room:reset": () => void;

  // Dev panel actions (host-only). The room must have devMode enabled
  // first via dev:setMode for the others to be honoured.
  "dev:setMode": (payload: { enabled: boolean }) => void;
  "dev:addBots": (payload: { count: number; spectating: boolean }) => void;
  "dev:clearBots": () => void;
  // manualRoles is { playerId: Role } overriding the random deal. The deck
  // (selectedRoles) is still the source for centre cards — anything not
  // explicitly assigned goes to the centre.
  "dev:forceStart": (payload: { manualRoles?: Record<string, Role> }) => void;
  "dev:skipNightStep": () => void;
  "dev:skipToPhase": (payload: { phase: Phase }) => void;
  "dev:setSpeed": (payload: { multiplier: number }) => void;
  // mode "target" needs targetId; "random" picks per-bot from active players
  // and no_kill; "matchMe" copies the caller's current vote (or no_kill).
  "dev:forceBotVotes": (payload: {
    mode: "target" | "random" | "matchMe";
    targetId?: string;
  }) => void;
  // Voice chat: client tells server when it has mic access (or has stopped).
  // Server marks the player and broadcasts so peers know to negotiate.
  "audio:setReady": (payload: { ready: boolean }) => void;
  // WebRTC signaling — relayed by the server from the sender to `target`.
  // The server adds a `from` field with the sender's playerId before forwarding.
  "webrtc:offer": (payload: { target: string; sdp: SignalingDescription }) => void;
  "webrtc:answer": (payload: { target: string; sdp: SignalingDescription }) => void;
  "webrtc:ice": (payload: { target: string; candidate: SignalingIceCandidate }) => void;
}

// ---- Role metadata helpers ----

export interface RoleMeta {
  role: Role;
  label: string;
  team: "werewolf" | "villager" | "tanner";
  description: string;
  maxCount: number; // how many copies allowed in the pool
}

export const ROLE_META: Record<Role, RoleMeta> = {
  doppelganger: {
    role: "doppelganger",
    label: "Doppelganger",
    team: "villager", // actual team depends on what they copy at night
    description:
      "First in the night, look at another player's card and become that role. You then act as that role on its turn.",
    maxCount: 1,
  },
  werewolf: {
    role: "werewolf",
    label: "Werewolf",
    team: "werewolf",
    description:
      "At night you see the other werewolf. If you are the only werewolf, you may peek at one center card.",
    maxCount: 2,
  },
  minion: {
    role: "minion",
    label: "Minion",
    team: "werewolf",
    description: "At night you see the werewolves; they do not see you. You win with the werewolves.",
    maxCount: 1,
  },
  mason: {
    role: "mason",
    label: "Mason",
    team: "villager",
    description: "At night you see the other Mason (if any).",
    maxCount: 2,
  },
  seer: {
    role: "seer",
    label: "Seer",
    team: "villager",
    description: "At night you may look at one other player's card OR two of the center cards.",
    maxCount: 1,
  },
  robber: {
    role: "robber",
    label: "Robber",
    team: "villager",
    description:
      "At night you may swap your card with another player's, then view your new card. You become that role.",
    maxCount: 1,
  },
  troublemaker: {
    role: "troublemaker",
    label: "Troublemaker",
    team: "villager",
    description: "At night you may swap two other players' cards without looking at them.",
    maxCount: 1,
  },
  drunk: {
    role: "drunk",
    label: "Drunk",
    team: "villager",
    description: "At night you must exchange your card with one of the center cards, without looking.",
    maxCount: 1,
  },
  insomniac: {
    role: "insomniac",
    label: "Insomniac",
    team: "villager",
    description: "At the end of the night you look at your own card (it may have changed).",
    maxCount: 1,
  },
  hunter: {
    role: "hunter",
    label: "Hunter",
    team: "villager",
    description: "If you are killed by the village vote, the player you voted for also dies.",
    maxCount: 1,
  },
  tanner: {
    role: "tanner",
    label: "Tanner",
    team: "tanner",
    description: "You hate yourself. You only win if you are killed by the village vote.",
    maxCount: 1,
  },
  villager: {
    role: "villager",
    label: "Villager",
    team: "villager",
    description: "No special ability. Talk it out and find the wolves.",
    maxCount: 3,
  },
};

export const ALL_ROLES: Role[] = Object.keys(ROLE_META) as Role[];

// Identifiers for the available player colors. The Tailwind classes that map
// to each id live in client/playerColor.ts so we don't pull DOM-specific
// strings into the server. Order is the auto-assignment preference order:
// new players get the first id not already taken in the room.
export const PLAYER_COLOR_IDS = [
  "sky",
  "fuchsia",
  "lime",
  "orange",
  "cyan",
  "violet",
  "pink",
  "yellow",
  "teal",
  "red",
] as const;
export type PlayerColorId = (typeof PLAYER_COLOR_IDS)[number];

// Voice packs available for the night narration. The id matches the folder
// under public/voice/. To add a pack, generate the audio (npm run voice:gen)
// and add the entry here.
export interface VoicePack {
  id: string;
  label: string;
  blurb: string;
  ttsVoiceId: string; // ElevenLabs voice id (used by scripts/generate-voice.ts)
}

export const VOICE_PACKS: VoicePack[] = [
  {
    id: "bill",
    label: "Bill",
    blurb: "Mature American storyteller",
    ttsVoiceId: "pqHfZKP75CvOlQylNhV4",
  },
  {
    id: "malthrog",
    label: "Malthrog the Beheader",
    blurb: "Menacing executioner",
    ttsVoiceId: "YndTyB92pean24jyJtY1",
  },
  {
    id: "faolan",
    label: "Faolan Celestecial",
    blurb: "Ancient ethereal narrator",
    ttsVoiceId: "YI260UNY323251S3MAGM",
  },
  {
    id: "harold",
    label: "Harold the Herald",
    blurb: "Custom voice",
    ttsVoiceId: "McnKFh1t3gMCN5xJl7NK",
  },
];

export const DEFAULT_VOICE_PACK = "bill";
