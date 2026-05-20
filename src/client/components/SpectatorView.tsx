import type { NightNote, PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { DEFAULT_VOICE_PACK, ROLE_META } from "../../shared/types.js";
import { unlockNarrationAudio, useStepAudio } from "../nightAudio.js";
import { playerColor } from "../playerColor.js";
import { loadNarrator } from "../storage.js";
import { useCountdown } from "../useCountdown.js";
import { ActiveDeckPanel } from "./ActiveDeckPanel.js";
import { DevModeTag } from "./DevModeTag.js";
import { NightProgressPanel } from "./NightProgressPanel.js";
import { RoleCard } from "./RoleCard.js";

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
  const vision = me.spectatorVision;
  // Quick lookup of the live data per active player.
  const visionById = new Map(vision?.players.map((v) => [v.id, v]));
  const visionHidden = !!room.spectatorsBlind;
  // Spectators hear the same narrator clips as active players so they can
  // follow along with the night flow.
  const pack = loadNarrator() ?? DEFAULT_VOICE_PACK;
  const stepUrls = room.nightStepVoiceFiles?.map((f) => `/voice/${pack}/${f}`);
  const narrationBlocked = useStepAudio(room.nightStep, stepUrls);

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="heading text-xl text-slate-300">Spectating</h2>
            <p className="text-sm text-slate-400 mt-1">
              {visionHidden
                ? "You're watching this round. The host has hidden the game state — you can see who's ready or voted, but not their cards or notes."
                : "You're watching this round. You see every active player's actual current card — click a name to expand their notes."}
            </p>
          </div>
          <span className="text-xs uppercase tracking-wider text-indigo-300 px-2 py-1 rounded border border-indigo-700 bg-indigo-950/50">
            {phaseLabel}
          </span>
        </div>
        {visionHidden && (
          <div className="mt-3 text-xs text-amber-300">
            🙈 Game state hidden by the host
          </div>
        )}
        {narrationBlocked && (
          <button
            onClick={() => unlockNarrationAudio()}
            className="mt-3 btn-ghost text-xs"
          >
            🔊 Tap to enable narration
          </button>
        )}
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
              {readyCount}/
              {room.players.filter((p) => p.connected && !p.spectating).length} ready
            </span>
          </div>
        )}
        {room.phase === "vote" && (
          <div className="mt-3 text-sm text-slate-400">
            <span className="text-slate-200">
              {votesCast}/{room.players.filter((p) => !p.spectating).length}
            </span>{" "}
            votes cast.
          </div>
        )}
      </div>

      {room.phase === "night" && (
        <NightProgressPanel selectedRoles={room.selectedRoles} currentStep={room.nightStep} />
      )}

      <ActiveDeckPanel roles={room.selectedRoles} />

      {vision && vision.centerCards.length > 0 && (
        <div className="panel">
          <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">
            Center cards (live)
          </h3>
          <div className="flex flex-wrap items-end gap-3">
            {vision.centerCards.map((r, i) => (
              <RoleCard key={i} role={r} size="sm" caption={`Center ${i + 1}`} />
            ))}
          </div>
        </div>
      )}

      <div className="panel">
        <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Players</h3>
        <ul className="space-y-2">
          {room.players
            .filter((p) => !p.spectating)
            .map((p) => {
              const ready = (room.readyPlayerIds ?? []).includes(p.id);
              const voted = p.votedFor != null;
              const accusationsAgainst = accusations.filter((a) => a.targetId === p.id);
              const v = visionById.get(p.id);
              const nameCls = playerColor(p.id, room.players);
              return (
                <details
                  key={p.id}
                  className={`group rounded-md border ${
                    p.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900"
                  }`}
                >
                  <summary className="cursor-pointer list-none px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-400 text-xs transition-transform group-open:rotate-90">
                          ▶
                        </span>
                        <span className={`font-medium ${nameCls}`}>
                          {p.name}
                          <DevModeTag show={!!room.devMode && p.isHost} />
                        </span>
                        {v && (
                          <span className="text-xs text-slate-300 bg-slate-900/70 border border-slate-700 rounded px-1.5 py-0.5">
                            {ROLE_META[v.currentRole].label}
                            {v.currentRole !== v.originalRole && (
                              <span className="text-amber-300 ml-1">
                                ↳ was {ROLE_META[v.originalRole].label}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-xs">
                        {!p.connected && <span className="text-slate-500">offline</span>}
                        {room.phase === "day" && ready && (
                          <span className="text-emerald-300">ready</span>
                        )}
                        {room.phase === "vote" && voted && (
                          <span className="text-emerald-300">voted</span>
                        )}
                      </div>
                    </div>
                    {accusationsAgainst.length > 0 && (
                      <ul className="mt-1.5 ml-6 space-y-0.5">
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
                  </summary>
                  <div className="px-3 pb-3 pt-1 grid sm:grid-cols-[auto_1fr] gap-4 items-start">
                    {v ? (
                      <RoleCard role={v.currentRole} size="sm" />
                    ) : (
                      <div className="text-xs text-slate-500 italic">No card dealt</div>
                    )}
                    <div className="space-y-2 min-w-0">
                      {v && v.notes.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                            Notes from the night
                          </div>
                          <ul className="space-y-0.5 text-xs text-slate-300">
                            {v.notes.map((n, i) => (
                              <li key={i}>{describeNote(n, room)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {v && v.userNotes.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                            Their typed notes
                          </div>
                          <ul className="space-y-0.5 text-xs text-slate-300">
                            {v.userNotes.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {v && v.notes.length === 0 && v.userNotes.length === 0 && (
                        <div className="text-xs text-slate-500 italic">
                          No notes yet.
                        </div>
                      )}
                    </div>
                  </div>
                </details>
              );
            })}
        </ul>
      </div>
    </div>
  );
}

function describeNote(n: NightNote, room: PublicRoom): string {
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? "?";
  const label = (r: Role) => ROLE_META[r].label;
  switch (n.kind) {
    case "starting_role":
      return `Dealt: ${label(n.role)}.`;
    case "sentinel_shielded":
      return `Shielded ${nameOf(n.targetId)}.`;
    case "sentinel_skipped":
      return "Skipped the shield.";
    case "alpha_wolf_swapped":
      return `Gave the centre Werewolf to ${nameOf(n.targetId)}.`;
    case "alpha_wolf_no_swap":
      return "No centre Werewolf to swap.";
    case "mystic_wolf_saw":
      return `Looked at ${nameOf(n.targetId)} — ${label(n.role)}.`;
    case "dream_wolf_seen":
      return "Dream Wolf — stayed asleep.";
    case "doppelganger_copied":
      return `Copied ${nameOf(n.targetId)} (${label(n.role)}).`;
    case "fellow_werewolves":
      return n.playerIds.length === 0
        ? "Lone werewolf — no fellow wolves."
        : `Sees fellow werewolves: ${n.playerIds.map(nameOf).join(", ")}.`;
    case "lone_wolf_center":
      return `Peeked center #${n.index + 1} — ${label(n.role)}.`;
    case "minion_sees_werewolves":
      return n.playerIds.length === 0
        ? "Saw no werewolves are in play."
        : `Sees the werewolves: ${n.playerIds.map(nameOf).join(", ")}.`;
    case "fellow_mason":
      return `Sees fellow mason(s): ${n.playerIds.map(nameOf).join(", ")}.`;
    case "no_other_masons":
      return "Saw no other Mason in play.";
    case "seer_player":
      return `Looked at ${nameOf(n.playerId)} — ${label(n.role)}.`;
    case "seer_center":
      return `Peeked center: ${n.cards.map((c) => `#${c.index + 1} ${label(c.role)}`).join(", ")}.`;
    case "robber_new_role":
      return `Stole from ${nameOf(n.targetId)} and is now ${label(n.role)}.`;
    case "troublemaker_swapped":
      return `Swapped ${nameOf(n.targetIds[0])} and ${nameOf(n.targetIds[1])}.`;
    case "drunk_swapped":
      return `Took centre #${n.centerIndex + 1} (unseen).`;
    case "insomniac_self":
      return `Confirmed own card: ${label(n.role)}.`;
  }
}
