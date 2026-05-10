import { useEffect } from "react";
import type { PrivateView, PublicRoom } from "../../shared/types.js";
import { DEFAULT_VOICE_PACK } from "../../shared/types.js";
import { send } from "../socket.js";
import { loadNarrator } from "../storage.js";
import { ActiveDeckPanel } from "./ActiveDeckPanel.js";
import { CenterCards } from "./CenterCards.js";
import { NotesPanel } from "./NotesPanel.js";
import { RoleCard } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function VotePhase({ room, me }: Props) {
  const myVote = room.players.find((p) => p.id === me.myId)?.votedFor ?? null;
  // Spectators are out of the round — not vote targets and not vote sources.
  const activePlayers = room.players.filter((p) => !p.spectating);
  const total = activePlayers.length;
  const cast = activePlayers.filter((p) => p.votedFor != null).length;
  const myRole = me.cardFaceDown ? undefined : (me.myKnownCurrentRole ?? me.myOriginalRole);

  // Play the "begin vote" announcement once when this phase mounts. Each
  // player hears their own narrator pick (loaded from localStorage).
  useEffect(() => {
    const pack = loadNarrator() ?? DEFAULT_VOICE_PACK;
    const a = new Audio(`/voice/${pack}/BeginVote.mp3`);
    a.play().catch(() => {});
    // Don't pause on unmount — let it finish.
  }, []);

  return (
    <div className="space-y-6">
      <div className="panel">
        <h2 className="heading text-xl text-indigo-200">Vote</h2>
        <p className="text-sm text-slate-400 mt-1">
          Pick the player you want to kill. The reveal happens once everyone has voted.
        </p>
        <div className="mt-2 text-xs text-slate-400">
          {cast}/{total} votes cast
        </div>
      </div>

      <ActiveDeckPanel roles={room.selectedRoles} />

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {activePlayers.map((p) => {
                const selected = myVote === p.id;
                const isSelf = p.id === me.myId;
                return (
                  <li key={p.id}>
                    <button
                      className={`w-full rounded-md border px-3 py-3 text-left transition ${
                        selected
                          ? "border-rose-500 bg-rose-950"
                          : "border-slate-700 bg-slate-800 hover:bg-slate-700"
                      }`}
                      onClick={() => send.vote(p.id)}
                    >
                      <div className="font-medium text-slate-100">
                        {p.name}
                        {isSelf && <span className="ml-1 text-xs text-slate-400">(you)</span>}
                      </div>
                      <div className="text-xs text-slate-400">
                        {selected ? "Your vote" : "Vote to kill"}
                      </div>
                    </button>
                  </li>
                );
              })}
              <li>
                <button
                  className={`w-full rounded-md border px-3 py-3 text-left transition ${
                    myVote === "no_kill"
                      ? "border-amber-500 bg-amber-950"
                      : "border-slate-700 bg-slate-800 hover:bg-slate-700"
                  }`}
                  onClick={() => send.vote("no_kill")}
                >
                  <div className="font-medium text-slate-100">No one (abstain)</div>
                  <div className="text-xs text-slate-400">Doesn't add a vote to anyone</div>
                </button>
              </li>
            </ul>
            <p className="text-xs text-slate-400 mt-4">
              Tip: per the rulebook, no one dies unless someone gets at least 2 votes; ties die
              together.
            </p>
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
