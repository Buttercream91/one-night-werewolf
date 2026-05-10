import { useState } from "react";
import type { PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { playerColor } from "../playerColor.js";
import { send } from "../socket.js";
import { useCountdown } from "../useCountdown.js";
import { ActiveDeckPanel } from "./ActiveDeckPanel.js";
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
  const remaining = useCountdown(room.dayEndsAt, "floor");
  const accusations = room.accusations ?? [];
  // Which player tile currently has its role-picker expanded for me to choose
  // an accusation. Only one open at a time to keep the grid compact.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  // De-duplicated roles in this round's deck, kept in the deck's order so the
  // wolves come first.
  const deckRoles = Array.from(new Set(room.selectedRoles));
  // Spectators don't appear in the player tile grid — they're not part of
  // the round and can't be voted for, accused, or held responsible for ready.
  const activePlayers = room.players.filter((p) => !p.spectating);
  const activeConnected = activePlayers.filter((p) => p.connected);

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

      <ActiveDeckPanel roles={room.selectedRoles} />

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Players</h3>
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {activePlayers.map((p) => {
                const ready = (room.readyPlayerIds ?? []).includes(p.id);
                const accusationsAgainst = accusations.filter((a) => a.targetId === p.id);
                const myAccusationOnP = accusationsAgainst.find((a) => a.accuserId === me.myId);
                const isOpen = pickingFor === p.id;
                const nameCls = playerColor(p.id, room.players);
                return (
                  <li
                    key={p.id}
                    className={`rounded-md border px-3 py-3 text-sm ${
                      p.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`font-medium ${nameCls}`}>{p.name}</span>
                      {ready && <span className="text-xs text-emerald-300">ready</span>}
                    </div>
                    {accusationsAgainst.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {accusationsAgainst.map((a) => {
                          const accuser = room.players.find((x) => x.id === a.accuserId);
                          const accuserCls = playerColor(a.accuserId, room.players);
                          return (
                            <li key={a.accuserId} className={`text-xs ${accuserCls}`}>
                              {accuser?.name ?? "?"} accuses {p.name} of being{" "}
                              <span className="font-medium">{ROLE_META[a.role].label}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="mt-2">
                      {isOpen ? (
                        <AccusePicker
                          deckRoles={deckRoles}
                          onPick={(role) => {
                            send.accuse(p.id, role);
                            setPickingFor(null);
                          }}
                          onClose={() => setPickingFor(null)}
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            className="text-xs text-indigo-300 hover:text-indigo-200 underline"
                            onClick={() => setPickingFor(p.id)}
                          >
                            {myAccusationOnP ? "Change" : "Accuse"}
                          </button>
                          {myAccusationOnP && (
                            <button
                              className="text-xs text-slate-400 hover:text-slate-300"
                              onClick={() => send.accuse(p.id, null)}
                              title="Clear my accusation against this player"
                            >
                              clear
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex items-center justify-end gap-3">
              <span className="text-xs text-slate-400">
                {(room.readyPlayerIds ?? []).filter((id) =>
                  activeConnected.some((p) => p.id === id),
                ).length}
                /{activeConnected.length} ready
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

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function AccusePicker({
  deckRoles,
  onPick,
  onClose,
}: {
  deckRoles: Role[];
  onPick: (role: Role) => void;
  onClose: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-700 bg-slate-900 p-2">
      <div className="text-xs text-slate-400 mb-1.5">Accuse of being…</div>
      <div className="flex flex-wrap gap-1">
        {deckRoles.map((role) => (
          <button
            key={role}
            className="text-xs px-2 py-0.5 rounded border border-slate-700 hover:border-indigo-500 hover:bg-indigo-950/50"
            onClick={() => onPick(role)}
          >
            {ROLE_META[role].label}
          </button>
        ))}
        <button
          className="text-xs px-2 py-0.5 rounded text-slate-400 hover:text-slate-200"
          onClick={onClose}
        >
          cancel
        </button>
      </div>
    </div>
  );
}
