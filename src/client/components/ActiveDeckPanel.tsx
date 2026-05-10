import type { Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";

interface Props {
  roles: Role[];
}

// The sequence the moderator calls roles in during the night phase.
// Roles with no night turn (Hunter, Tanner, Villager) trail at the end.
const NIGHT_CALL_ORDER: Role[] = [
  "doppelganger",
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "hunter",
  "tanner",
  "villager",
];

export function ActiveDeckPanel({ roles }: Props) {
  const counts: Partial<Record<Role, number>> = {};
  for (const r of roles) counts[r] = (counts[r] ?? 0) + 1;

  const entries = (Object.keys(counts) as Role[]).sort(
    (a, b) => NIGHT_CALL_ORDER.indexOf(a) - NIGHT_CALL_ORDER.indexOf(b),
  );

  return (
    // relative + z-20 raises this whole panel into a stacking context above
    // its sibling panels (which are z-auto). Without it, the description
    // tooltip — which extends below the chip — gets painted under the next
    // panel in DOM order (Players in Day phase).
    <div className="panel relative z-20">
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">
        Active deck{" "}
        <span className="text-slate-500">
          ({roles.length} cards — 3 in centre, listed in night-call order)
        </span>
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
              className={`relative group rounded-md border px-2.5 py-1 text-sm cursor-help ${teamCls}`}
            >
              {meta.label}
              {n > 1 && <span className="ml-1 text-xs opacity-80">×{n}</span>}
              {/* Hover tooltip with the role's full description. */}
              <div className="pointer-events-none absolute z-30 hidden group-hover:block left-1/2 -translate-x-1/2 top-full mt-2 w-64 rounded-md border border-slate-700 bg-slate-900 p-3 text-xs leading-relaxed text-slate-200 shadow-xl">
                <div className="font-medium text-slate-100 mb-1">{meta.label}</div>
                <div className="text-slate-300">{meta.description}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
