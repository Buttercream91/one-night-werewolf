import { useState } from "react";
import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { send } from "../socket.js";

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

  function nameOf(id: string) {
    return room.players.find((p) => p.id === id)?.name ?? "?";
  }

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
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
              <span>{describeNote(n, nameOf)}</span>
            </li>
          ))}
        </ul>
      )}

      {hasUser && (
        <ul className={`space-y-1.5 text-sm text-slate-200 ${hasAuto ? "mt-2 pt-2 border-t border-slate-800" : ""}`}>
          {me.userNotes.map((text, i) => (
            <li key={`user-${i}`} className="flex items-start gap-2 group">
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
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

function describeNote(n: PrivateView["notes"][number], nameOf: (id: string) => string): string {
  switch (n.kind) {
    case "doppelganger_copied":
      return `You copied ${nameOf(n.targetId)} and became ${ROLE_META[n.role].label}.`;
    case "fellow_werewolves":
      return `Other werewolves: ${n.playerIds.map(nameOf).join(", ") || "(none)"}.`;
    case "lone_wolf_center":
      return `You peeked center card ${n.index + 1}: ${ROLE_META[n.role].label}.`;
    case "minion_sees_werewolves":
      return n.playerIds.length === 0
        ? "There are no Werewolves in play."
        : `Werewolves: ${n.playerIds.map(nameOf).join(", ")}.`;
    case "fellow_mason":
      return `Other Masons: ${n.playerIds.map(nameOf).join(", ")}.`;
    case "no_other_masons":
      return "There is no other Mason in play.";
    case "seer_player":
      return `${nameOf(n.playerId)}'s card is ${ROLE_META[n.role].label}.`;
    case "seer_center":
      return `Center cards — ${n.cards
        .map((c) => `${c.index + 1}: ${ROLE_META[c.role].label}`)
        .join("; ")}.`;
    case "robber_new_role":
      return `You robbed ${nameOf(n.targetId)} and now hold ${ROLE_META[n.role].label}.`;
    case "insomniac_self":
      return `Your card is now ${ROLE_META[n.role].label}.`;
  }
}
