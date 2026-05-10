import type { PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { send } from "../socket.js";
import { RoleCard } from "./RoleCard.js";

export type CenterMode = "view" | "lone-wolf" | "seer-center" | "drunk";

interface Props {
  me: PrivateView;
  room: PublicRoom;
  mode: CenterMode;
  // Used by seer-center mode to allow building a 2-card selection across renders.
  selected: number[];
  setSelected: (next: number[]) => void;
}

// The face-down centre cards visible to all players. Default is 3, but the
// host can lift the deck-size cap so the centre may be larger. Cards a
// player has already peeked (Seer / Lone wolf) are flipped to show the role
// for that player only. Mode controls click behaviour:
//   view        — non-interactive, just display.
//   lone-wolf   — click flips and reveals; sends werewolf_lone_view.
//   seer-center — click toggles selection; on second pick sends seer_view_center.
//   drunk       — click swaps with player's hand; player's view becomes face-down.
export function CenterCards({ me, room, mode, selected, setSelected }: Props) {
  const seenByIndex = peekedCenters(me);
  // centerCardCount is set once the round begins; before then we don't render
  // (CenterCards is only used in night/day/vote/reveal phases).
  const count = room.centerCardCount ?? 3;

  function onPick(index: number) {
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
            indices: [next[0], next[1]],
          });
        }
        setSelected(next);
      }
    }
  }

  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm uppercase tracking-wider text-slate-400">
          Centre cards{count !== 3 && ` (${count})`}
        </span>
        <span className="text-xs text-slate-500">{labelForMode(mode)}</span>
      </div>
      <div className="flex justify-center gap-4 flex-wrap">
        {Array.from({ length: count }, (_, i) => {
          const peekedRole = seenByIndex.get(i);
          const isSelected = mode === "seer-center" && selected.includes(i);
          const interactive = mode !== "view" && peekedRole === undefined;
          return (
            <RoleCard
              key={i}
              role={peekedRole}
              size="sm"
              caption={`Centre ${i + 1}`}
              faceDown={peekedRole === undefined}
              highlight={isSelected ? "selected" : peekedRole !== undefined ? "peeked" : null}
              onClick={interactive ? () => onPick(i) : undefined}
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
function peekedCenters(me: PrivateView): Map<number, Role> {
  const m = new Map<number, Role>();
  for (const n of me.notes) {
    if (n.kind === "lone_wolf_center") {
      m.set(n.index, n.role);
    } else if (n.kind === "seer_center") {
      for (const c of n.cards) m.set(c.index, c.role);
    }
  }
  return m;
}
