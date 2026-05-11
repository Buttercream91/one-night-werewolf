import { useEffect } from "react";
import type { PrivateView, PublicRoom, Role, WinnerSide } from "../../shared/types.js";
import { DEFAULT_VOICE_PACK, ROLE_META } from "../../shared/types.js";
import { send } from "../socket.js";
import { loadNarrator } from "../storage.js";
import { DevModeTag } from "./DevModeTag.js";
import { GameLog } from "./GameLog.js";
import { NotesPanel } from "./NotesPanel.js";
import { RoleCard } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function RevealPhase({ room, me }: Props) {
  const winners = room.winners ?? [];
  const myFinal = room.players.find((p) => p.id === me.myId)?.finalRole;
  const iWon = !!myFinal && playerWon(myFinal, winners);
  const isHost = !!room.players.find((p) => p.id === me.myId)?.isHost;

  // Play the winner-declaration audio once when this phase mounts. Uses the
  // viewer's own narrator preference.
  useEffect(() => {
    const file = pickWinnerFile(winners);
    if (!file) return;
    const pack = loadNarrator() ?? DEFAULT_VOICE_PACK;
    const a = new Audio(`/voice/${pack}/${file}.mp3`);
    a.play().catch(() => {});
  }, []);

  function nameOf(id: string) {
    return room.players.find((p) => p.id === id)?.name ?? "?";
  }

  return (
    <div className="space-y-6">
      <div className={`panel text-center ${iWon ? "ring-2 ring-emerald-500" : "ring-2 ring-rose-500"}`}>
        <h2 className="heading text-2xl">
          {winners.length === 0 ? "Stalemate" : winners.map(winnerLabel).join(" & ")}{" "}
          {winners.length === 0 ? "" : "win"}
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          You {iWon ? "won" : "lost"} this round.
        </p>
      </div>

      <div className="panel">
        <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Players</h3>
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {room.players
            .filter((p) => !p.spectating && p.originalRole)
            .map((p) => {
            const orig = p.originalRole!;
            const final = p.finalRole!;
            const swapped = orig !== final;
            const won = playerWon(final, winners);
            return (
              <li
                key={p.id}
                className={`rounded-lg border p-3 ${
                  p.killed ? "border-rose-700 bg-rose-950/30" : "border-slate-700 bg-slate-900"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">
                      {p.name}
                      <DevModeTag show={!!room.devMode && p.isHost} />
                    </div>
                    <div className="text-xs text-slate-400">
                      voted{" "}
                      <span className="text-slate-300">
                        {p.votedFor === "no_kill"
                          ? "no one"
                          : p.votedFor
                            ? nameOf(p.votedFor)
                            : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    {p.killed && <div className="text-rose-300">killed</div>}
                    <div className={won ? "text-emerald-300" : "text-slate-500"}>
                      {won ? "won" : "lost"}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-end gap-3">
                  <RoleCard role={final} size="sm" caption={swapped ? `was ${ROLE_META[orig].label}` : "original"} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="panel">
        <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Center cards</h3>
        <div className="flex flex-wrap items-end gap-3">
          {(room.centerCards ?? []).map((r, i) => (
            <RoleCard key={i} role={r} size="sm" caption={`Center ${i + 1}`} />
          ))}
        </div>
      </div>

      <GameLog room={room} />

      <NotesPanel me={me} room={room} allowAdding={false} />

      {isHost && (
        <div className="panel flex justify-end">
          <button className="btn-primary" onClick={() => send.reset()}>
            New game
          </button>
        </div>
      )}
    </div>
  );
}

// Audio file (without extension) under /voice/<pack>/ for the winning side.
// We pick a single dominant announcement: villagers > tanner > werewolves.
// Returns null for stalemate.
function pickWinnerFile(winners: WinnerSide[]): string | null {
  if (winners.includes("villager")) return "VillagersWin";
  if (winners.includes("tanner")) return "TannerWins";
  if (winners.includes("werewolf") || winners.includes("minion")) return "WerewolvesWin";
  return null;
}

function winnerLabel(w: WinnerSide): string {
  switch (w) {
    case "werewolf":
      return "Werewolves";
    case "villager":
      return "Villagers";
    case "tanner":
      return "Tanner";
    case "minion":
      return "Minion";
    case "hunter_target":
      return "Hunter target";
  }
}

function playerWon(finalRole: Role, winners: WinnerSide[]): boolean {
  const team = ROLE_META[finalRole].team;
  if (finalRole === "minion") {
    return winners.includes("werewolf") || winners.includes("minion");
  }
  if (team === "werewolf") return winners.includes("werewolf");
  if (team === "tanner") return winners.includes("tanner");
  return winners.includes("villager");
}
