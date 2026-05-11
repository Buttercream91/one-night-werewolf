import { useState } from "react";
import type { PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { playerColor } from "../playerColor.js";
import { send } from "../socket.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
  previewSpectator: boolean;
  onTogglePreview: () => void;
  onClose: () => void;
}

// Host-only dev panel revealed by clicking the "o" in Werewolf 5 times.
// The panel is shown to anyone who triggered it locally, but every action
// here is server-side gated to the host. Non-hosts will see error toasts if
// they try to run dev actions.
export function DevPanel({ room, me, previewSpectator, onTogglePreview, onClose }: Props) {
  const meIsHost = !!me && !!room.players.find((p) => p.id === me.myId)?.isHost;
  const phase = room.phase;
  const [botCount, setBotCount] = useState(3);
  const [voteTarget, setVoteTarget] = useState<string>("no_kill");
  const [manualRoles, setManualRoles] = useState<Record<string, Role>>({});

  const activePlayers = room.players.filter((p) => !p.spectating);
  const dedupRoles = Array.from(new Set(room.selectedRoles));

  function pickManualRole(playerId: string, role: Role | "") {
    setManualRoles((prev) => {
      const next = { ...prev };
      if (!role) delete next[playerId];
      else next[playerId] = role;
      return next;
    });
  }

  return (
    <div className="mx-auto max-w-7xl mb-4 rounded-md border border-fuchsia-700 bg-fuchsia-950/40 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="heading text-fuchsia-200">
          🧪 Dev panel
          {!meIsHost && (
            <span className="ml-2 text-xs text-amber-300">
              (not host — actions will error)
            </span>
          )}
        </h3>
        <button onClick={onClose} className="text-xs text-slate-300 hover:text-slate-100">
          Exit ✕
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {/* Server dev-mode toggle: gates dev:* server actions. */}
        <Section label="Server dev mode">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">
              {room.devMode
                ? "Enabled (god-view + all dev actions allowed)"
                : "Disabled (only the panel UI is showing)"}
            </span>
            <button
              className={room.devMode ? "btn-ghost text-xs px-2 py-1" : "btn-primary text-xs px-2 py-1"}
              onClick={() => send.devSetMode(!room.devMode)}
            >
              {room.devMode ? "Disable" : "Enable"}
            </button>
          </div>
        </Section>

        <Section label="Preview spectator view">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-300">
              {previewSpectator
                ? "Currently rendering the spectator UI on your screen."
                : "Render the spectator UI on your screen using dev god-view data."}
            </span>
            <button
              onClick={onTogglePreview}
              className={
                previewSpectator
                  ? "btn-ghost text-xs px-2 py-1"
                  : "btn-primary text-xs px-2 py-1"
              }
              title="Needs server dev mode on (host gets devVision)"
            >
              {previewSpectator ? "Stop preview" : "Preview"}
            </button>
          </div>
        </Section>

        <Section label="Speed multiplier">
          <div className="flex items-center gap-2">
            {[1, 2, 5, 10].map((m) => (
              <button
                key={m}
                onClick={() => send.devSetSpeed(m)}
                className={`text-xs px-2 py-1 rounded border ${
                  room.devSpeedMultiplier === m || (!room.devSpeedMultiplier && m === 1)
                    ? "border-fuchsia-400 bg-fuchsia-900/50 text-fuchsia-100"
                    : "border-slate-700 hover:border-slate-500"
                }`}
              >
                {m}×
              </button>
            ))}
            <span className="text-xs text-slate-400 ml-1">
              Affects upcoming night steps + day timer
            </span>
          </div>
        </Section>

        {phase === "lobby" && (
          <>
            <Section label="Bots">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={botCount}
                  onChange={(e) => setBotCount(Number(e.target.value))}
                  className="input w-16 text-sm"
                />
                <button
                  onClick={() => send.devAddBots(botCount, false)}
                  className="btn-ghost text-xs px-2 py-1"
                >
                  + Players
                </button>
                <button
                  onClick={() => send.devAddBots(botCount, true)}
                  className="btn-ghost text-xs px-2 py-1"
                >
                  + Spectators
                </button>
                <button
                  onClick={() => send.devClearBots()}
                  className="text-xs px-2 py-1 rounded border border-rose-900 text-rose-300 hover:border-rose-700"
                >
                  Clear bots
                </button>
              </div>
            </Section>

            <Section label="Force start">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-300">
                  Bypass the ready-check. Optionally use manual roles set below.
                </span>
                <button
                  onClick={() =>
                    send.devForceStart(
                      Object.keys(manualRoles).length > 0 ? manualRoles : undefined,
                    )
                  }
                  className="btn-primary text-xs px-3 py-1"
                >
                  Force start
                </button>
              </div>
            </Section>

            <Section label="Manual roles" wide>
              <p className="text-xs text-slate-400 mb-2">
                Override the random deal. Unassigned slots get random picks from
                what's left in the deck.
              </p>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {activePlayers.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5">
                    <span
                      className={`text-xs ${playerColor(p.id, room.players)} truncate`}
                    >
                      {p.name}
                    </span>
                    <select
                      value={manualRoles[p.id] ?? ""}
                      onChange={(e) =>
                        pickManualRole(p.id, e.target.value as Role | "")
                      }
                      className="flex-1 text-xs bg-slate-800 border border-slate-700 rounded px-1 py-0.5"
                    >
                      <option value="">random</option>
                      {dedupRoles.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_META[r].label}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {phase === "night" && (
          <Section label="Night">
            <div className="flex items-center gap-2">
              <button
                onClick={() => send.devSkipNightStep()}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip current step
              </button>
              <button
                onClick={() => send.devSkipToPhase("day")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Day
              </button>
              <button
                onClick={() => send.devSkipToPhase("vote")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Vote
              </button>
              <button
                onClick={() => send.devSkipToPhase("reveal")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Reveal
              </button>
            </div>
          </Section>
        )}

        {phase === "day" && (
          <Section label="Day">
            <div className="flex items-center gap-2">
              <button
                onClick={() => send.devSkipToPhase("vote")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Vote
              </button>
              <button
                onClick={() => send.devSkipToPhase("reveal")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Reveal
              </button>
            </div>
          </Section>
        )}

        {phase === "vote" && (
          <Section label="Vote" wide>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <button
                onClick={() => send.devSkipToPhase("reveal")}
                className="btn-ghost text-xs px-2 py-1"
              >
                Skip to Reveal
              </button>
            </div>
            <div className="text-xs text-slate-400 mb-1">Force bot votes:</div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => send.devForceBotVotes({ mode: "random" })}
                className="btn-ghost text-xs px-2 py-1"
                title="Each bot picks a random target (active player or no_kill)"
              >
                🎲 Random
              </button>
              <button
                onClick={() => send.devForceBotVotes({ mode: "matchMe" })}
                className="btn-ghost text-xs px-2 py-1"
                title="All bots vote for whoever you voted for (no_kill if unset)"
              >
                🤝 Match my vote
              </button>
              <span className="text-xs text-slate-500">or specific →</span>
              <select
                value={voteTarget}
                onChange={(e) => setVoteTarget(e.target.value)}
                className="text-xs bg-slate-800 border border-slate-700 rounded px-1 py-0.5"
              >
                <option value="no_kill">no_kill</option>
                {activePlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  send.devForceBotVotes({ mode: "target", targetId: voteTarget })
                }
                className="btn-ghost text-xs px-2 py-1"
              >
                Apply
              </button>
            </div>
          </Section>
        )}

        {me?.devVision && (
          <Section label="God view (live)" wide>
            <ul className="space-y-1 text-xs">
              {me.devVision.players.map((v) => (
                <li key={v.id}>
                  <span className={playerColor(v.id, room.players)}>
                    {room.players.find((p) => p.id === v.id)?.name ?? "?"}
                  </span>
                  : {ROLE_META[v.currentRole].label}
                  {v.currentRole !== v.originalRole && (
                    <span className="text-amber-300">
                      {" "}
                      (was {ROLE_META[v.originalRole].label})
                    </span>
                  )}
                  {v.bot && <span className="text-slate-500 ml-1">[bot]</span>}
                </li>
              ))}
            </ul>
            <div className="mt-2 text-xs">
              <span className="text-slate-400">Centre: </span>
              {me.devVision.centerCards.map((r, i) => (
                <span key={i} className="text-slate-200 mr-2">
                  #{i + 1} {ROLE_META[r].label}
                </span>
              ))}
            </div>
            {me.devVision.actionLog.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-slate-400 text-xs">
                  Action log ({me.devVision.actionLog.length})
                </summary>
                <ol className="mt-1 space-y-0.5 text-xs text-slate-300">
                  {me.devVision.actionLog.map((e, i) => (
                    <li key={i}>{JSON.stringify(e)}</li>
                  ))}
                </ol>
              </details>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
  wide,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded border border-fuchsia-900/60 bg-slate-950/30 p-2 ${
        wide ? "sm:col-span-2" : ""
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-fuchsia-300 mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
