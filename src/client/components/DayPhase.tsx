import { useEffect, useState } from "react";
import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { send } from "../socket.js";
import { CenterCards } from "./CenterCards.js";
import { NotesPanel } from "./NotesPanel.js";
import { RoleCard } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function DayPhase({ room, me }: Props) {
  const myRole = me.cardFaceDown ? undefined : (me.myKnownCurrentRole ?? me.myOriginalRole);
  const isReady = (room.readyPlayerIds ?? []).includes(me.myId);
  const remaining = useCountdown(room.dayEndsAt);

  return (
    <div className="space-y-6">
      <div className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="heading text-xl text-indigo-200">Day phase — discuss</h2>
          <p className="text-sm text-slate-400">
            Hop on a voice call and talk it out. Find the wolves before voting.
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-3xl text-slate-100">{formatTime(remaining)}</div>
          <div className="text-xs text-slate-400">until vote</div>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Players</h3>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {room.players.map((p) => {
                const ready = (room.readyPlayerIds ?? []).includes(p.id);
                return (
                  <li
                    key={p.id}
                    className={`rounded-md border px-3 py-2 text-sm ${
                      p.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900 text-slate-500"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      {ready && <span className="text-xs text-emerald-300">ready</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex items-center justify-end gap-3">
              <span className="text-xs text-slate-400">
                {(room.readyPlayerIds ?? []).length}/
                {room.players.filter((p) => p.connected).length} ready
              </span>
              <button
                className={isReady ? "btn-ghost" : "btn-primary"}
                onClick={() => send.dayReady(!isReady)}
              >
                {isReady ? "Cancel ready" : "Ready to vote"}
              </button>
            </div>
          </div>

          <NotesPanel me={me} room={room} />
        </div>

        <div className="panel flex flex-col items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-slate-400">Your card</span>
          {myRole ? (
            <RoleCard role={myRole} />
          ) : me.cardFaceDown ? (
            <RoleCard faceDown caption="Unknown" />
          ) : null}
        </div>
      </div>

      <CenterCards me={me} mode="view" selected={[]} setSelected={() => {}} />
    </div>
  );
}

function useCountdown(endsAt?: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return 0;
  return Math.max(0, Math.floor((endsAt - now) / 1000));
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
