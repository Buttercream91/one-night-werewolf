import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
          const n = counts[role]!;
          return <RoleChip key={role} role={role} count={n} />;
        })}
      </ul>
    </div>
  );
}

// Single chip with a hover-portaled tooltip. Position is computed from the
// chip's bounding rect and clamped within the viewport so a chip near the
// right or bottom edge doesn't push the tooltip off-screen.
function RoleChip({ role, count }: { role: Role; count: number }) {
  const [hover, setHover] = useState(false);
  const liRef = useRef<HTMLLIElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const meta = ROLE_META[role];
  const teamCls =
    meta.team === "werewolf"
      ? "border-rose-800 bg-rose-950/50 text-rose-200"
      : meta.team === "tanner"
        ? "border-amber-800 bg-amber-950/50 text-amber-200"
        : "border-slate-700 bg-slate-800 text-slate-200";

  // Width of the tooltip in px (matches w-64 below). Used for clamping.
  const TOOLTIP_W = 256;
  const MARGIN = 8;

  useLayoutEffect(() => {
    if (!hover) return;
    function reposition() {
      const el = liRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Prefer centering on the chip, but clamp to within viewport.
      const ideal = r.left + r.width / 2 - TOOLTIP_W / 2;
      const left = Math.max(MARGIN, Math.min(window.innerWidth - TOOLTIP_W - MARGIN, ideal));
      const top = r.bottom + 6;
      setPos({ top, left });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [hover]);

  return (
    <li
      ref={liRef}
      className={`rounded-md border px-2.5 py-1 text-sm cursor-help ${teamCls}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {meta.label}
      {count > 1 && <span className="ml-1 text-xs opacity-80">×{count}</span>}
      {hover &&
        pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[99999] isolate w-64 rounded-md border border-slate-700 bg-slate-900 p-3 text-xs leading-relaxed text-slate-200 shadow-xl"
            style={{ top: pos.top, left: pos.left }}
          >
            <div className="font-medium text-slate-100 mb-1">{meta.label}</div>
            <div className="text-slate-300">{meta.description}</div>
          </div>,
          document.body,
        )}
    </li>
  );
}
