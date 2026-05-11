import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { DayPhase } from "./DayPhase.js";
import { NightPhase } from "./NightPhase.js";
import { RevealPhase } from "./RevealPhase.js";
import { SpectatorView } from "./SpectatorView.js";
import { VotePhase } from "./VotePhase.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
  // Dev mode preview: render SpectatorView for the host without actually
  // spectating, by synthesising spectatorVision from devVision data.
  previewSpectator?: boolean;
}

export function Game({ room, me, previewSpectator }: Props) {
  if (!me) return <div className="mx-auto max-w-md panel text-center">Loading…</div>;
  // Spectators get the public-info-only view for everything except reveal
  // (reveal is already all-public, so the normal screen works fine for them).
  const iAmSpectating = !!room.players.find((p) => p.id === me.myId)?.spectating;
  const showSpectator = (iAmSpectating || !!previewSpectator) && room.phase !== "reveal";
  if (showSpectator) {
    // When previewing as a spectator, the host doesn't actually have a
    // spectatorVision field, but server's devVision (when devMode is on)
    // carries the same role + centre data — copy it across so SpectatorView
    // renders normally.
    const effectiveMe: PrivateView =
      me.spectatorVision || !me.devVision
        ? me
        : {
            ...me,
            spectatorVision: {
              players: me.devVision.players.map((v) => ({
                id: v.id,
                currentRole: v.currentRole,
                originalRole: v.originalRole,
                notes: v.notes,
                userNotes: v.userNotes,
              })),
              centerCards: me.devVision.centerCards,
            },
          };
    return (
      <div className="mx-auto max-w-7xl">
        {previewSpectator && !iAmSpectating && (
          <div className="mb-4 rounded-md border border-fuchsia-700 bg-fuchsia-950/40 px-3 py-2 text-xs text-fuchsia-200">
            🧪 Previewing the spectator view (dev mode). Real game state is unaffected — turn
            off via the dev panel.
          </div>
        )}
        <SpectatorView room={room} me={effectiveMe} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-7xl">
      {room.phase === "night" && <NightPhase room={room} me={me} />}
      {room.phase === "day" && <DayPhase room={room} me={me} />}
      {room.phase === "vote" && <VotePhase room={room} me={me} />}
      {room.phase === "reveal" && <RevealPhase room={room} me={me} />}
    </div>
  );
}
