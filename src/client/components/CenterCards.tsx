import type { PrivateView, Role } from "../../shared/types.js";
import { send } from "../socket.js";
import { RoleCard } from "./RoleCard.js";

export type CenterMode = "view" | "lone-wolf" | "seer-center" | "drunk";

interface Props {
  me: PrivateView;
  mode: CenterMode;
  // Used by seer-center mode to allow building a 2-card selection across renders.
  selected: number[];
  setSelected: (next: number[]) => void;
}

// The 3 face-down center cards visible to all players. Cards a player has
// already peeked (Seer / Lone wolf) are flipped to show the role for that
// player only. Mode controls click behaviour:
//   view        — non-interactive, just display.
//   lone-wolf   — click flips and reveals; sends werewolf_lone_view.
//   seer-center — click toggles selection; on second pick sends seer_view_center.
//   drunk       — click swaps with player's hand; player's view becomes face-down.
export function CenterCards({ me, mode, selected, setSelected }: Props) {
  const seenByIndex = peekedCenters(me);

  function onPick(index: 0 | 1 | 2) {
    if (mode === "lone-wolf") {
      send.nightAction({ kind: "werewolf_lone_view", centerIndex: index });
    } else if (mode === "drunk") {
      send.nightAction({ kind: "drunk_swap", centerIndex: index });
    } else if (mode === "seer-center") {
      if (selected.includes(index)) {
        setSelected(selected.filter((x) => x !== index));
      } else if (selected.length < 2) {
        const next = [...selected, index];
        if (next.length === 2) {
          send.nightAction({
            kind: "seer_view_center",
            indices: next as [0 | 1 | 2, 0 | 1 | 2],
          });
        }
        setSelected(next);
      }
    }
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm uppercase tracking-wider text-slate-400">Center cards</span>
        <span className="text-xs text-slate-500">{labelForMode(mode)}</span>
      </div>
      <div className="flex justify-center gap-4">
        {[0, 1, 2].map((i) => {
          const idx = i as 0 | 1 | 2;
          const peekedRole = seenByIndex.get(idx);
          const isSelected = mode === "seer-center" && selected.includes(idx);
          const interactive = mode !== "view" && peekedRole === undefined;
          return (
            <RoleCard
              key={i}
              role={peekedRole}
              size="sm"
              caption={`Center ${i + 1}`}
              faceDown={peekedRole === undefined}
              highlight={isSelected ? "selected" : peekedRole !== undefined ? "peeked" : null}
              onClick={interactive ? () => onPick(idx) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function labelForMode(mode: CenterMode): string {
  switch (mode) {
    case "lone-wolf":
      return "Click a card to peek";
    case "seer-center":
      return "Pick 2 cards to peek";
    case "drunk":
      return "Click a card to swap (you won't see it)";
    case "view":
      return "Hidden until peeked or end of game";
  }
}

// Build a map of centerIndex → revealed role from the player's accumulated notes.
function peekedCenters(me: PrivateView): Map<0 | 1 | 2, Role> {
  const m = new Map<0 | 1 | 2, Role>();
  for (const n of me.notes) {
    if (n.kind === "lone_wolf_center") {
      m.set(n.index, n.role);
    } else if (n.kind === "seer_center") {
      for (const c of n.cards) m.set(c.index, c.role);
    }
  }
  return m;
}
