import type { PublicRoom, Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { playerColor } from "../playerColor.js";

// Small inline chip for a role. Team colours match the rest of the UI
// (rose=wolf, amber=tanner, emerald=villager) so a glance at any auto-note
// or game-log line tells you which team a referenced role belongs to.
export function RoleChip({ role }: { role: Role }) {
  const meta = ROLE_META[role];
  const cls =
    meta.team === "werewolf"
      ? "bg-rose-950 border-rose-800 text-rose-200"
      : meta.team === "tanner"
        ? "bg-amber-950 border-amber-800 text-amber-200"
        : "bg-emerald-950 border-emerald-800 text-emerald-200";
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0 text-[0.7rem] font-medium align-baseline ${cls}`}
    >
      {meta.label}
    </span>
  );
}

// Inline player name styled with that player's display colour — the same
// palette used in the day-phase tile grid and chat.
export function PlayerChip({ id, room }: { id: string; room: PublicRoom }) {
  const name = room.players.find((p) => p.id === id)?.name ?? "?";
  const cls = playerColor(id, room.players);
  return <span className={`font-medium ${cls}`}>{name}</span>;
}

// Comma-separated player chips with "and" before the last. Empty list reads
// "(none)".
export function PlayerList({ ids, room }: { ids: string[]; room: PublicRoom }) {
  if (ids.length === 0) return <span className="text-slate-400">(none)</span>;
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && (i === ids.length - 1 ? <span> and </span> : <span>, </span>)}
          <PlayerChip id={id} room={room} />
        </span>
      ))}
    </>
  );
}
