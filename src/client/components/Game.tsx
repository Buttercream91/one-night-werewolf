import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { DayPhase } from "./DayPhase.js";
import { NightPhase } from "./NightPhase.js";
import { RevealPhase } from "./RevealPhase.js";
import { SpectatorView } from "./SpectatorView.js";
import { VotePhase } from "./VotePhase.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
}

export function Game({ room, me }: Props) {
  if (!me) return <div className="mx-auto max-w-md panel text-center">Loading…</div>;
  // Spectators get the public-info-only view for everything except reveal
  // (reveal is already all-public, so the normal screen works fine for them).
  const iAmSpectating = !!room.players.find((p) => p.id === me.myId)?.spectating;
  if (iAmSpectating && room.phase !== "reveal") {
    return (
      <div className="mx-auto max-w-7xl">
        <SpectatorView room={room} me={me} />
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
