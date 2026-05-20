import type { NightAction, NightPrompt, NightStep, Role } from "../shared/types.js";
import type { Room, ServerPlayer } from "./rooms.js";

type ActionResult = { ok: true } | { ok: false; error: string };

// Per-step audio filename(s) under public/voice/<pack>/ for every pack. Most
// steps are one fixed clip — same for everyone whether or not the role is
// filled, so unfilled roles can't be detected by timing. doppelganger_act is
// special: the server assembles a sequence from atomic clips so the narrator
// only names the actionable roles that are actually in the deck this round.
// Each client picks its own pack from local preference and prepends
// /voice/<pack>/ to each filename.
const STEP_FILE: Record<NightStep, string | null> = {
  intro: "Intro.mp3",
  night_starts: "TheNightBegins.mp3",
  // Daybreak — each new step gets its own narration clip; voice script will
  // generate them on the next voice:gen run.
  sentinel: "Sentinel.mp3",
  doppelganger: "Doppelganger.mp3",
  doppelganger_act: null, // built dynamically by stepFilesFor
  werewolves: "Werewolves.mp3",
  alpha_wolf: "AlphaWolf.mp3",
  mystic_wolf: "MysticWolf.mp3",
  minion: "Minion.mp3",
  masons: "Mason.mp3",
  seer: "Seer.mp3",
  apprentice_seer: "ApprenticeSeer.mp3",
  paranormal_investigator: "ParanormalInvestigator.mp3",
  robber: "Robber.mp3",
  witch: "Witch.mp3",
  troublemaker: "Troublemaker.mp3",
  village_idiot: "VillageIdiot.mp3",
  drunk: "Drunk.mp3",
  insomniac: "Insomniac.mp3",
  doppelganger_insomniac: "DoppelgangerInsomniac.mp3",
  revealer: "Revealer.mp3",
  doppelganger_revealer: "DoppelgangerRevealer.mp3",
  curator: "Curator.mp3",
  doppelganger_curator: "DoppelgangerCurator.mp3",
  outro: "Outro.mp3",
};

// Roles a Doppelganger acts as IMMEDIATELY in the doppelganger_act step
// (rather than later in the role's own call). Order matches the narrator's
// reading order for the dynamic audio sequence. The base game roles are
// listed first to preserve compatibility; the Daybreak additions are appended
// in their relative night-order positions.
const DG_ACT_ROLES = [
  "sentinel",
  "seer",
  "apprentice_seer",
  "paranormal_investigator",
  "robber",
  "witch",
  "troublemaker",
  "village_idiot",
  "drunk",
  // Wolf-family Daybreak roles whose action happens immediately on copy.
  // The DG also wakes with the wolves later (concurrent pattern) so they
  // get the fellow-wolves note too — that's handled in the werewolves step.
  "alpha_wolf",
  "mystic_wolf",
] as const;
type DgActRole = (typeof DG_ACT_ROLES)[number];

function isDgActRole(role: Role | undefined): role is DgActRole {
  return (DG_ACT_ROLES as readonly Role[]).includes(role as Role);
}

// Only Seer/Robber/Troublemaker/Drunk have narration clips for the dynamic
// doppelganger_act sequence (the original base-game four). Daybreak DG-act
// roles get the action wired up but reuse the existing narration. We can
// add per-role clips later if it's worth the voice budget.
const DG_ACT_ROLE_CLIP: Partial<Record<DgActRole, string>> = {
  seer: "Doppelganger_Act_Seer.mp3",
  robber: "Doppelganger_Act_Robber.mp3",
  troublemaker: "Doppelganger_Act_Troublemaker.mp3",
  drunk: "Doppelganger_Act_Drunk.mp3",
};

// Daybreak — roles where the DG copy acts AFTER the real role's step (its
// own per-DG sub-step). The DG must NOT be picked up as an actor on the
// real role's step (handled by isEffective) and SHOULD be picked up by the
// matching doppelganger_X sub-step (handled by effectiveActorsForStep).
const DG_AFTER_ROLES = ["insomniac", "revealer", "curator"] as const;
type DgAfterRole = (typeof DG_AFTER_ROLES)[number];
function isDgAfterRole(role: Role | undefined): role is DgAfterRole {
  return (DG_AFTER_ROLES as readonly Role[]).includes(role as Role);
}

// Awake wolves wake during the werewolves step — original Werewolf, Alpha
// Wolf, Mystic Wolf, plus DG copies of any of those. Dream Wolves are wolves
// for team purposes but they don't actually wake (their card stays in play
// and the other wolves are told they exist).
function isAwakeWolf(p: ServerPlayer): boolean {
  if (!p.originalRole) return false;
  const role = p.originalRole;
  if (role === "werewolf" || role === "alpha_wolf" || role === "mystic_wolf") return true;
  if (role === "doppelganger" && p.doppelgangerCopied) {
    const c = p.doppelgangerCopied;
    return c === "werewolf" || c === "alpha_wolf" || c === "mystic_wolf";
  }
  return false;
}

// Dream Wolf or DG-as-Dream-Wolf. They appear to the awake wolves and the
// Minion but never wake themselves.
function isDreamWolfRole(p: ServerPlayer): boolean {
  if (p.originalRole === "dream_wolf") return true;
  if (p.originalRole === "doppelganger" && p.doppelgangerCopied === "dream_wolf") return true;
  return false;
}

// Returns the ordered list of voice clips to play at the start of a step. The
// list is normally a single-element array; doppelganger_act assembles a
// dynamic phrase like:
//   [Prefix, Seer, Or, Robber, Suffix]  (two roles)
//   [Prefix, Seer, Robber, Or, Drunk, Suffix]  (three+ roles)
//   [Prefix, Seer, Suffix]  (one role)
// Returns an empty array when the step has no audio (shouldn't happen — every
// step that runs has a clip).
export function stepFilesFor(step: NightStep, selectedRoles: Role[]): string[] {
  if (step === "doppelganger_act") {
    // Only the four base-game DG-act roles have dedicated narration clips
    // — the Daybreak roles share the suffix. Filter to those with clips so
    // the sequence stays grammatical (Prefix + name(s) + Suffix).
    const active = DG_ACT_ROLES.filter(
      (r) => selectedRoles.includes(r) && DG_ACT_ROLE_CLIP[r],
    );
    if (active.length === 0) return []; // step gets skipped via isStepInPlay
    const out = ["Doppelganger_Act_Prefix.mp3"];
    active.forEach((r, i) => {
      // Insert "or" between the penultimate and final role for natural speech.
      if (i === active.length - 1 && active.length >= 2) {
        out.push("Doppelganger_Act_Or.mp3");
      }
      const clip = DG_ACT_ROLE_CLIP[r];
      if (clip) out.push(clip);
    });
    out.push("Doppelganger_Act_Suffix.mp3");
    return out;
  }
  const file = STEP_FILE[step];
  return file ? [file] : [];
}

// Should this step play during the night? Intro/night_starts/outro always do.
// A role-specific step runs only if at least one card of that role is in the
// deck — which players can already see in the lobby, so skipping it leaks no
// information. doppelganger_act only runs when both the Doppelganger AND at
// least one of Seer/Robber/Troublemaker/Drunk are in the deck — otherwise no
// DG could ever have something to act on here, so running it would only leak
// that fact.
export function isStepInPlay(selectedRoles: Role[], step: NightStep): boolean {
  if (step === "intro" || step === "night_starts" || step === "outro") return true;
  if (step === "doppelganger") return selectedRoles.includes("doppelganger");
  if (step === "doppelganger_act") {
    if (!selectedRoles.includes("doppelganger")) return false;
    return DG_ACT_ROLES.some((r) => selectedRoles.includes(r));
  }
  // Daybreak DG-after-real-role sub-steps: only run when both the DG and
  // the real role are in the deck (otherwise no DG could have copied it).
  if (step === "doppelganger_insomniac") {
    return (
      selectedRoles.includes("doppelganger") && selectedRoles.includes("insomniac")
    );
  }
  if (step === "doppelganger_revealer") {
    return (
      selectedRoles.includes("doppelganger") && selectedRoles.includes("revealer")
    );
  }
  if (step === "doppelganger_curator") {
    return (
      selectedRoles.includes("doppelganger") && selectedRoles.includes("curator")
    );
  }
  // Daybreak — the wolf sub-steps and Seer-family sub-steps run iff their
  // role is in the deck. Same for the late roles (Witch, Village Idiot,
  // Revealer, Curator). isStepInPlay handles them generically via the
  // string-to-Role mapping below.
  const role: Role =
    step === "werewolves" ? "werewolf" : step === "masons" ? "mason" : (step as Role);
  return selectedRoles.includes(role);
}

// Fixed total duration per step (announcement audio length + action buffer).
// Empty steps wait the same as filled ones so players can't tell which roles
// are unfilled by how fast the night transitions.
// Audio durations measured from the MP3 files; buffer added for action time.
// Intro is now longer because the line includes "View your card and turn it
// face down" — players need a beat to look at their dealt card.
export const STEP_SECONDS: Record<NightStep, number> = {
  // Intro now waits for every active player to flip their card (no fixed
  // timer); this value is the safety fallback used if a player goes AFK or
  // a connection drops, so the round doesn't stall forever.
  intro: 60,
  // Brief transition: "The Night begins" plays then we advance.
  night_starts: 3,
  // Daybreak — Sentinel: pick a non-self player to shield.
  sentinel: 10,
  // Pick a player to copy only — the action-buffer that used to live here
  // moved into doppelganger_act for those who copied an actionable role.
  doppelganger: 6,
  doppelganger_act: 16, // dynamic intro + time to pick a target / centre card
  werewolves: 14,
  // Daybreak wolf sub-steps.
  alpha_wolf: 12,
  mystic_wolf: 12,
  minion: 16,
  masons: 8,
  seer: 16,
  // Daybreak Seer-family sub-steps.
  apprentice_seer: 10,
  paranormal_investigator: 18,
  robber: 14,
  witch: 14,
  troublemaker: 15,
  village_idiot: 12,
  drunk: 9,
  insomniac: 7,
  // Daybreak DG sub-step after the real Insomniac.
  doppelganger_insomniac: 7,
  revealer: 14,
  doppelganger_revealer: 14,
  curator: 12,
  doppelganger_curator: 12,
  // Fits the "...night will end in 5... 4... 3... 2... 1" line.
  outro: 6,
};

// Action applied to actors who don't submit before their step ends.
// Drunk MUST swap; Doppelganger MUST pick (per rulebook). For Doppelganger we
// fall back to a random non-self player at the room level (needs the player list).
// For doppelganger_act the caller must pass the actor's doppelgangerCopied
// role via `dgCopiedRole` so we know which action shape to default to.
export function defaultActionFor(
  step: NightStep,
  isLoneWolf: boolean,
  fallbackTargetId?: string,
  dgCopiedRole?: Role,
): NightAction {
  switch (step) {
    case "doppelganger":
      // If we couldn't find a fallback target the action will fail validation;
      // that's fine — it just means the Doppelganger silently gets nothing.
      return { kind: "doppelganger_copy", targetId: fallbackTargetId ?? "" };
    case "doppelganger_act":
      // DG defaults mirror the real-role defaults — the same auto-action a
      // Seer/Robber/Troublemaker/Drunk would get if they timed out.
      switch (dgCopiedRole) {
        case "seer":
          return { kind: "seer_skip" };
        case "robber":
          return { kind: "robber_swap", targetId: null };
        case "troublemaker":
          return { kind: "troublemaker_swap", targetIds: null };
        case "drunk": {
          const idx = Math.floor(Math.random() * 3);
          return { kind: "drunk_swap", centerIndex: idx };
        }
        default:
          return { kind: "ack" }; // copied a non-actionable role; nothing to do
      }
    case "werewolves":
      return isLoneWolf ? { kind: "werewolf_lone_view", centerIndex: null } : { kind: "ack" };
    case "minion":
    case "masons":
    case "insomniac":
      return { kind: "ack" };
    case "seer":
      return { kind: "seer_skip" };
    case "robber":
      return { kind: "robber_swap", targetId: null };
    case "troublemaker":
      return { kind: "troublemaker_swap", targetIds: null };
    case "drunk": {
      // Default to a random centre slot; range is set when the action is
      // applied (caller passes the player record, which sees room state).
      // We don't know the centre size here, so pick from the conservative 3.
      // The applyNightAction validates against the actual length.
      const idx = Math.floor(Math.random() * 3);
      return { kind: "drunk_swap", centerIndex: idx };
    }
    case "sentinel":
      // No fallback target — the Sentinel can always skip the shield.
      return { kind: "sentinel_shield", targetId: null };
    case "alpha_wolf":
      // Alpha Wolf must swap if possible, but the action itself handles the
      // no-centre-Werewolf case by recording a no_swap entry. The default
      // here just skips (engine treats this as the same outcome).
      return { kind: "alpha_wolf_swap", targetId: null };
    case "mystic_wolf":
      return { kind: "mystic_wolf_view", targetId: null };
    case "apprentice_seer":
      return { kind: "apprentice_seer_view", centerIndex: null };
    case "paranormal_investigator":
      // Auto-default: stop (don't peek). The PI's "look at second card" is
      // an optional follow-up; defaulting to stop on the first prompt is the
      // same as the player choosing not to investigate.
      return { kind: "pi_stop" };
    case "witch":
      // Default to skip — auto-doesn't peek + doesn't swap.
      return { kind: "witch_peek_center", centerIndex: null };
    case "village_idiot":
      return { kind: "village_idiot_rotate", direction: null };
    case "revealer":
      return { kind: "revealer_flip", targetId: null };
    case "curator":
      return { kind: "curator_place", targetId: null };
    case "intro":
      return { kind: "ack" }; // flips the player's card face-down
    case "night_starts":
    case "outro":
      return { kind: "ack" }; // never used (no pending actors)
    // Daybreak DG-after-real-role sub-steps: defaults mirror the matching
    // real role's auto-action so the DG behaves consistently when they
    // don't submit in time.
    case "doppelganger_insomniac":
      return { kind: "ack" };
    case "doppelganger_revealer":
      return { kind: "revealer_flip", targetId: null };
    case "doppelganger_curator":
      return { kind: "curator_place", targetId: null };
  }
}

// Set up prompts and immediate notes for a single night step. Adds player IDs
// to room.nightPendingActors for any player whose action we need to wait on.
// If no players act this step, leaves pending empty (caller still waits the
// step's full duration, then advances — that's how unfilled roles stay hidden).
export function setupNightStep(room: Room, step: NightStep) {
  if (step === "outro" || step === "night_starts") return;

  // Intro waits for every active connected human player to flip their card.
  // Bots and disconnected players are skipped so they don't block the step;
  // the safety timer in STEP_SECONDS.intro still bounds the wait if everyone
  // who's online has acted but a player is stuck on a bad connection.
  if (step === "intro") {
    for (const p of room.players) {
      if (p.spectating || !p.originalRole) continue;
      if (p.bot) continue;
      if (!p.connected) continue;
      room.nightPendingActors.add(p.id);
    }
    return;
  }

  // doppelganger_act is special: it only ever has at most one actor — the DG —
  // and we drive the prompt off doppelgangerCopied (set during the previous
  // step). Handle it before the generic actor lookup so we can branch on the
  // copied role.
  if (step === "doppelganger_act") {
    setupDoppelgangerAct(room);
    return;
  }

  const actors = effectiveActorsForStep(room, step);
  if (actors.length === 0) return;

  switch (step) {
    case "sentinel": {
      for (const s of actors) {
        const eligible = room.players
          .filter((p) => p.id !== s.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        s.prompt = {
          kind: "sentinel_choose",
          message:
            "You are the Sentinel. Place a shield token on another player's card. Their card can't be looked at, swapped, or revealed for the rest of the night.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(s.id);
      }
      return;
    }
    case "doppelganger": {
      for (const d of actors) {
        const eligible = room.players
          .filter((p) => p.id !== d.id && !p.spectating)
          .map((p) => p.id);
        d.prompt = {
          kind: "doppelganger_choose",
          message:
            "You are the Doppelganger. Look at another player's card — you become a copy of that role.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(d.id);
      }
      return;
    }
    case "werewolves": {
      // Awake wolves are this step's `actors`; dream wolves are wolves for
      // visibility purposes but don't wake. Both contribute to the "wolves
      // in play" count used for the lone-wolf-peek check.
      const dreamWolves = room.players.filter((p) => isDreamWolfRole(p));
      const dreamWolfIds = dreamWolves.map((d) => d.id);
      const all = [...actors, ...dreamWolves];
      // Reveal-time log lists every wolf, including dream wolves, so the
      // table can reconstruct the wolf-team membership during the recap.
      room.actionLog.push({
        kind: "werewolves_revealed",
        actorIds: all.map((a) => a.id),
      });
      const isOnlyOneWolf = all.length === 1;
      for (const w of actors) {
        // fellow_werewolves now only lists OTHER AWAKE wolves — the players
        // who saw you and know they're wolves themselves. Dream wolves go
        // into a separate dream_wolves_in_play note so the awake wolf knows
        // they're wolves who don't realise they're wolves.
        const fellowAwake = actors
          .filter((o) => o.id !== w.id)
          .map((o) => o.id);
        w.notes.push({ kind: "fellow_werewolves", playerIds: fellowAwake });
        if (dreamWolfIds.length > 0) {
          w.notes.push({
            kind: "dream_wolves_in_play",
            playerIds: dreamWolfIds,
          });
        }
        // Lone-wolf centre peek only applies to a real Werewolf (or DG copy
        // of one). Alpha / Mystic Wolves don't get the peek per the rules,
        // and a Dream Wolf in play removes lone status entirely (the user
        // confirmed this — the awake wolf "knows" the dream wolf is out
        // there). So this branch only fires when the deck has exactly one
        // wolf-family card and it's a Werewolf.
        const isWerewolfRole =
          w.originalRole === "werewolf" ||
          (w.originalRole === "doppelganger" &&
            w.doppelgangerCopied === "werewolf");
        if (isOnlyOneWolf && isWerewolfRole) {
          w.prompt = {
            kind: "werewolf_lone",
            message:
              "You are the lone Werewolf. You may peek at one center card.",
          };
        } else {
          w.prompt = ack(
            "You see the rest of the wolf pack in your team list.",
          );
        }
        room.nightPendingActors.add(w.id);
      }
      // Dream Wolves get a confirmation note but no prompt — they stay asleep.
      for (const dw of dreamWolves) {
        dw.notes.push({ kind: "dream_wolf_seen" });
      }
      return;
    }
    case "alpha_wolf": {
      // The Alpha Wolf swaps the horizontal centre card (added at deal
      // time when Alpha Wolf is in the deck). hasCenterWolf reflects whether
      // that slot exists — should always be true here in practice, since the
      // step only runs when Alpha Wolf is in the deck, but the prompt copes
      // if it's missing.
      const hasHorizontal = room.horizontalCenterIndex !== undefined;
      // Eligible target: any non-self, non-spectator player whose wolf-team
      // membership is false — Alpha Wolf shouldn't hand a Werewolf card to
      // another wolf. Shielded players stay in the list so the client can
      // render them with a 🛡 + disabled state (same pattern as the other
      // action pickers); the action handler refuses if one is picked.
      const eligible = room.players
        .filter(
          (p) =>
            !p.spectating &&
            !!p.originalRole &&
            !isAwakeWolf(p) &&
            !isDreamWolfRole(p),
        )
        .map((p) => p.id);
      for (const a of actors) {
        a.prompt = {
          kind: "alpha_wolf_choose",
          message: hasHorizontal
            ? "You are the Alpha Wolf. Swap the centre wolf card with any non-wolf player's card."
            : "You are the Alpha Wolf. No centre wolf card exists — you may only skip.",
          eligiblePlayerIds: eligible,
          hasCenterWolf: hasHorizontal,
        };
        room.nightPendingActors.add(a.id);
      }
      return;
    }
    case "mystic_wolf": {
      for (const m of actors) {
        // Shielded players stay in the eligible list so the picker shows
        // them with a 🛡 + disabled state. The action handler refuses if a
        // shielded target is somehow picked.
        const eligible = room.players
          .filter((p) => p.id !== m.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        m.prompt = {
          kind: "mystic_wolf_choose",
          message: "You are the Mystic Wolf. You may look at one other player's card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(m.id);
      }
      return;
    }
    case "minion": {
      // Daybreak: the Minion sees every wolf (Werewolf/Alpha/Mystic/Dream
      // and DG copies of any). Split awake-vs-dream into separate notes so
      // the Minion knows which wolves don't realise they're wolves.
      const awakeWolfIds = room.players
        .filter((p) => isAwakeWolf(p))
        .map((p) => p.id);
      const dreamWolfIds = room.players
        .filter((p) => isDreamWolfRole(p))
        .map((p) => p.id);
      const allWolfIds = [...awakeWolfIds, ...dreamWolfIds];
      for (const m of actors) {
        m.notes.push({ kind: "minion_sees_werewolves", playerIds: awakeWolfIds });
        if (dreamWolfIds.length > 0) {
          m.notes.push({ kind: "dream_wolves_in_play", playerIds: dreamWolfIds });
        }
        m.prompt = ack(
          allWolfIds.length === 0
            ? "You are the Minion. There are no Werewolves in play — protect the center."
            : "You are the Minion. You see the Werewolves; they do not see you.",
        );
        // Reveal log keeps the full wolf list for the table recap.
        room.actionLog.push({
          kind: "minion_saw_werewolves",
          actorId: m.id,
          werewolfIds: allWolfIds,
        });
        room.nightPendingActors.add(m.id);
      }
      return;
    }
    case "masons": {
      const others = actors.length > 1;
      if (others) {
        room.actionLog.push({ kind: "masons_revealed", actorIds: actors.map((a) => a.id) });
      }
      for (const m of actors) {
        const otherIds = actors.filter((o) => o.id !== m.id).map((o) => o.id);
        if (otherIds.length === 0) {
          m.notes.push({ kind: "no_other_masons" });
          m.prompt = ack("You are a Mason. There is no other Mason in play.");
          room.actionLog.push({ kind: "lone_mason", actorId: m.id });
        } else {
          m.notes.push({ kind: "fellow_mason", playerIds: otherIds });
          m.prompt = ack("You are a Mason. The other Mason is in your team list.");
        }
        room.nightPendingActors.add(m.id);
      }
      return;
    }
    case "seer": {
      for (const s of actors) {
        s.prompt = {
          kind: "seer_choose",
          message: "You are the Seer. Look at one other player's card OR two of the center cards.",
        };
        room.nightPendingActors.add(s.id);
      }
      return;
    }
    case "apprentice_seer": {
      for (const a of actors) {
        a.prompt = {
          kind: "apprentice_seer_choose",
          message: "You are the Apprentice Seer. You may look at one of the centre cards.",
        };
        room.nightPendingActors.add(a.id);
      }
      return;
    }
    case "paranormal_investigator": {
      for (const p of actors) {
        const eligible = room.players
          .filter(
            (q) => q.id !== p.id && !q.spectating && !!q.originalRole,
          )
          .map((q) => q.id);
        p.piPicksRemaining = 2;
        p.prompt = {
          kind: "paranormal_investigator_choose",
          message:
            "You are the Paranormal Investigator. Look at up to two players' cards. Stop if you see a Werewolf, Minion or Tanner — you'll become that team.",
          eligiblePlayerIds: eligible,
          picksRemaining: 2,
        };
        room.nightPendingActors.add(p.id);
      }
      return;
    }
    case "robber": {
      for (const r of actors) {
        const eligible = room.players
          .filter((p) => p.id !== r.id && !p.spectating)
          .map((p) => p.id);
        r.prompt = {
          kind: "robber_choose",
          message:
            "You are the Robber. You may swap your card with another player's and view your new card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(r.id);
      }
      return;
    }
    case "witch": {
      for (const w of actors) {
        w.witchPeekedCenterIndex = undefined;
        w.prompt = {
          kind: "witch_choose",
          message:
            "You are the Witch. You may peek one centre card. If you do, you must swap it with any player's card (including yourself).",
        };
        room.nightPendingActors.add(w.id);
      }
      return;
    }
    case "village_idiot": {
      for (const v of actors) {
        // Rotation ring: every active non-self, non-shielded player who's
        // been dealt a card. Order = the room.players order. Shielded
        // players are excluded so the rotation can never touch a shielded
        // card.
        const affected = room.players
          .filter(
            (p) =>
              p.id !== v.id &&
              !p.spectating &&
              !!p.originalRole &&
              !room.shieldedPlayerIds.has(p.id),
          )
          .map((p) => p.id);
        v.prompt = {
          kind: "village_idiot_choose",
          message:
            affected.length < 2
              ? "You are the Village Idiot. Not enough other players to rotate."
              : "You are the Village Idiot. Rotate everyone else's card one seat left or right.",
          affectedPlayerIds: affected,
        };
        room.nightPendingActors.add(v.id);
      }
      return;
    }
    case "troublemaker": {
      for (const t of actors) {
        const eligible = room.players
          .filter((p) => p.id !== t.id && !p.spectating)
          .map((p) => p.id);
        t.prompt = {
          kind: "troublemaker_choose",
          message: "You are the Troublemaker. You may swap two other players' cards.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(t.id);
      }
      return;
    }
    case "drunk": {
      for (const d of actors) {
        d.prompt = {
          kind: "drunk_choose",
          message:
            "You are the Drunk. Swap your card with one of the center cards (you will not see it).",
        };
        room.nightPendingActors.add(d.id);
      }
      return;
    }
    case "revealer": {
      for (const r of actors) {
        const eligible = room.players
          .filter((p) => p.id !== r.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        r.prompt = {
          kind: "revealer_choose",
          message:
            "You are the Revealer. You may flip another player's card face up. If it's on the wolf or tanner team, it flips back face down.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(r.id);
      }
      return;
    }
    case "curator": {
      for (const c of actors) {
        // Eligible: any active player (including self), but never a player
        // who already has an artifact (the DG-Curator sub-step uses the same
        // exclusion to avoid stacking).
        const eligible = room.players
          .filter(
            (p) =>
              !p.spectating &&
              !!p.originalRole &&
              !room.playerArtifacts.has(p.id),
          )
          .map((p) => p.id);
        c.prompt = {
          kind: "curator_choose",
          message:
            "You are the Curator. Place an artifact token face down on any player's card (including your own). You won't see which artifact landed.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(c.id);
      }
      return;
    }
    case "doppelganger_insomniac": {
      // DG-as-Insomniac wakes here (after the real Insomniac's step) and
      // looks at their current physical card. Behaviour mirrors the real
      // Insomniac setup, including the face-up reveal that stays through
      // day/vote and the matching note.
      for (const i of actors) {
        const current = room.currentRoleOf(i.id);
        i.knownCurrentRole = current;
        i.cardFaceDown = false;
        i.notes.push({ kind: "insomniac_self", role: current });
        i.prompt = ack(
          `You copied the Insomniac. Your card is: ${labelFor(current)}.`,
        );
        room.actionLog.push({ kind: "insomniac_saw", actorId: i.id, role: current });
        room.nightPendingActors.add(i.id);
      }
      return;
    }
    case "doppelganger_revealer": {
      // DG-as-Revealer flips another player's card (same mechanics as the
      // real Revealer step — wolf/tanner cards re-hide; villager-team cards
      // become a public reveal).
      for (const r of actors) {
        const eligible = room.players
          .filter((p) => p.id !== r.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        r.prompt = {
          kind: "revealer_choose",
          message:
            "You copied the Revealer. You may flip another player's card face up. If it's on the wolf or tanner team, it flips back face down.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(r.id);
      }
      return;
    }
    case "doppelganger_curator": {
      // DG-as-Curator places an artifact, same as the real Curator, but the
      // eligible list already excludes anyone the real Curator already gave
      // a token to (no stacking artifacts).
      for (const c of actors) {
        const eligible = room.players
          .filter(
            (p) =>
              !p.spectating &&
              !!p.originalRole &&
              !room.playerArtifacts.has(p.id),
          )
          .map((p) => p.id);
        c.prompt = {
          kind: "curator_choose",
          message:
            "You copied the Curator. Place an artifact on a player whose card doesn't already have one. You won't see which artifact landed.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(c.id);
      }
      return;
    }
    case "insomniac": {
      for (const i of actors) {
        const current = room.currentRoleOf(i.id);
        i.knownCurrentRole = current;
        // Insomniac flips their card face-up on their turn — and unlike the
        // other roles, the card stays face-up for the rest of the round so
        // they can see it during day/vote (the whole point of the role).
        i.cardFaceDown = false;
        i.notes.push({ kind: "insomniac_self", role: current });
        // Phrasing differs for the real Insomniac (who's checking whether
        // they got swapped during the night — hence "now") vs a DG who
        // copied the Insomniac (whose physical card is still the Doppelganger
        // unless something swapped them — "now" would be misleading).
        const isDopplegangerCopy = i.originalRole === "doppelganger";
        i.prompt = ack(
          isDopplegangerCopy
            ? `You copied the Insomniac. Your card is: ${labelFor(current)}.`
            : `You are the Insomniac. Your card is now: ${labelFor(current)}.`,
        );
        room.actionLog.push({ kind: "insomniac_saw", actorId: i.id, role: current });
        room.nightPendingActors.add(i.id);
      }
      return;
    }
  }
}

export function applyNightAction(
  room: Room,
  player: ServerPlayer,
  action: NightAction,
): ActionResult {
  const step = room.nightStep;
  if (!step) return { ok: false, error: "No night step" };
  const original = player.originalRole;
  if (!original) return { ok: false, error: "No role assigned" };

  switch (action.kind) {
    case "ack": {
      // Intro: any non-spectator player can ack to confirm they've flipped
      // their card face-down. No role check — everyone flips at the start.
      // Flip their card now so their own UI matches the "Face down" copy
      // they'll see immediately after submitting (without waiting for the
      // rest of the table).
      if (step === "intro" && !player.spectating) {
        player.cardFaceDown = true;
        return { ok: true };
      }
      const validAck =
        (step === "werewolves" && effectiveActorsForRole(room, "werewolf").length >= 2 && isEffective(player, "werewolf")) ||
        (step === "minion" && isEffective(player, "minion")) ||
        (step === "masons" && isEffective(player, "mason")) ||
        (step === "insomniac" && isEffective(player, "insomniac")) ||
        // Daybreak DG-as-Insomniac sub-step also accepts ack.
        (step === "doppelganger_insomniac" &&
          player.originalRole === "doppelganger" &&
          player.doppelgangerCopied === "insomniac");
      return validAck ? { ok: true } : { ok: false, error: "Ack not valid here" };
    }

    case "sentinel_shield": {
      if (!canActAs(player, "sentinel", step)) {
        return { ok: false, error: "Not sentinel step" };
      }
      if (action.targetId === null) {
        player.notes.push({ kind: "sentinel_skipped" });
        room.actionLog.push({ kind: "sentinel_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      room.shieldedPlayerIds.add(target.id);
      player.notes.push({ kind: "sentinel_shielded", targetId: target.id });
      room.actionLog.push({
        kind: "sentinel_shielded",
        actorId: player.id,
        targetId: target.id,
      });
      return { ok: true };
    }

    case "doppelganger_copy": {
      if (step !== "doppelganger" || original !== "doppelganger") {
        return { ok: false, error: "Not doppelganger step" };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const copied = room.currentRoleOf(target.id);
      if (copied === "doppelganger") return { ok: false, error: "Cannot copy a Doppelganger" };
      // The DG locks in their team here but does NOT change cards — they
      // physically still hold the Doppelganger card. Only doppelgangerCopied
      // is set; currentRoles stays as the Doppelganger card. Win logic uses
      // effectiveRoleOf() to read the locked team. Subsequent swaps (Robber,
      // Troublemaker, Drunk) operate on the physical card via currentRoles
      // as normal.
      player.doppelgangerCopied = copied;
      // Show the copied role on their card briefly so they know what role
      // they're now acting as. Their physical card is still Doppelganger
      // (per the "You are the Doppelganger" starting-role note) — the
      // display here is for the role-they-now-play feedback.
      player.knownCurrentRole = copied;
      player.cardFaceDown = false;
      player.notes.push({ kind: "doppelganger_copied", targetId: target.id, role: copied });
      room.actionLog.push({
        kind: "doppelganger_copied",
        actorId: player.id,
        targetId: target.id,
        copiedRole: copied,
      });
      return { ok: true };
    }

    case "werewolf_lone_view": {
      if (step !== "werewolves" || !isEffective(player, "werewolf")) {
        return { ok: false, error: "Not the lone wolf step" };
      }
      if (effectiveActorsForRole(room, "werewolf").length !== 1) {
        return { ok: false, error: "Not the lone wolf" };
      }
      if (action.centerIndex === null) {
        room.actionLog.push({ kind: "lone_wolf_skipped", actorId: player.id });
        return { ok: true };
      }
      if (
        !Number.isInteger(action.centerIndex) ||
        action.centerIndex < 0 ||
        action.centerIndex >= room.centerCards.length
      ) {
        return { ok: false, error: "Invalid center index" };
      }
      const role = room.centerCards[action.centerIndex];
      player.notes.push({ kind: "lone_wolf_center", index: action.centerIndex, role });
      room.actionLog.push({
        kind: "lone_wolf_peeked",
        actorId: player.id,
        centerIndex: action.centerIndex,
        role,
      });
      return { ok: true };
    }

    case "alpha_wolf_swap": {
      if (!canActAs(player, "alpha_wolf", step)) {
        return { ok: false, error: "Not alpha wolf step" };
      }
      if (action.targetId === null) {
        player.notes.push({ kind: "alpha_wolf_no_swap" });
        room.actionLog.push({ kind: "alpha_wolf_no_swap", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      // Swap the horizontal centre card (the one added when Alpha Wolf is
      // in the deck). If it's missing for some reason — e.g. a manual edit
      // dropped the slot — record a no_swap entry and exit cleanly.
      const centerIndex = room.horizontalCenterIndex;
      if (centerIndex === undefined || centerIndex < 0 || centerIndex >= room.centerCards.length) {
        player.notes.push({ kind: "alpha_wolf_no_swap" });
        room.actionLog.push({ kind: "alpha_wolf_no_swap", actorId: player.id });
        return { ok: true };
      }
      // Alpha Wolf swap: the horizontal centre card goes to target's hand;
      // target's old role goes to the horizontal slot. Alpha Wolf sees
      // neither card.
      room.swapPlayerWithCenter(target.id, centerIndex);
      player.notes.push({
        kind: "alpha_wolf_swapped",
        targetId: target.id,
        centerIndex,
      });
      room.actionLog.push({
        kind: "alpha_wolf_swapped",
        actorId: player.id,
        targetId: target.id,
        centerIndex,
      });
      return { ok: true };
    }
    case "mystic_wolf_view": {
      if (!canActAs(player, "mystic_wolf", step)) {
        return { ok: false, error: "Not mystic wolf step" };
      }
      if (action.targetId === null) {
        room.actionLog.push({ kind: "mystic_wolf_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const role = room.currentRoleOf(target.id);
      player.notes.push({ kind: "mystic_wolf_saw", targetId: target.id, role });
      room.actionLog.push({
        kind: "mystic_wolf_saw",
        actorId: player.id,
        targetId: target.id,
        role,
      });
      return { ok: true };
    }

    case "seer_skip": {
      if (!canActAs(player, "seer", step)) return { ok: false, error: "Not seer step" };
      room.actionLog.push({ kind: "seer_skipped", actorId: player.id });
      return { ok: true };
    }
    case "seer_view_player": {
      if (!canActAs(player, "seer", step)) return { ok: false, error: "Not seer step" };
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const role = room.currentRoleOf(target.id);
      player.notes.push({ kind: "seer_player", playerId: target.id, role });
      room.actionLog.push({
        kind: "seer_saw_player",
        actorId: player.id,
        targetId: target.id,
        role,
      });
      return { ok: true };
    }
    case "seer_view_center": {
      if (!canActAs(player, "seer", step)) return { ok: false, error: "Not seer step" };
      const [a, b] = action.indices;
      const len = room.centerCards.length;
      const validIdx = (i: number) => Number.isInteger(i) && i >= 0 && i < len;
      if (a === b || !validIdx(a) || !validIdx(b)) {
        return { ok: false, error: "Pick two distinct center cards" };
      }
      const cards = [
        { index: a, role: room.centerCards[a] },
        { index: b, role: room.centerCards[b] },
      ];
      player.notes.push({ kind: "seer_center", cards });
      room.actionLog.push({ kind: "seer_saw_center", actorId: player.id, cards });
      return { ok: true };
    }

    case "apprentice_seer_view": {
      if (!canActAs(player, "apprentice_seer", step)) {
        return { ok: false, error: "Not apprentice seer step" };
      }
      if (action.centerIndex === null) {
        room.actionLog.push({ kind: "apprentice_seer_skipped", actorId: player.id });
        return { ok: true };
      }
      if (
        !Number.isInteger(action.centerIndex) ||
        action.centerIndex < 0 ||
        action.centerIndex >= room.centerCards.length
      ) {
        return { ok: false, error: "Invalid center index" };
      }
      const role = room.centerCards[action.centerIndex];
      player.notes.push({
        kind: "apprentice_seer_center",
        index: action.centerIndex,
        role,
      });
      room.actionLog.push({
        kind: "apprentice_seer_saw",
        actorId: player.id,
        centerIndex: action.centerIndex,
        role,
      });
      return { ok: true };
    }

    case "pi_stop": {
      if (!canActAs(player, "paranormal_investigator", step)) {
        return { ok: false, error: "Not P.I. step" };
      }
      player.piPicksRemaining = 0;
      room.actionLog.push({ kind: "pi_stopped", actorId: player.id });
      return { ok: true };
    }
    case "pi_view": {
      if (!canActAs(player, "paranormal_investigator", step)) {
        return { ok: false, error: "Not P.I. step" };
      }
      if ((player.piPicksRemaining ?? 0) <= 0) {
        return { ok: false, error: "No P.I. picks remaining" };
      }
      const target = room.players.find((q) => q.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const role = room.currentRoleOf(target.id);
      // Non-villager team locks the PI's team and ends the step. Daybreak
      // rulebook: Werewolf / Minion / Tanner all flip the PI.
      const lockTeams: Role[] = [
        "werewolf",
        "alpha_wolf",
        "mystic_wolf",
        "dream_wolf",
        "minion",
        "tanner",
      ];
      const teamLocked = lockTeams.includes(role);
      player.notes.push({
        kind: "pi_saw",
        targetId: target.id,
        role,
        teamLocked,
      });
      room.actionLog.push({
        kind: "pi_saw",
        actorId: player.id,
        targetId: target.id,
        role,
        teamLocked,
      });
      if (teamLocked) {
        player.piTeamRole = role;
        player.piPicksRemaining = 0;
      } else {
        player.piPicksRemaining = (player.piPicksRemaining ?? 1) - 1;
        // If they still have a pick, refresh the prompt so the client knows
        // the eligible list (excluding the already-viewed target).
        if (player.piPicksRemaining > 0) {
          const eligible = room.players
            .filter(
              (q) =>
                q.id !== player.id &&
                q.id !== target.id &&
                !q.spectating &&
                !!q.originalRole,
            )
            .map((q) => q.id);
          player.prompt = {
            kind: "paranormal_investigator_choose",
            message:
              "Look at one more player's card, or stop. If you see a Werewolf, Minion or Tanner, you become that team.",
            eligiblePlayerIds: eligible,
            picksRemaining: player.piPicksRemaining,
          };
          // Keep the player as a pending actor — they still owe a decision.
          room.nightPendingActors.add(player.id);
        }
      }
      return { ok: true };
    }

    case "witch_peek_center": {
      if (!canActAs(player, "witch", step)) {
        return { ok: false, error: "Not witch step" };
      }
      if (action.centerIndex === null) {
        room.actionLog.push({ kind: "witch_skipped", actorId: player.id });
        return { ok: true };
      }
      if (
        !Number.isInteger(action.centerIndex) ||
        action.centerIndex < 0 ||
        action.centerIndex >= room.centerCards.length
      ) {
        return { ok: false, error: "Invalid center index" };
      }
      // Stash the peeked index and prompt the Witch for the mandatory swap.
      player.witchPeekedCenterIndex = action.centerIndex;
      const peekedRole = room.centerCards[action.centerIndex];
      const eligible = room.players
        .filter((p) => !p.spectating && !!p.originalRole)
        .map((p) => p.id);
      player.prompt = {
        kind: "witch_swap_choose",
        message:
          "You saw the centre card. You must now swap it with any player's card (including yourself).",
        peekedRole,
        peekedIndex: action.centerIndex,
        eligiblePlayerIds: eligible,
      };
      // Keep the Witch as a pending actor — the swap is mandatory.
      room.nightPendingActors.add(player.id);
      return { ok: true };
    }
    case "witch_swap": {
      if (!canActAs(player, "witch", step)) {
        return { ok: false, error: "Not witch step" };
      }
      const centerIndex = player.witchPeekedCenterIndex;
      if (centerIndex === undefined) {
        return { ok: false, error: "Peek a centre card first" };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.spectating || !target.originalRole) {
        return { ok: false, error: "Invalid target" };
      }
      // The Witch is allowed to target themselves, so no self-check.
      // Shielded targets are blocked — touching a shielded card is forbidden.
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const peekedRole = room.centerCards[centerIndex];
      room.swapPlayerWithCenter(target.id, centerIndex);
      player.witchPeekedCenterIndex = undefined;
      player.notes.push({
        kind: "witch_swapped",
        centerIndex,
        peekedRole,
        targetId: target.id,
      });
      room.actionLog.push({
        kind: "witch_swapped",
        actorId: player.id,
        centerIndex,
        peekedRole,
        targetId: target.id,
      });
      return { ok: true };
    }
    case "revealer_flip": {
      if (!canActAs(player, "revealer", step)) {
        return { ok: false, error: "Not revealer step" };
      }
      if (action.targetId === null) {
        room.actionLog.push({ kind: "revealer_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      const role = room.currentRoleOf(target.id);
      // Daybreak rule: only villager-team cards stay face-up. Wolf-team and
      // Tanner cards flip back face-down — the Revealer learns the role
      // privately but the rest of the table sees nothing.
      const nonVillagerTeam: Role[] = [
        "werewolf",
        "alpha_wolf",
        "mystic_wolf",
        "dream_wolf",
        "minion",
        "tanner",
      ];
      const publicReveal = !nonVillagerTeam.includes(role);
      if (publicReveal) {
        room.publiclyRevealedRoles.set(target.id, role);
        // Broadcast the reveal to every active player so it shows in their
        // notes panel too (per the user's "the note should go to everyone").
        for (const p of room.players) {
          if (p.spectating) continue;
          if (!p.originalRole) continue;
          p.notes.push({
            kind: "revealer_revealed_public",
            targetId: target.id,
            role,
          });
        }
      } else {
        // Wolf or Tanner — Revealer keeps the secret.
        player.notes.push({
          kind: "revealer_saw_hidden",
          targetId: target.id,
          role,
        });
      }
      room.actionLog.push({
        kind: "revealer_revealed",
        actorId: player.id,
        targetId: target.id,
        role,
        publicReveal,
      });
      return { ok: true };
    }
    case "curator_place": {
      if (!canActAs(player, "curator", step)) {
        return { ok: false, error: "Not curator step" };
      }
      if (action.targetId === null) {
        room.actionLog.push({ kind: "curator_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.spectating || !target.originalRole) {
        return { ok: false, error: "Invalid target" };
      }
      // Shield blocks artifact placement — the shielded card can't be touched.
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      if (room.playerArtifacts.has(target.id)) {
        return { ok: false, error: "That player already has an artifact." };
      }
      if (room.artifactPool.length === 0) {
        return { ok: false, error: "No artifacts left in the pool." };
      }
      // Random pick from the remaining pool; consume that entry so the same
      // artifact can't show up on a later placement (e.g. DG-Curator).
      const pickIdx = Math.floor(Math.random() * room.artifactPool.length);
      const artifact = room.artifactPool.splice(pickIdx, 1)[0]!;
      room.playerArtifacts.set(target.id, artifact);
      // Curator's own private note records who they targeted, but NOT which
      // artifact was placed — they don't see that.
      player.notes.push({
        kind: "curator_placed_token",
        targetId: target.id,
      });
      // Target gets a note recording the specific artifact landed on their
      // card — they're allowed to know (so they can react to the Mask
      // muting them, plan for the Claw/Cudgel/Brand team change, etc.).
      // The kind stays hidden from everyone else until the reveal.
      target.notes.push({ kind: "you_received_artifact", artifact });
      // Reveal-time log entry carries the artifact kind so the final recap
      // shows what each Curator placed.
      room.actionLog.push({
        kind: "curator_placed",
        actorId: player.id,
        targetId: target.id,
        artifact,
      });
      return { ok: true };
    }
    case "village_idiot_rotate": {
      if (!canActAs(player, "village_idiot", step)) {
        return { ok: false, error: "Not village idiot step" };
      }
      if (action.direction === null) {
        room.actionLog.push({ kind: "village_idiot_skipped", actorId: player.id });
        return { ok: true };
      }
      // Rebuild the rotation ring at action time so any late-arriving
      // shield (shouldn't happen in normal flow, but defensive) is honoured.
      const ring = room.players.filter(
        (p) =>
          p.id !== player.id &&
          !p.spectating &&
          !!p.originalRole &&
          !room.shieldedPlayerIds.has(p.id),
      );
      if (ring.length < 2) {
        // Nothing meaningful to rotate; treat as skip.
        room.actionLog.push({ kind: "village_idiot_skipped", actorId: player.id });
        return { ok: true };
      }
      const roles = ring.map((p) => room.currentRoleOf(p.id));
      // Left = shift each card to the seat on its left (player[i] gets
      // what player[i+1] had). Right = the opposite.
      const rotated =
        action.direction === "left"
          ? [...roles.slice(1), roles[0]]
          : [roles[roles.length - 1], ...roles.slice(0, -1)];
      ring.forEach((p, i) => room.setCurrentRole(p.id, rotated[i]));
      const playerIds = ring.map((p) => p.id);
      player.notes.push({
        kind: "village_idiot_rotated",
        playerIds,
        direction: action.direction,
      });
      room.actionLog.push({
        kind: "village_idiot_rotated",
        actorId: player.id,
        playerIds,
        direction: action.direction,
      });
      return { ok: true };
    }

    case "robber_swap": {
      if (!canActAs(player, "robber", step)) return { ok: false, error: "Not robber step" };
      if (action.targetId === null) {
        room.actionLog.push({ kind: "robber_skipped", actorId: player.id });
        return { ok: true };
      }
      const target = room.players.find((p) => p.id === action.targetId);
      if (!target || target.id === player.id || target.spectating) {
        return { ok: false, error: "Invalid target" };
      }
      if (isShielded(room, target.id)) {
        return { ok: false, error: "That player is shielded by the Sentinel." };
      }
      // Capture the actor's current role before the swap — that's what the
      // target ends up holding after.
      const actorOldRole = room.currentRoleOf(player.id);
      room.swapPlayerRoles(player.id, target.id);
      const newRole = room.currentRoleOf(player.id);
      player.knownCurrentRole = newRole;
      // Brief reveal of the stolen card — endNightStep flips face-down.
      player.cardFaceDown = false;
      player.notes.push({ kind: "robber_new_role", targetId: target.id, role: newRole });
      room.actionLog.push({
        kind: "robber_swapped",
        actorId: player.id,
        targetId: target.id,
        newRole,
        targetNewRole: actorOldRole,
      });
      return { ok: true };
    }

    case "troublemaker_swap": {
      if (!canActAs(player, "troublemaker", step)) {
        return { ok: false, error: "Not troublemaker step" };
      }
      if (action.targetIds === null) {
        room.actionLog.push({ kind: "troublemaker_skipped", actorId: player.id });
        return { ok: true };
      }
      const [aId, bId] = action.targetIds;
      if (aId === bId || aId === player.id || bId === player.id) {
        return { ok: false, error: "Pick two other distinct players" };
      }
      const a = room.players.find((p) => p.id === aId);
      const b = room.players.find((p) => p.id === bId);
      if (!a || !b || a.spectating || b.spectating) {
        return { ok: false, error: "Unknown player" };
      }
      if (isShielded(room, aId) || isShielded(room, bId)) {
        return { ok: false, error: "One of those players is shielded by the Sentinel." };
      }
      // After the swap, a holds b's old role and vice versa.
      const aOld = room.currentRoleOf(a.id);
      const bOld = room.currentRoleOf(b.id);
      room.swapPlayerRoles(a.id, b.id);
      // Troublemaker remembers who they swapped (but not what the cards
      // were — they didn't see them). Surfaces in their notes panel during
      // the day so they can claim it accurately.
      player.notes.push({ kind: "troublemaker_swapped", targetIds: [aId, bId] });
      room.actionLog.push({
        kind: "troublemaker_swapped",
        actorId: player.id,
        targetIds: [aId, bId],
        newRoles: [bOld, aOld],
      });
      return { ok: true };
    }

    case "drunk_swap": {
      if (!canActAs(player, "drunk", step)) return { ok: false, error: "Not drunk step" };
      if (
        !Number.isInteger(action.centerIndex) ||
        action.centerIndex < 0 ||
        action.centerIndex >= room.centerCards.length
      ) {
        return { ok: false, error: "Invalid center index" };
      }
      room.swapPlayerWithCenter(player.id, action.centerIndex);
      player.cardFaceDown = true;
      player.knownCurrentRole = undefined;
      player.notes.push({ kind: "drunk_swapped", centerIndex: action.centerIndex });
      room.actionLog.push({
        kind: "drunk_swapped",
        actorId: player.id,
        centerIndex: action.centerIndex,
      });
      return { ok: true };
    }
  }
}

// "Effective role" = original role OR a Doppelganger who copied that role.
// Used in actor selection and validation so the Doppelganger acts in the
// copied role's step exactly as a real X would — EXCEPT for the four roles
// that act in doppelganger_act (Seer/Robber/Troublemaker/Drunk). Those DGs
// have already acted by the time their copied-role's regular step runs, so
// they shouldn't be picked up as an actor on it again.
function isEffective(player: ServerPlayer, role: Role): boolean {
  if (player.originalRole === role) return true;
  if (
    player.originalRole === "doppelganger" &&
    player.doppelgangerCopied === role &&
    !isDgActRole(role) &&
    !isDgAfterRole(role)
  ) {
    return true;
  }
  return false;
}

// True if the target player is shielded by the Sentinel — used by every
// night action that looks at or swaps a player's card to refuse the action
// and surface a friendly error.
function isShielded(room: Room, playerId: string): boolean {
  return room.shieldedPlayerIds.has(playerId);
}

// Accepts an action submitted as `role` during the current step. True when:
//   - it's the role's real step and the actor is a real (non-DG) holder, OR
//   - it's doppelganger_act and the actor is a DG who copied that role.
// Centralises the "is this submission allowed here" check so the per-action
// validation in applyNightAction stays a one-liner.
function canActAs(player: ServerPlayer, role: Role, step: NightStep | undefined): boolean {
  if (!step) return false;
  if (step === "doppelganger_act") {
    return player.originalRole === "doppelganger" && player.doppelgangerCopied === role;
  }
  // Daybreak — DG copies of Insomniac / Revealer / Curator act in their
  // own after-real-role sub-step. The same action kinds are used (just
  // submitted from the DG sub-step).
  if (step === "doppelganger_insomniac") {
    return (
      role === "insomniac" &&
      player.originalRole === "doppelganger" &&
      player.doppelgangerCopied === "insomniac"
    );
  }
  if (step === "doppelganger_revealer") {
    return (
      role === "revealer" &&
      player.originalRole === "doppelganger" &&
      player.doppelgangerCopied === "revealer"
    );
  }
  if (step === "doppelganger_curator") {
    return (
      role === "curator" &&
      player.originalRole === "doppelganger" &&
      player.doppelgangerCopied === "curator"
    );
  }
  // Real-role step: only an actual holder of that role wakes (DG copies of
  // DG_ACT and DG_AFTER roles are filtered out by isEffective).
  const expected: NightStep =
    role === "werewolf" ? "werewolves" : role === "mason" ? "masons" : (role as NightStep);
  return step === expected && isEffective(player, role);
}

function effectiveActorsForRole(room: Room, role: Role): ServerPlayer[] {
  return room.players.filter((p) => isEffective(p, role));
}

function effectiveActorsForStep(room: Room, step: NightStep): ServerPlayer[] {
  if (step === "intro" || step === "outro") return [];
  if (step === "doppelganger") {
    return room.players.filter((p) => p.originalRole === "doppelganger");
  }
  if (step === "doppelganger_act") {
    return room.players.filter(
      (p) =>
        p.originalRole === "doppelganger" &&
        isDgActRole(p.doppelgangerCopied),
    );
  }
  // Daybreak — DG sub-steps that fire AFTER the real role closes its eyes.
  // Each step is the DG who copied that specific role.
  if (step === "doppelganger_insomniac") {
    return room.players.filter(
      (p) =>
        p.originalRole === "doppelganger" &&
        p.doppelgangerCopied === "insomniac",
    );
  }
  if (step === "doppelganger_revealer") {
    return room.players.filter(
      (p) =>
        p.originalRole === "doppelganger" &&
        p.doppelgangerCopied === "revealer",
    );
  }
  if (step === "doppelganger_curator") {
    return room.players.filter(
      (p) =>
        p.originalRole === "doppelganger" &&
        p.doppelgangerCopied === "curator",
    );
  }
  // Werewolves step: all awake wolves (Werewolf/Alpha/Mystic + DG copies of
  // any of those). Dream Wolves are wolves but don't wake — they're handled
  // separately in setupNightStep so they appear in fellow-wolves notes.
  if (step === "werewolves") {
    return room.players.filter((p) => isAwakeWolf(p));
  }
  const role: Role =
    step === "masons" ? "mason" : (step as Role);
  return effectiveActorsForRole(room, role);
}

// Per-DG prompt setup for the doppelganger_act step. Reuses the existing
// per-role prompt kinds so the client controls don't need to learn a new
// shape. Spectators and bots are filtered out of eligible target lists the
// same way they are for the real-role prompts.
function setupDoppelgangerAct(room: Room) {
  const actors = effectiveActorsForStep(room, "doppelganger_act");
  for (const dg of actors) {
    const copied = dg.doppelgangerCopied;
    if (!copied) continue;
    switch (copied) {
      case "seer":
        dg.prompt = {
          kind: "seer_choose",
          message:
            "You copied the Seer. Look at one other player's card OR two of the center cards.",
        };
        room.nightPendingActors.add(dg.id);
        break;
      case "robber": {
        const eligible = room.players
          .filter((p) => p.id !== dg.id && !p.spectating)
          .map((p) => p.id);
        dg.prompt = {
          kind: "robber_choose",
          message:
            "You copied the Robber. You may swap your card with another player's and view your new card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "troublemaker": {
        const eligible = room.players
          .filter((p) => p.id !== dg.id && !p.spectating)
          .map((p) => p.id);
        dg.prompt = {
          kind: "troublemaker_choose",
          message: "You copied the Troublemaker. You may swap two other players' cards.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "drunk":
        dg.prompt = {
          kind: "drunk_choose",
          message:
            "You copied the Drunk. Swap your card with one of the center cards (you will not see it).",
        };
        room.nightPendingActors.add(dg.id);
        break;
      case "sentinel": {
        const eligible = room.players
          .filter((p) => p.id !== dg.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        dg.prompt = {
          kind: "sentinel_choose",
          message:
            "You copied the Sentinel. Place a shield token on another player's card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "alpha_wolf": {
        const hasHorizontal = room.horizontalCenterIndex !== undefined;
        const eligible = room.players
          .filter(
            (p) =>
              !p.spectating &&
              !!p.originalRole &&
              !isAwakeWolf(p) &&
              !isDreamWolfRole(p),
          )
          .map((p) => p.id);
        dg.prompt = {
          kind: "alpha_wolf_choose",
          message: hasHorizontal
            ? "You copied the Alpha Wolf. Swap the centre wolf card with any non-wolf player's card."
            : "You copied the Alpha Wolf. No centre wolf card exists — you may only skip.",
          eligiblePlayerIds: eligible,
          hasCenterWolf: hasHorizontal,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "mystic_wolf": {
        const eligible = room.players
          .filter((p) => p.id !== dg.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        dg.prompt = {
          kind: "mystic_wolf_choose",
          message:
            "You copied the Mystic Wolf. You may look at one other player's card.",
          eligiblePlayerIds: eligible,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "apprentice_seer":
        dg.prompt = {
          kind: "apprentice_seer_choose",
          message:
            "You copied the Apprentice Seer. You may look at one of the centre cards.",
        };
        room.nightPendingActors.add(dg.id);
        break;
      case "paranormal_investigator": {
        const eligible = room.players
          .filter((p) => p.id !== dg.id && !p.spectating && !!p.originalRole)
          .map((p) => p.id);
        dg.piPicksRemaining = 2;
        dg.prompt = {
          kind: "paranormal_investigator_choose",
          message:
            "You copied the P.I. Look at up to two players' cards. Stop if you see a Werewolf, Minion or Tanner — you'll become that team.",
          eligiblePlayerIds: eligible,
          picksRemaining: 2,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      case "witch":
        dg.witchPeekedCenterIndex = undefined;
        dg.prompt = {
          kind: "witch_choose",
          message:
            "You copied the Witch. You may peek one centre card. If you do, you must swap it with any player's card (including yourself).",
        };
        room.nightPendingActors.add(dg.id);
        break;
      case "village_idiot": {
        const affected = room.players
          .filter(
            (p) =>
              p.id !== dg.id &&
              !p.spectating &&
              !!p.originalRole &&
              !room.shieldedPlayerIds.has(p.id),
          )
          .map((p) => p.id);
        dg.prompt = {
          kind: "village_idiot_choose",
          message:
            affected.length < 2
              ? "You copied the Village Idiot. Not enough other players to rotate."
              : "You copied the Village Idiot. Rotate everyone else's card one seat left or right.",
          affectedPlayerIds: affected,
        };
        room.nightPendingActors.add(dg.id);
        break;
      }
      default:
        break;
    }
  }
}

function ack(message: string): NightPrompt {
  return { kind: "ack", message };
}

function labelFor(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
