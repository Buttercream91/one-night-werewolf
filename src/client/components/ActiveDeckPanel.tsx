import type { Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";

interface Props {
  roles: Role[];
}

export function ActiveDeckPanel({ roles }: Props) {
  const counts: Partial<Record<Role, number>> = {};
  for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;

  // Sort by team (werewolf, then villager, then tanner) to keep the wolves
  // visually grouped at the front of the list.
  const teamOrder = { werewolf: 0, villager: 1, tanner: 2 } as const;
  const entries = (Object.keys(counts) as Role[]).sort((a, b) => {
    const ta = teamOrder[ROLE_META[a].team];
    const tb = teamOrder[ROLE_META[b].team];
    if (ta !== tb) return ta - tb;
    return ROLE_META[a].label.localeCompare(ROLE_META[b].label);
  });

  return (
    <div className="panel">
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">
        Active deck <span className="text-slate-500">({roles.length} cards — 3 in centre)</span>
      </h3>
      <ul className="flex flex-wrap gap-2">
        {entries.map((role) => {
          const meta = ROLE_META[role];
          const n = counts[role]!;
          const teamCls =
            meta.team === "werewolf"
              ? "border-rose-800 bg-rose-950/50 text-rose-200"
              : meta.team === "tanner"
                ? "border-amber-800 bg-amber-950/50 text-amber-200"
                : "border-slate-700 bg-slate-800 text-slate-200";
          return (
            <li
              key={role}
              className={`rounded-md border px-2.5 py-1 text-sm ${teamCls}`}
            >
              {meta.label}
              {n > 1 && <span className="ml-1 text-xs opacity-80">×{n}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
