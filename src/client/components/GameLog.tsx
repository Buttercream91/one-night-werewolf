import type { ReactNode } from "react";
import type { ActionLogEntry, PublicRoom } from "../../shared/types.js";
import { PlayerChip, PlayerList, RoleChip } from "./Chips.js";

interface Props {
  room: PublicRoom;
}

// Phase buckets the action log gets grouped into so the timeline reads as a
// story (Night → Vote → Resolution) instead of a flat dump. Order matches
// the order events actually occur in.
type Phase = "night" | "vote" | "resolution";
const PHASE_TITLE: Record<Phase, string> = {
  night: "Night",
  vote: "Vote",
  resolution: "Resolution",
};

// Chronological narrative of the night and vote, shown only at reveal. Each
// entry is rendered with role chips + coloured player names so the table can
// reconstruct what happened at a glance.
export function GameLog({ room }: Props) {
  const log = room.actionLog ?? [];
  if (log.length === 0) return null;

  const groups: Record<Phase, ActionLogEntry[]> = {
    night: [],
    vote: [],
    resolution: [],
  };
  for (const entry of log) groups[phaseOf(entry)].push(entry);

  return (
    <div className="panel">
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-4">
        Night recap
      </h3>
      <div className="space-y-5">
        {(Object.keys(groups) as Phase[]).map((phase) =>
          groups[phase].length === 0 ? null : (
            <section key={phase}>
              <div className="text-xs uppercase tracking-wider text-indigo-300 mb-2">
                {PHASE_TITLE[phase]}
              </div>
              <ol className="relative border-l border-slate-800 ml-2 space-y-2.5 pl-4">
                {groups[phase].map((entry, i) => (
                  <li key={i} className="relative">
                    <span
                      className={`absolute -left-[1.32rem] top-1.5 inline-block h-2 w-2 rounded-full ${dotColor(entry)}`}
                    />
                    <div className="text-sm leading-relaxed text-slate-200">
                      {renderEntry(entry, room)}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ),
        )}
      </div>
    </div>
  );
}

// Group each entry into the phase it happened in. The vote phase covers
// individual votes; the resolution phase covers kills + the no-one-died line.
function phaseOf(e: ActionLogEntry): Phase {
  switch (e.kind) {
    case "vote":
      return "vote";
    case "killed":
    case "no_one_died":
      return "resolution";
    default:
      return "night";
  }
}

// Marker dot colour — green for wolves/info reveals, amber for swaps,
// rose for kills, slate for everything else. Helps the eye scan quickly.
function dotColor(e: ActionLogEntry): string {
  switch (e.kind) {
    case "killed":
      return "bg-rose-400";
    case "no_one_died":
      return "bg-slate-500";
    case "vote":
      return "bg-sky-400";
    case "doppelganger_copied":
    case "robber_swapped":
    case "troublemaker_swapped":
    case "drunk_swapped":
    case "alpha_wolf_swapped":
    case "witch_swapped":
    case "village_idiot_rotated":
      return "bg-amber-400";
    case "werewolves_revealed":
    case "masons_revealed":
    case "minion_saw_werewolves":
    case "mystic_wolf_saw":
      return "bg-rose-400";
    default:
      return "bg-emerald-400";
  }
}

// Render a single timeline entry with chips inline. Each render returns JSX
// so chips can be styled per-role / per-player rather than baked into a
// flat string.
function renderEntry(e: ActionLogEntry, room: PublicRoom): ReactNode {
  switch (e.kind) {
    case "sentinel_shielded":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="sentinel" />)
          placed a shield on <PlayerChip id={e.targetId} room={room} /> 🛡.
        </>
      );
    case "sentinel_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="sentinel" />)
          skipped the shield.
        </>
      );
    case "alpha_wolf_swapped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="alpha_wolf" />)
          moved the centre Werewolf (#{e.centerIndex + 1}) into{" "}
          <PlayerChip id={e.targetId} room={room} />'s hand.
        </>
      );
    case "alpha_wolf_no_swap":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="alpha_wolf" />)
          had no centre Werewolf to swap.
        </>
      );
    case "mystic_wolf_saw":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="mystic_wolf" />)
          looked at <PlayerChip id={e.targetId} room={room} />'s card —{" "}
          <RoleChip role={e.role} />.
        </>
      );
    case "mystic_wolf_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="mystic_wolf" />)
          chose not to look.
        </>
      );
    case "apprentice_seer_saw":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="apprentice_seer" />)
          peeked centre #{e.centerIndex + 1} — <RoleChip role={e.role} />.
        </>
      );
    case "apprentice_seer_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="apprentice_seer" />)
          chose not to look.
        </>
      );
    case "pi_saw":
      return e.teamLocked ? (
        <>
          <PlayerChip id={e.actorId} room={room} /> (
          <RoleChip role="paranormal_investigator" />) investigated{" "}
          <PlayerChip id={e.targetId} room={room} /> — <RoleChip role={e.role} />.
          Their team locked to <RoleChip role={e.role} />.
        </>
      ) : (
        <>
          <PlayerChip id={e.actorId} room={room} /> (
          <RoleChip role="paranormal_investigator" />) investigated{" "}
          <PlayerChip id={e.targetId} room={room} /> — <RoleChip role={e.role} />.
        </>
      );
    case "pi_stopped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (
          <RoleChip role="paranormal_investigator" />) stopped investigating.
        </>
      );
    case "witch_swapped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="witch" />)
          saw centre #{e.centerIndex + 1} (<RoleChip role={e.peekedRole} />) and
          moved it to <PlayerChip id={e.targetId} room={room} />.
        </>
      );
    case "witch_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="witch" />)
          chose not to peek.
        </>
      );
    case "village_idiot_rotated":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (
          <RoleChip role="village_idiot" />) rotated cards{" "}
          {e.direction === "left" ? "left" : "right"}:{" "}
          {e.playerIds.map((id, i) => (
            <span key={id}>
              {i > 0 && " → "}
              <PlayerChip id={id} room={room} />
            </span>
          ))}
          .
        </>
      );
    case "village_idiot_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (
          <RoleChip role="village_idiot" />) didn't rotate.
        </>
      );
    case "doppelganger_copied":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="doppelganger" />)
          copied <PlayerChip id={e.targetId} room={room} /> and became{" "}
          <RoleChip role={e.copiedRole} />.
        </>
      );
    case "werewolves_revealed":
      return (
        <>
          Werewolves saw each other: <PlayerList ids={e.actorIds} room={room} />.
        </>
      );
    case "lone_wolf_peeked":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (lone <RoleChip role="werewolf" />)
          peeked centre #{e.centerIndex + 1} — <RoleChip role={e.role} />.
        </>
      );
    case "lone_wolf_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (lone <RoleChip role="werewolf" />)
          skipped the centre peek.
        </>
      );
    case "minion_saw_werewolves":
      return e.werewolfIds.length === 0 ? (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="minion" />)
          saw no Werewolves were in play.
        </>
      ) : (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="minion" />)
          saw the wolves: <PlayerList ids={e.werewolfIds} room={room} />.
        </>
      );
    case "masons_revealed":
      return (
        <>
          Masons saw each other: <PlayerList ids={e.actorIds} room={room} />.
        </>
      );
    case "lone_mason":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="mason" />)
          saw no other Mason was in play.
        </>
      );
    case "seer_saw_player":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="seer" />)
          looked at <PlayerChip id={e.targetId} room={room} />'s card —{" "}
          <RoleChip role={e.role} />.
        </>
      );
    case "seer_saw_center":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="seer" />)
          peeked centre{" "}
          {e.cards.map((c, i) => (
            <span key={c.index}>
              {i > 0 && " and "}#{c.index + 1} <RoleChip role={c.role} />
            </span>
          ))}
          .
        </>
      );
    case "seer_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="seer" />)
          chose not to look.
        </>
      );
    case "robber_swapped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="robber" />)
          stole <PlayerChip id={e.targetId} room={room} />'s card and became{" "}
          <RoleChip role={e.newRole} />.{" "}
          <PlayerChip id={e.targetId} room={room} /> is now the{" "}
          <RoleChip role={e.targetNewRole} />.
        </>
      );
    case "robber_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="robber" />)
          chose not to steal.
        </>
      );
    case "troublemaker_swapped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="troublemaker" />)
          swapped the cards of <PlayerChip id={e.targetIds[0]} room={room} /> and{" "}
          <PlayerChip id={e.targetIds[1]} room={room} />.{" "}
          <PlayerChip id={e.targetIds[0]} room={room} /> is now the{" "}
          <RoleChip role={e.newRoles[0]} /> and{" "}
          <PlayerChip id={e.targetIds[1]} room={room} /> is now the{" "}
          <RoleChip role={e.newRoles[1]} />.
        </>
      );
    case "troublemaker_skipped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="troublemaker" />)
          didn't swap anyone.
        </>
      );
    case "drunk_swapped":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="drunk" />)
          traded their card with centre #{e.centerIndex + 1} (without looking).
        </>
      );
    case "insomniac_saw":
      return (
        <>
          <PlayerChip id={e.actorId} room={room} /> (<RoleChip role="insomniac" />)
          checked their card — <RoleChip role={e.role} />.
        </>
      );
    case "vote":
      return (
        <>
          <PlayerChip id={e.voterId} room={room} /> voted for{" "}
          {e.targetId === "no_kill" ? (
            <span className="italic text-slate-400">no one</span>
          ) : (
            <PlayerChip id={e.targetId} room={room} />
          )}
          .
        </>
      );
    case "killed":
      return e.via === "hunter" ? (
        <>
          <PlayerChip id={e.targetId} room={room} /> was killed by the{" "}
          <RoleChip role="hunter" />
          's last vote.
        </>
      ) : (
        <>
          <PlayerChip id={e.targetId} room={room} /> was killed by the village vote.
        </>
      );
    case "no_one_died":
      return (
        <span className="italic text-slate-400">
          Nobody received enough votes — no one was killed.
        </span>
      );
  }
}
