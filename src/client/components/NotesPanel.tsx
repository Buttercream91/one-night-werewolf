import type { ReactNode } from "react";
import { useState } from "react";
import type { NightNote, PrivateView, PublicRoom } from "../../shared/types.js";
import { send } from "../socket.js";
import { PlayerChip, PlayerList, RoleChip } from "./Chips.js";

interface Props {
  me: PrivateView;
  room: PublicRoom;
  // When false (reveal phase) hide the input; auto + user notes still show.
  allowAdding?: boolean;
  className?: string;
}

// Combined panel: server-generated night notes (what you saw) + free-form text
// notes the player types themselves. Both persist server-side, so they survive
// reconnects and stay through day → vote → reveal.
export function NotesPanel({ me, room, allowAdding = true, className = "" }: Props) {
  const [draft, setDraft] = useState("");

  function add() {
    const text = draft.trim();
    if (!text) return;
    send.addNote(text);
    setDraft("");
  }

  const hasAuto = me.notes.length > 0;
  const hasUser = me.userNotes.length > 0;
  if (!hasAuto && !hasUser && !allowAdding) return null;

  return (
    <div className={`panel ${className}`}>
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Your notes</h3>

      {hasAuto && (
        <ul className="space-y-1.5 text-sm text-slate-200">
          {me.notes.map((n, i) => (
            <li key={`auto-${i}`} className="flex items-start gap-2">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
              <span className="flex-1 leading-relaxed">
                {renderNote(n, room)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {hasUser && (
        <ul className={`space-y-1.5 text-sm text-slate-200 ${hasAuto ? "mt-2 pt-2 border-t border-slate-800" : ""}`}>
          {me.userNotes.map((text, i) => (
            <li key={`user-${i}`} className="flex items-start gap-2 group">
              <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
              <span className="flex-1">{text}</span>
              {allowAdding && (
                <button
                  onClick={() => send.removeNote(i)}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-300 text-xs"
                  title="Remove note"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {allowAdding && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
            placeholder="Add a note (e.g. 'Alan claims Seer')"
            maxLength={280}
            className="input flex-1 text-sm"
          />
          <button onClick={add} disabled={draft.trim().length === 0} className="btn-ghost text-sm">
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// Build the rendered note for a single auto-note. Uses inline role chips and
// coloured player names instead of the older plain-text describe() output.
function renderNote(n: NightNote, room: PublicRoom): ReactNode {
  switch (n.kind) {
    case "starting_role":
      return (
        <>
          You are the <RoleChip role={n.role} />.
        </>
      );
    case "sentinel_shielded":
      return (
        <>
          You shielded <PlayerChip id={n.targetId} room={room} /> 🛡.
        </>
      );
    case "sentinel_skipped":
      return <>You skipped the shield.</>;
    case "alpha_wolf_swapped":
      return (
        <>
          You moved the centre Werewolf (#{n.centerIndex + 1}) into{" "}
          <PlayerChip id={n.targetId} room={room} />'s hand. You didn't see
          their old card.
        </>
      );
    case "alpha_wolf_no_swap":
      return <>No Werewolf card was in the centre — no swap to make.</>;
    case "mystic_wolf_saw":
      return (
        <>
          <PlayerChip id={n.targetId} room={room} />'s card is{" "}
          <RoleChip role={n.role} />.
        </>
      );
    case "apprentice_seer_center":
      return (
        <>
          You peeked centre card #{n.index + 1}: <RoleChip role={n.role} />.
        </>
      );
    case "pi_saw":
      return n.teamLocked ? (
        <>
          You looked at <PlayerChip id={n.targetId} room={room} />'s card —{" "}
          <RoleChip role={n.role} />. You stop investigating and your team
          locks to <RoleChip role={n.role} />.
        </>
      ) : (
        <>
          You looked at <PlayerChip id={n.targetId} room={room} />'s card —{" "}
          <RoleChip role={n.role} />.
        </>
      );
    case "dream_wolf_seen":
      return <>You stayed asleep — the wolves can see you.</>;
    case "dream_wolves_in_play":
      return (
        <>
          Dream wolf (asleep — doesn't know):{" "}
          <PlayerList ids={n.playerIds} room={room} />.
        </>
      );
    case "doppelganger_copied":
      return (
        <>
          You copied <PlayerChip id={n.targetId} room={room} /> and became{" "}
          <RoleChip role={n.role} />.
        </>
      );
    case "fellow_werewolves":
      return (
        <>
          Other werewolves: <PlayerList ids={n.playerIds} room={room} />.
        </>
      );
    case "lone_wolf_center":
      return (
        <>
          You peeked centre card {n.index + 1}: <RoleChip role={n.role} />.
        </>
      );
    case "minion_sees_werewolves":
      return n.playerIds.length === 0 ? (
        <>There are no Werewolves in play.</>
      ) : (
        <>
          Werewolves: <PlayerList ids={n.playerIds} room={room} />.
        </>
      );
    case "fellow_mason":
      return (
        <>
          Other Masons: <PlayerList ids={n.playerIds} room={room} />.
        </>
      );
    case "no_other_masons":
      return <>There is no other Mason in play.</>;
    case "seer_player":
      return (
        <>
          <PlayerChip id={n.playerId} room={room} />'s card is{" "}
          <RoleChip role={n.role} />.
        </>
      );
    case "seer_center":
      return (
        <>
          Centre cards —{" "}
          {n.cards.map((c, i) => (
            <span key={c.index}>
              {i > 0 && "; "}#{c.index + 1}: <RoleChip role={c.role} />
            </span>
          ))}
          .
        </>
      );
    case "robber_new_role":
      return (
        <>
          You robbed <PlayerChip id={n.targetId} room={room} /> and now hold{" "}
          <RoleChip role={n.role} />.
        </>
      );
    case "troublemaker_swapped":
      return (
        <>
          You swapped the cards of <PlayerChip id={n.targetIds[0]} room={room} /> and{" "}
          <PlayerChip id={n.targetIds[1]} room={room} />.
        </>
      );
    case "drunk_swapped":
      return (
        <>
          You took centre card #{n.centerIndex + 1} (you didn't see it).
        </>
      );
    case "insomniac_self":
      return (
        <>
          Your card is now <RoleChip role={n.role} />.
        </>
      );
  }
}
