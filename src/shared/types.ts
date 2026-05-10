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
  // Player chose "Back to lobby" during an active game. Their card stays in
  // play (deck size is fixed at deal time), but they no longer act, vote, or
  // hold up phase advancement. Resets at game start / reset to lobby.
  spectating?: boolean;
  // Reveal-only:
  originalRole?: Role;
  finalRole?: Role;
  votedFor?: string | null; // player id or "no_kill"
  killed?: boolean;
}

export interface PublicRoom {
  code: string;
  phase: Phase;
  // Server epoch ms at the moment this state was emitted. Clients use this to
  // compute a server-client clock offset so countdown timers don't drift if
  // the client's clock is skewed.
  serverNow: number;
  players: PublicPlayer[];
  // Lobby:
  selectedRoles: Role[]; // multiset; length must equal players.length + 3
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
  // Filename under /voice/<pack>/ to play at the start of this step (e.g.
  // "Werewolves.mp3"). Each player resolves their own pack from local
  // preference so different players hear different narrators.
  nightStepVoiceFile?: string;
  // Day:
  dayEndsAt?: number; // epoch ms
  daySeconds?: number; // configured length
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
  | { kind: "lone_wolf_peeked"; actorId: string; centerIndex: 0 | 1 | 2; role: Role }
  | { kind: "lone_wolf_skipped"; actorId: string }
  | { kind: "minion_saw_werewolves"; actorId: string; werewolfIds: string[] }
  | { kind: "masons_revealed"; actorIds: string[] }
  | { kind: "lone_mason"; actorId: string }
  | { kind: "seer_saw_player"; actorId: string; targetId: string; role: Role }
  | { kind: "seer_saw_center"; actorId: string; cards: Array<{ index: 0 | 1 | 2; role: Role }> }
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
  | { kind: "drunk_swapped"; actorId: string; centerIndex: 0 | 1 | 2 }
  | { kind: "insomniac_saw"; actorId: string; role: Role }
  | { kind: "vote"; voterId: string; targetId: string | "no_kill" }
  | { kind: "killed"; targetId: string; via: "vote" | "hunter" }
  | { kind: "no_one_died" };

// Which role is currently acting in the night phase.
// "intro" plays "Everyone close your eyes"; "outro" plays "Everyone wake up".
// Both are no-action steps that exist only to play their audio.
// "doppelganger" runs first per the rulebook — picks a player and copies them.
// Order otherwise matches the rulebook for the base game.
export type NightStep =
  | "intro"
  | "doppelganger"
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
}

export type NightNote =
  | { kind: "doppelganger_copied"; targetId: string; role: Role }
  | { kind: "fellow_werewolves"; playerIds: string[] }
  | { kind: "lone_wolf_center"; index: 0 | 1 | 2; role: Role }
  | { kind: "minion_sees_werewolves"; playerIds: string[] }
  | { kind: "fellow_mason"; playerIds: string[] }
  | { kind: "no_other_masons" }
  | { kind: "seer_player"; playerId: string; role: Role }
  | { kind: "seer_center"; cards: Array<{ index: 0 | 1 | 2; role: Role }> }
  | { kind: "robber_new_role"; targetId: string; role: Role }
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
  | { kind: "werewolf_lone_view"; centerIndex: 0 | 1 | 2 | null } // null = skip
  | { kind: "seer_view_player"; targetId: string }
  | { kind: "seer_view_center"; indices: [0 | 1 | 2, 0 | 1 | 2] }
  | { kind: "seer_skip" }
  | { kind: "robber_swap"; targetId: string | null } // null = skip
  | { kind: "troublemaker_swap"; targetIds: [string, string] | null }
  | { kind: "drunk_swap"; centerIndex: 0 | 1 | 2 };

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  ts: number;
}

// ---- Wire protocol ----

export interface ServerToClient {
  "room:state": (room: PublicRoom) => void;
  "you:state": (view: PrivateView) => void;
  "error": (payload: { message: string }) => void;
  // Lightweight notification of room joining success — gives the client its id.
  "joined": (payload: { roomCode: string; playerId: string; name: string }) => void;
  // Sent to a player who was kicked by the host. The client clears its
  // session and returns to the home screen.
  "kicked": (payload: { reason: string }) => void;
}

export interface ClientToServer {
  "room:create": (
    payload: { name: string },
    cb: (res: { ok: true; code: string; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  "note:add": (payload: { text: string }) => void;
  "note:remove": (payload: { index: number }) => void;
  "room:join": (
    payload: { name: string; code: string; resumePlayerId?: string },
    cb: (res: { ok: true; playerId: string } | { ok: false; error: string }) => void,
  ) => void;
  "room:leave": () => void;
  "room:spectate": () => void;
  "lobby:setRoles": (payload: { roles: Role[] }) => void;
  "lobby:setDaySeconds": (payload: { seconds: number }) => void;
  "lobby:ready": (payload: { ready: boolean }) => void;
  "lobby:kick": (payload: { playerId: string }) => void;
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
