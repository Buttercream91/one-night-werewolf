import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { useCountdown } from "../useCountdown.js";
import { ActiveDeckPanel } from "./ActiveDeckPanel.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function SpectatorView({ room, me }: Props) {
  const phaseLabel =
    room.phase === "night"
      ? "Night phase"
      : room.phase === "day"
        ? "Day phase — discussion"
        : room.phase === "vote"
          ? "Vote phase"
          : "Reveal";

  const dayRemaining = useCountdown(room.dayEndsAt, "floor");
  const nightRemaining = useCountdown(room.nightStepEndsAt);
  const accusations = room.accusations ?? [];
  const votesCast = room.players.filter((p) => p.votedFor != null).length;
  const readyCount = (room.readyPlayerIds ?? []).length;

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="heading text-xl text-slate-300">Spectating</h2>
            <p className="text-sm text-slate-400 mt-1">
              You stepped back to the lobby. The round is still in progress — your card is in
              play but you're not acting. You'll be back in the lobby once the round ends.
            </p>
          </div>
          <span className="text-xs uppercase tracking-wider text-indigo-300 px-2 py-1 rounded border border-indigo-700 bg-indigo-950/50">
            {phaseLabel}
          </span>
        </div>
        {room.phase === "night" && (
          <div className="mt-3 text-sm text-slate-400">
            <span className="font-mono text-slate-200">{nightRemaining}s</span> until the next
            role.
          </div>
        )}
        {room.phase === "day" && (
          <div className="mt-3 text-sm text-slate-400">
            <span className="font-mono text-slate-200">
              {Math.floor(dayRemaining / 60)}:{(dayRemaining % 60).toString().padStart(2, "0")}
            </span>{" "}
            until the vote ·{" "}
            <span className="text-slate-300">
              {readyCount}/{room.players.filter((p) => p.connected).length} ready
            </span>
          </div>
        )}
        {room.phase === "vote" && (
          <div className="mt-3 text-sm text-slate-400">
            <span className="text-slate-200">
              {votesCast}/{room.players.length}
            </span>{" "}
            votes cast.
          </div>
        )}
      </div>

      <ActiveDeckPanel roles={room.selectedRoles} />

      <div className="panel">
        <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Players</h3>
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {room.players.map((p) => {
            const ready = (room.readyPlayerIds ?? []).includes(p.id);
            const voted = p.votedFor != null;
            const isSelf = p.id === me.myId;
            const accusationsAgainst = accusations.filter((a) => a.targetId === p.id);
            return (
              <li
                key={p.id}
                className={`rounded-md border px-3 py-3 text-sm ${
                  p.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {p.name}
                    {isSelf && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                  </span>
                  {p.spectating ? (
                    <span className="text-xs text-slate-400">spectating</span>
                  ) : room.phase === "day" && ready ? (
                    <span className="text-xs text-emerald-300">ready</span>
                  ) : room.phase === "vote" && voted ? (
                    <span className="text-xs text-emerald-300">voted</span>
                  ) : null}
                </div>
                {accusationsAgainst.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {accusationsAgainst.map((a) => {
                      const accuser = room.players.find((x) => x.id === a.accuserId);
                      return (
                        <li key={a.accuserId} className="text-xs text-amber-200">
                          {accuser?.name ?? "?"} accuses {p.name} of being{" "}
                          <span className="font-medium">{ROLE_META[a.role].label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
