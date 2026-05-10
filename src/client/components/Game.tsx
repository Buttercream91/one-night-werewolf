import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { DayPhase } from "./DayPhase.js";
import { NightPhase } from "./NightPhase.js";
import { RevealPhase } from "./RevealPhase.js";
import { VotePhase } from "./VotePhase.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
}

export function Game({ room, me }: Props) {
  if (!me) return <div className="mx-auto max-w-md panel text-center">Loading…</div>;
  return (
    <div className="mx-auto max-w-7xl">
      {room.phase === "night" && <NightPhase room={room} me={me} />}
      {room.phase === "day" && <DayPhase room={room} me={me} />}
      {room.phase === "vote" && <VotePhase room={room} me={me} />}
      {room.phase === "reveal" && <RevealPhase room={room} me={me} />}
    </div>
  );
}
