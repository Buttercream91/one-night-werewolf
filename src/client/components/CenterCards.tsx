import type { PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { send } from "../socket.js";
import { RoleCard } from "./RoleCard.js";

export type CenterMode =
  | "view"
  | "lone-wolf"
  | "seer-center"
  | "drunk"
  | "apprentice-seer"
  | "witch-peek";

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
  const seenByIndex = peekedCenters(me, room);
  // centerCardCount is set once the round begins; before then we don't render
  // (CenterCards is only used in night/day/vote/reveal phases).
  const count = room.centerCardCount ?? 3;

  function onPick(index: number) {
    if (mode === "lone-wolf") {
      send.nightAction({ kind: "werewolf_lone_view", centerIndex: index });
    } else if (mode === "apprentice-seer") {
      send.nightAction({ kind: "apprentice_seer_view", centerIndex: index });
    } else if (mode === "witch-peek") {
      send.nightAction({ kind: "witch_peek_center", centerIndex: index });
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

  // Has this player ever seen any centre card (lone-wolf or seer)? If so,
  // when their step ends we hide the peek — they may be wondering why the
  // centre is suddenly blank, so we show a small hint pointing them at notes.
  const hasPriorPeek = me.notes.some(
    (n) => n.kind === "lone_wolf_center" || n.kind === "seer_center",
  );
  const noActivePeek = seenByIndex.size === 0;
  return (
    <div className="panel">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm uppercase tracking-wider text-slate-400">
          Centre cards{count !== 3 && ` (${count})`}
        </span>
        <span className="text-xs text-slate-500">{labelForMode(mode)}</span>
      </div>
      <div className="flex justify-center items-center gap-4 flex-wrap">
        {Array.from({ length: count }, (_, i) => {
          const peekedRole = seenByIndex.get(i);
          const isSelected = mode === "seer-center" && selected.includes(i);
          const interactive = mode !== "view" && peekedRole === undefined;
          const isHorizontal = room.horizontalCenterIndex === i;
          return (
            <div
              key={i}
              className={isHorizontal ? "rotate-90 my-4" : ""}
              title={
                isHorizontal
                  ? "Centre wolf card — placed by the Alpha Wolf mechanic"
                  : undefined
              }
            >
              <RoleCard
                role={peekedRole}
                size="sm"
                caption={
                  isHorizontal
                    ? `Wolf card`
                    : `Centre ${i + 1}`
                }
                faceDown={peekedRole === undefined}
                highlight={isSelected ? "selected" : peekedRole !== undefined ? "peeked" : null}
                onClick={interactive ? () => onPick(i) : undefined}
              />
            </div>
          );
        })}
      </div>
      {hasPriorPeek && noActivePeek && (
        <p className="mt-3 text-center text-xs text-slate-500 italic">
          Centre is hidden between role turns — check Your Notes for what you saw earlier.
        </p>
      )}
    </div>
  );
}

function labelForMode(mode: CenterMode): string {
  switch (mode) {
    case "lone-wolf":
      return "Click a card to peek";
    case "apprentice-seer":
      return "Click one card to peek";
    case "witch-peek":
      return "Click a card to peek (you must then swap it with a player)";
    case "seer-center":
      return "Pick 2 cards to peek";
    case "drunk":
      return "Click a card to swap (you won't see it)";
    case "view":
      return "Hidden until peeked or end of game";
  }
}

// Build a map of centerIndex → revealed role from the player's accumulated
// notes. Peeks are only shown face-up during the role's own night step —
// after the step ends the centre flips back face-down for that player too,
// matching real ONUW play where you only see the cards while it's your turn.
// The notes panel still recalls what was seen so the player can reference it
// during the day.
function peekedCenters(me: PrivateView, room: PublicRoom): Map<number, Role> {
  const m = new Map<number, Role>();
  const step = room.nightStep;
  if (!step) return m;
  // Lone wolf peeked → only visible during the werewolves step.
  const wolfActing = step === "werewolves";
  // Seer (real or DG-as-Seer) peeked → visible during the seer step OR the
  // doppelganger_act step (when a DG-as-Seer is the one acting).
  const seerActing =
    step === "seer" ||
    (step === "doppelganger_act" && me.myOriginalRole === "doppelganger");
  // Apprentice Seer peeked → visible during their step (or doppelganger_act
  // if a DG-as-Apprentice-Seer is acting).
  const appSeerActing =
    step === "apprentice_seer" ||
    (step === "doppelganger_act" && me.myOriginalRole === "doppelganger");
  // Witch peeked → visible during their step (or doppelganger_act if
  // DG-as-Witch is acting). Their note kind is witch_swapped — the role
  // is recorded as peekedRole before the swap fired.
  const witchActing =
    step === "witch" ||
    (step === "doppelganger_act" && me.myOriginalRole === "doppelganger");
  for (const n of me.notes) {
    if (n.kind === "lone_wolf_center" && wolfActing) {
      m.set(n.index, n.role);
    } else if (n.kind === "seer_center" && seerActing) {
      for (const c of n.cards) m.set(c.index, c.role);
    } else if (n.kind === "apprentice_seer_center" && appSeerActing) {
      m.set(n.index, n.role);
    } else if (n.kind === "witch_swapped" && witchActing) {
      m.set(n.centerIndex, n.peekedRole);
    }
  }
  return m;
}
