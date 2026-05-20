// Shared types between client and server.
// IMPORTANT: never include another player's hidden role here unless the
// game logic has explicitly revealed it.

export type Role =
  // ---- Base game ----
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
  | "villager"
  // ---- Daybreak expansion ----
  | "sentinel"
  | "alpha_wolf"
  | "mystic_wolf"
  | "dream_wolf"
  | "apprentice_seer"
  | "paranormal_investigator"
  | "witch"
  | "village_idiot"
  | "revealer"
  | "curator"
  | "bodyguard";

// Roles introduced by the Daybreak expansion. Listed separately so the lobby
// can split the role picker into Base / Daybreak tabs and so the random-deck
// generator can skip them when Daybreak is disabled.
export const DAYBREAK_ROLES: Role[] = [
  "sentinel",
  "alpha_wolf",
  "mystic_wolf",
  "dream_wolf",
  "apprentice_seer",
  "paranormal_investigator",
  "witch",
  "village_idiot",
  "revealer",
  "curator",
  "bodyguard",
];

// Convenience predicate: every wolf-team role we count toward the wolf cap
// (the lobby's adjustable max total wolves). Real Werewolf + the three
// Daybreak wolves; Minion is wolf-team but not a wolf for cap purposes.
export const WOLF_ROLES: Role[] = [
  "werewolf",
  "alpha_wolf",
  "mystic_wolf",
  "dream_wolf",
];

// Daybreak — Curator's artifact tokens. The Curator places one of these on
// a player's card face-down; it's revealed at the reveal phase. Three of the
// five change team alignment at win-calculation time; Mask silences the
// recipient during the day; Void does nothing.
export type ArtifactKind = "claw" | "cudgel" | "brand" | "mask" | "void";
export const ARTIFACT_KINDS: ArtifactKind[] = [
  "claw",
  "cudgel",
  "brand",
  "mask",
  "void",
];

export interface ArtifactMeta {
  kind: ArtifactKind;
  label: string;
  description: string;
}

export const ARTIFACT_META: Record<ArtifactKind, ArtifactMeta> = {
  claw: {
    kind: "claw",
    label: "Claw of the Werewolf",
    description: "Turns the bearer into a Werewolf at the reveal.",
  },
  cudgel: {
    kind: "cudgel",
    label: "Cudgel of the Tanner",
    description: "Turns the bearer into a Tanner at the reveal.",
  },
  brand: {
    kind: "brand",
    label: "Brand of the Villager",
    description: "Turns the bearer into a Villager at the reveal.",
  },
  mask: {
    kind: "mask",
    label: "Mask of Muting",
    description: "The bearer cannot speak during the day.",
  },
  void: {
    kind: "void",
    label: "Void of Nothingness",
    description: "Does nothing.",
  },
};

// Required deck size for a given player count. Normally N+3 (one per player
// plus 3 centre cards). When Alpha Wolf is in the selected deck a 4th centre
// slot is added at deal time (the horizontal "centre wolf" card the Alpha
// Wolf swaps), so the host must pick N+4 cards. The extra card doesn't have
// to be a wolf — the horizontal is drawn from the existing wolves in
// selectedRoles at deal time, no duplicates.
export function deckTargetSize(
  activePlayerCount: number,
  selectedRoles: Role[],
): number {
  const hasAlpha = selectedRoles.includes("alpha_wolf");
  return activePlayerCount + 3 + (hasAlpha ? 1 : 0);
}

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
  // Host has enabled the Daybreak expansion in this room. While off, the
  // Daybreak tab in the lobby is disabled (existing Daybreak picks stay
  // selectable but can't be added) and the random-deck button ignores
  // Daybreak roles entirely.
  daybreakEnabled?: boolean;
  // Maximum total wolves (Werewolf / Alpha / Mystic / Dream) allowed in the
  // deck. Default 3. Adjustable from the lobby's role-section menu so hosts
  // can dial in heavier or lighter wolf metas.
  wolfCap?: number;
  // Roles the host has flagged "do not use this round". Randomise + the
  // auto-add-on-join priority list skip these. Manual click in the role
  // picker still works (and the click also un-excludes the role).
  excludedRoles?: Role[];
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
  // Set only during the intro step. IDs of active players who have flipped
  // their card face-down. The step advances once everyone is in the list
  // (the intro waits on this instead of a timer). Used by the client to show
  // an X/Y "ready" indicator and per-player checkmarks.
  nightIntroFlippedIds?: string[];
  // Daybreak — IDs of players with a Sentinel shield on their card. The
  // shield blocks all subsequent night actions targeting that card. Public so
  // every player can see the shield icon on the affected tile.
  shieldedPlayerIds?: string[];
  // Daybreak — index into centerCards (or, before reveal, centerCardCount)
  // of the auto-added wolf card placed when Alpha Wolf is in the deck. It's
  // a normal centre card mechanically (Seer/Drunk/Witch/Lone Wolf can all
  // touch it), but the UI renders it rotated 90° to visually mark it as the
  // "centre Werewolf card" the Alpha Wolf swaps. undefined when no Alpha
  // Wolf is in the deck.
  horizontalCenterIndex?: number;
  // Daybreak — Revealer's published reveals. Card stays face-up on the
  // affected player's tile for the rest of the round. Frozen role (set at
  // reveal time) so later artifact-driven team changes don't rewrite what
  // the table publicly saw.
  publiclyRevealedRoles?: Array<{ playerId: string; role: Role }>;
  // Daybreak — Curator-placed artifacts. During day/vote each entry carries
  // only the playerId (`artifact` is undefined) so the table can see WHO
  // has a token but not which one. At the reveal phase the server fills in
  // `artifact` so everyone learns the kind. The Mask of Muting also
  // populates artifactMutedIds before the reveal so the WebRTC layer can
  // silence the bearer without leaking which artifact is muting them.
  playerArtifacts?: Array<{ playerId: string; artifact?: ArtifactKind }>;
  artifactMutedIds?: string[];
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
  // Daybreak — Sentinel shielding (or skipping).
  | { kind: "sentinel_shielded"; actorId: string; targetId: string }
  | { kind: "sentinel_skipped"; actorId: string }
  // Daybreak wolf-family entries. Alpha Wolf swaps without seeing either
  // card, so the entry just records the swap (the reveal log will show the
  // resulting centre + target afterwards). Mystic Wolf sees the role.
  | { kind: "alpha_wolf_swapped"; actorId: string; targetId: string; centerIndex: number }
  | { kind: "alpha_wolf_no_swap"; actorId: string }
  | { kind: "mystic_wolf_saw"; actorId: string; targetId: string; role: Role }
  | { kind: "mystic_wolf_skipped"; actorId: string }
  | { kind: "apprentice_seer_saw"; actorId: string; centerIndex: number; role: Role }
  | { kind: "apprentice_seer_skipped"; actorId: string }
  | {
      kind: "pi_saw";
      actorId: string;
      targetId: string;
      role: Role;
      teamLocked: boolean;
    }
  | { kind: "pi_stopped"; actorId: string }
  | {
      kind: "witch_swapped";
      actorId: string;
      centerIndex: number;
      peekedRole: Role;
      targetId: string;
    }
  | { kind: "witch_skipped"; actorId: string }
  | {
      kind: "village_idiot_rotated";
      actorId: string;
      playerIds: string[];
      direction: "left" | "right";
    }
  | { kind: "village_idiot_skipped"; actorId: string }
  | {
      kind: "revealer_revealed";
      actorId: string;
      targetId: string;
      role: Role;
      publicReveal: boolean;
    }
  | { kind: "revealer_skipped"; actorId: string }
  | {
      kind: "curator_placed";
      actorId: string;
      targetId: string;
      artifact: ArtifactKind;
    }
  | { kind: "curator_skipped"; actorId: string }
  // Daybreak — Bodyguard's vote-time save: the bodyguard's pick would have
  // been killed but for this protection. Pushed once per save.
  | { kind: "bodyguard_saved"; bodyguardId: string; savedId: string }
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
  | "night_starts"
  // Daybreak: Sentinel acts first, placing a shield that blocks every
  // subsequent player-targeting night action against the shielded card.
  | "sentinel"
  | "doppelganger"
  | "doppelganger_act"
  | "werewolves"
  // Daybreak wolf sub-steps run after the wolves see each other.
  | "alpha_wolf"
  | "mystic_wolf"
  | "minion"
  | "masons"
  | "seer"
  // Daybreak sub-steps inside the Seer's call.
  | "apprentice_seer"
  | "paranormal_investigator"
  | "robber"
  // Daybreak: Witch acts after the Robber.
  | "witch"
  | "troublemaker"
  // Daybreak: Village Idiot acts after the Troublemaker.
  | "village_idiot"
  | "drunk"
  | "insomniac"
  // Daybreak DG sub-step: a Doppelganger who copied an Insomniac wakes
  // after the real Insomniac and looks at their own (still-Doppelganger
  // unless something swapped them) card.
  | "doppelganger_insomniac"
  // Daybreak Revealer + its DG sub-step.
  | "revealer"
  | "doppelganger_revealer"
  // Daybreak Curator + its DG sub-step.
  | "curator"
  | "doppelganger_curator"
  | "outro";

export const NIGHT_ORDER: NightStep[] = [
  "intro",
  "night_starts",
  "sentinel",
  "doppelganger",
  "doppelganger_act",
  "werewolves",
  "alpha_wolf",
  "mystic_wolf",
  "minion",
  "masons",
  "seer",
  "apprentice_seer",
  "paranormal_investigator",
  "robber",
  "witch",
  "troublemaker",
  "village_idiot",
  "drunk",
  "insomniac",
  "doppelganger_insomniac",
  "revealer",
  "doppelganger_revealer",
  "curator",
  "doppelganger_curator",
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
  // Daybreak — Sentinel records who they shielded (or that they skipped).
  | { kind: "sentinel_shielded"; targetId: string }
  | { kind: "sentinel_skipped" }
  // Daybreak — Alpha Wolf swapped (or couldn't / skipped).
  | { kind: "alpha_wolf_swapped"; targetId: string; centerIndex: number }
  | { kind: "alpha_wolf_no_swap" }
  // Daybreak — Mystic Wolf peeked another player's card. (Skipping yields
  // no note — same convention as seer_skipped / robber_skipped.)
  | { kind: "mystic_wolf_saw"; targetId: string; role: Role }
  // Daybreak — Apprentice Seer peeked one centre card.
  | { kind: "apprentice_seer_center"; index: number; role: Role }
  // Daybreak — Paranormal Investigator peeked a player. role is what they
  // saw; teamLocked indicates whether seeing this card flipped the PI to
  // that role's team (true when role is werewolf/minion/tanner).
  | { kind: "pi_saw"; targetId: string; role: Role; teamLocked: boolean }
  // Daybreak — Witch swapped centre[index] with target's card. peekedRole
  // is what the Witch saw before swapping (since they're allowed to know).
  | {
      kind: "witch_swapped";
      centerIndex: number;
      peekedRole: Role;
      targetId: string;
    }
  // Daybreak — Village Idiot recall: which players were rotated and which
  // direction (no role info — they swapped cards blind).
  | {
      kind: "village_idiot_rotated";
      playerIds: string[];
      direction: "left" | "right";
    }
  // Daybreak — Revealer's private record of a flip that stayed hidden
  // (target was on the wolf or tanner team). Only the Revealer sees this.
  | { kind: "revealer_saw_hidden"; targetId: string; role: Role }
  // Daybreak — broadcast to every active player when the Revealer flips a
  // villager-team card face up. The reveal is public + permanent for the
  // rest of the round.
  | { kind: "revealer_revealed_public"; targetId: string; role: Role }
  // Daybreak — Curator's record of placing an artifact (they don't see
  // which artifact landed; the server picks).
  | { kind: "curator_placed_token"; targetId: string }
  // Pushed to the player who receives an artifact. They know the kind
  // (so they can plan for the Mask, etc.) — the rest of the table only
  // sees a token until the reveal.
  | { kind: "you_received_artifact"; artifact: ArtifactKind }
  // Daybreak — Dream Wolf doesn't wake, but they get a note acknowledging
  // the wolves can now see them.
  | { kind: "dream_wolf_seen" }
  // Daybreak — pushed alongside fellow_werewolves / minion_sees_werewolves
  // when at least one Dream Wolf is in play, so the awake wolves and the
  // Minion know which "wolves" in their team list don't know they are wolves.
  // Distinct from dream_wolf_seen (which is the Dream Wolf's own self-note).
  | { kind: "dream_wolves_in_play"; playerIds: string[] }
  // Pushed to every active non-host player when the host enables dev mode
  // mid-round, so they know the host can now see the table.
  | { kind: "host_enabled_dev_mode" }
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
  // Daybreak — Sentinel picks any non-self player to receive the shield.
  | { kind: "sentinel_choose"; message: string; eligiblePlayerIds: string[] }
  // Daybreak — Alpha Wolf picks a non-wolf player to receive the centre
  // Werewolf card. hasCenterWolf is false when there's no Werewolf card in
  // the centre to swap (only skip is meaningful then).
  | {
      kind: "alpha_wolf_choose";
      message: string;
      eligiblePlayerIds: string[];
      hasCenterWolf: boolean;
    }
  // Daybreak — Mystic Wolf peeks one player's card.
  | { kind: "mystic_wolf_choose"; message: string; eligiblePlayerIds: string[] }
  // Daybreak — Apprentice Seer peeks one centre card. Uses the same centre-
  // card click UI as the Lone Wolf peek.
  | { kind: "apprentice_seer_choose"; message: string }
  // Daybreak — Witch's first prompt: peek any centre card or skip.
  | { kind: "witch_choose"; message: string }
  // Daybreak — Witch's mandatory follow-up after peeking. peekedRole +
  // peekedIndex tell the client what the Witch saw; eligiblePlayerIds is
  // every active non-shielded player (including the Witch themselves).
  | {
      kind: "witch_swap_choose";
      message: string;
      peekedRole: Role;
      peekedIndex: number;
      eligiblePlayerIds: string[];
    }
  // Daybreak — Village Idiot rotates a ring of cards left or right (or skip).
  // affectedPlayerIds is the rotation ring in seating order, so the client
  // can show a tiny diagram of who's about to be shuffled.
  | {
      kind: "village_idiot_choose";
      message: string;
      affectedPlayerIds: string[];
    }
  // Daybreak — Revealer picks a non-self player to flip face-up.
  | {
      kind: "revealer_choose";
      message: string;
      eligiblePlayerIds: string[];
    }
  // Daybreak — Curator picks any player (self included) to receive an
  // artifact token. The artifact itself is server-randomised; the Curator
  // doesn't see which one was placed.
  | {
      kind: "curator_choose";
      message: string;
      eligiblePlayerIds: string[];
    }
  // Daybreak — Paranormal Investigator. picksRemaining is 2 on the first
  // prompt, 1 after a villager-team peek. Drops out as soon as the PI views
  // a non-villager-team role (they become that team) or picks Stop.
  | {
      kind: "paranormal_investigator_choose";
      message: string;
      eligiblePlayerIds: string[];
      picksRemaining: number;
    }
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
  | { kind: "drunk_swap"; centerIndex: number }
  // Daybreak — Sentinel places a shield on a non-self player. Null = skip.
  | { kind: "sentinel_shield"; targetId: string | null }
  // Daybreak — Alpha Wolf swaps a centre Werewolf card with a non-wolf
  // player's card. targetId is the player to swap with; null = skip (e.g.
  // when no centre Werewolf exists or no eligible target).
  | { kind: "alpha_wolf_swap"; targetId: string | null }
  // Daybreak — Mystic Wolf peeks one other player's card. Null = skip.
  | { kind: "mystic_wolf_view"; targetId: string | null }
  // Daybreak — Apprentice Seer peeks one centre card. Null = skip.
  | { kind: "apprentice_seer_view"; centerIndex: number | null }
  // Daybreak — Paranormal Investigator picks a player to peek. The server
  // returns the role in a note; the prompt then either ends (non-villager
  // team viewed → PI becomes that team) or refreshes for a second pick.
  | { kind: "pi_view"; targetId: string }
  // Stops the PI's investigation after the first pick (or before any pick).
  | { kind: "pi_stop" }
  // Daybreak — Witch: first peeks one centre card (or skips entirely).
  // centerIndex: null skips the whole step. Otherwise the Witch is then
  // required to follow with a witch_swap.
  | { kind: "witch_peek_center"; centerIndex: number | null }
  // Daybreak — Witch's mandatory follow-up after peeking. Swaps the peeked
  // centre card with the chosen player's card (player can be self).
  | { kind: "witch_swap"; targetId: string }
  // Daybreak — Village Idiot rotates every non-self, non-shielded player's
  // card one seat left or right. direction: null skips the whole step.
  | { kind: "village_idiot_rotate"; direction: "left" | "right" | null }
  // Daybreak — Revealer flips another player's card face-up. Null = skip.
  | { kind: "revealer_flip"; targetId: string | null }
  // Daybreak — Curator places an artifact face-down on any player (self
  // included). Server randomly picks which artifact gets placed. Null = skip.
  | { kind: "curator_place"; targetId: string | null };

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
  // out private rooms (only). Mid-game rooms are still listed — joiners land
  // as spectators while the round plays out.
  "rooms:listPublic": (
    cb: (res: {
      rooms: Array<{
        code: string;
        roomName?: string;
        hostName: string;
        playerCount: number;
        spectatorCount: number;
        phase: Phase;
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
  // Host toggles the Daybreak expansion. Disabling it removes any Daybreak
  // roles currently selected from the deck.
  "lobby:setDaybreakEnabled": (payload: { enabled: boolean }) => void;
  // Host adjusts the max-wolves cap (1..5). Clamped server-side.
  "lobby:setWolfCap": (payload: { cap: number }) => void;
  // Toggle a role's "excluded" flag. While excluded, the role is skipped by
  // Randomise and by the priority-list auto-add when a player joins.
  "lobby:setRoleExcluded": (payload: { role: Role; excluded: boolean }) => void;
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
  // ---- Daybreak expansion ----
  sentinel: {
    role: "sentinel",
    label: "Sentinel",
    team: "villager",
    description:
      "Acts first. Place a shield token on another player's card — they can't be looked at, swapped or revealed for the rest of the night.",
    maxCount: 1,
  },
  alpha_wolf: {
    role: "alpha_wolf",
    label: "Alpha Wolf",
    team: "werewolf",
    description:
      "Wakes with the wolves. Then swaps the centre wolf card with another player's card, without looking at either. Selecting Alpha Wolf bumps the deck by +1 — one wolf from your selection is drawn as the horizontal 4th centre card.",
    maxCount: 1,
  },
  mystic_wolf: {
    role: "mystic_wolf",
    label: "Mystic Wolf",
    team: "werewolf",
    description: "Wakes with the wolves. Then may look at one other player's card.",
    maxCount: 1,
  },
  dream_wolf: {
    role: "dream_wolf",
    label: "Dream Wolf",
    team: "werewolf",
    description:
      "Doesn't wake. The other werewolves and the Minion see them as a wolf. A Dream Wolf in play removes lone-wolf status from a single Werewolf.",
    maxCount: 1,
  },
  apprentice_seer: {
    role: "apprentice_seer",
    label: "Apprentice Seer",
    team: "villager",
    description: "May look at one of the centre cards.",
    maxCount: 1,
  },
  paranormal_investigator: {
    role: "paranormal_investigator",
    label: "Paranormal Investigator",
    team: "villager",
    description:
      "May look at up to two other players' cards. If you see a non-villager team role (Werewolf, Minion or Tanner), you stop and become that role's team — you don't get to act again on its turn.",
    maxCount: 1,
  },
  witch: {
    role: "witch",
    label: "Witch",
    team: "villager",
    description:
      "May look at one centre card. If you do, you must swap it with any player's card (including yourself).",
    maxCount: 1,
  },
  village_idiot: {
    role: "village_idiot",
    label: "Village Idiot",
    team: "villager",
    description:
      "May rotate every other player's card one seat to the left or right. Your own card stays put.",
    maxCount: 1,
  },
  revealer: {
    role: "revealer",
    label: "Revealer",
    team: "villager",
    description:
      "May flip another player's card face up for everyone to see. If the card is on the wolf or tanner team, it stays hidden.",
    maxCount: 1,
  },
  curator: {
    role: "curator",
    label: "Curator",
    team: "villager",
    description:
      "May place a random Artifact token face down on any player's card (including yourself). The artifact may change their role, mute them, or do nothing.",
    maxCount: 1,
  },
  bodyguard: {
    role: "bodyguard",
    label: "Bodyguard",
    team: "villager",
    description:
      "No night action. The player you vote for cannot be killed — if they would have died, the next-highest vote-getters die instead.",
    maxCount: 1,
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
