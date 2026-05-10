import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PrivateView, PublicPlayer, PublicRoom, Role } from "../../shared/types.js";
import { ALL_ROLES, DEFAULT_VOICE_PACK, ROLE_META, VOICE_PACKS } from "../../shared/types.js";
import { playerColor, speakingRingClass } from "../playerColor.js";
import { send } from "../socket.js";
import { loadNarrator, saveNarrator } from "../storage.js";
import { useSpeakingLevel } from "../webrtc.js";
import { CopyableCode } from "./CopyableCode.js";
import { PlayerMenu } from "./PlayerMenu.js";
import { ROLE_IMAGE } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
}

export function Lobby({ room, me }: Props) {
  const isHost = useMemo(
    () => !!me && room.players.find((p) => p.id === me.myId)?.isHost,
    [room, me],
  );
  const activePlayers = room.players.filter((p) => !p.spectating);
  const spectators = room.players.filter((p) => p.spectating);
  const targetCount = activePlayers.length + 3;
  const lobbyReadyIds = room.lobbyReadyIds ?? [];
  const nonHostActive = activePlayers.filter((p) => !p.isHost);
  const everyoneReady = nonHostActive.every((p) => lobbyReadyIds.includes(p.id));
  const valid =
    room.selectedRoles.length === targetCount &&
    activePlayers.length >= 3 &&
    activePlayers.length <= 10 &&
    everyoneReady;
  const iAmReady = !!me && lobbyReadyIds.includes(me.myId);
  const iAmSpectator = !!me && !!room.players.find((p) => p.id === me.myId)?.spectating;
  const canJoinAsPlayer = activePlayers.length < 10;

  const counts: Partial<Record<Role, number>> = {};
  for (const r of room.selectedRoles) counts[r] = (counts[r] ?? 0) + 1;

  function setCount(role: Role, n: number) {
    if (!isHost) return;
    const next = room.selectedRoles.filter((r) => r !== role);
    for (let i = 0; i < n; i++) next.push(role);
    send.setRoles(next);
  }

  function randomise() {
    if (!isHost) return;
    send.setRoles(randomDeck(activePlayers.length));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="heading text-xl text-indigo-200">
              Players <span className="text-sm text-slate-400">({activePlayers.length}/10)</span>
            </h2>
            <p className="text-sm text-slate-400">
              Share the code <CopyableCode code={room.code} className="text-slate-100" /> with your
              friends. New joiners start as spectators — they pick whether to play.
            </p>
          </div>
          {iAmSpectator && (
            <button
              className={canJoinAsPlayer ? "btn-primary text-sm" : "btn-ghost text-sm"}
              disabled={!canJoinAsPlayer}
              onClick={() => send.spectate(false)}
              title={canJoinAsPlayer ? "Join the upcoming game" : "Player slots are full (10 max)"}
            >
              Join game
            </button>
          )}
        </div>
        {activePlayers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 italic">
            No active players yet — click Join game to play.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {activePlayers.map((p) => (
              <LobbyPlayerTile
                key={p.id}
                player={p}
                room={room}
                me={me}
                ready={lobbyReadyIds.includes(p.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <h2 className="heading text-xl text-indigo-200">
            Spectators <span className="text-sm text-slate-400">({spectators.length}/10)</span>
            {room.spectatorsMuted && (
              <span className="ml-2 text-xs text-amber-400" title="Spectators are muted by the host">
                🔇 muted
              </span>
            )}
            {room.spectatorsAutoLock && (
              <span className="ml-1 text-xs text-amber-400" title="New joiners are auto-locked to spectator">
                🔒 auto-lock
              </span>
            )}
            {room.spectatorsBlind && (
              <span className="ml-1 text-xs text-amber-400" title="Spectators can't see game state">
                🙈 blind
              </span>
            )}
          </h2>
          {isHost && <SpectatorsHostMenu room={room} />}
        </div>
        {spectators.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 italic">No one is spectating.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {spectators.map((p) => (
              <LobbySpectatorTile key={p.id} player={p} room={room} me={me} />
            ))}
          </ul>
        )}
      </div>

      <NarratorPicker />

      <details className="panel group">
        <summary className="flex items-center justify-between gap-3 cursor-pointer list-none">
          <div className="flex-1 min-w-0">
            <h2 className="heading text-xl text-indigo-200 flex items-center gap-2">
              <span className="text-slate-400 text-sm transition-transform group-open:rotate-90">
                ▶
              </span>
              Roles in deck
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Pick exactly{" "}
              <span className={room.selectedRoles.length === targetCount ? "text-emerald-300" : "text-amber-300"}>
                {targetCount}
              </span>{" "}
              cards: one per player + 3 center. Selected:{" "}
              <span className="text-slate-100">{room.selectedRoles.length}</span>
            </p>
          </div>
          {isHost && (
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                randomise();
              }}
              className="btn-ghost text-sm"
            >
              Randomise
            </button>
          )}
        </summary>

        <ul className="mt-4 grid lg:grid-cols-2 gap-3">
          {ALL_ROLES.map((role) => {
            const meta = ROLE_META[role];
            const n = counts[role] ?? 0;
            return (
              <li
                key={role}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-800 bg-slate-900/40 p-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-100">{meta.label}</span>
                    <TeamPill team={meta.team} />
                    {n > 0 && <span className="text-xs text-emerald-300">×{n}</span>}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{meta.description}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {Array.from({ length: meta.maxCount }).map((_, slotIdx) => {
                    const isOn = slotIdx < n;
                    // The first Werewolf is always required — render it
                    // selected and non-clickable so the count can't drop to 0.
                    const locked = role === "werewolf" && slotIdx === 0;
                    return (
                      <button
                        key={slotIdx}
                        disabled={!isHost || locked}
                        onClick={() => setCount(role, isOn ? n - 1 : n + 1)}
                        title={
                          locked
                            ? "Werewolf is required — at least one must stay in the deck"
                            : isOn
                              ? "Click to remove"
                              : "Click to add"
                        }
                        className={`relative w-14 h-20 rounded-md overflow-hidden border-2 transition-all ${
                          isOn
                            ? "border-indigo-400 opacity-100 hover:scale-[1.04]"
                            : "border-slate-700 opacity-30 hover:opacity-70 hover:scale-[1.04]"
                        } ${locked ? "cursor-default hover:scale-100" : ""} disabled:hover:scale-100 disabled:cursor-not-allowed`}
                      >
                        <img
                          src={ROLE_IMAGE[role]}
                          alt={meta.label}
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                        />
                        {locked && (
                          <span className="absolute top-1 right-1 rounded-sm bg-slate-950/80 px-1 text-[10px] text-slate-300">
                            🔒
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </details>

      <div className="panel flex flex-col sm:flex-row sm:items-end gap-4">
        <label className="flex-1">
          <span className="block text-sm text-slate-300 mb-1">Day phase length (seconds)</span>
          <input
            type="number"
            min={60}
            max={900}
            step={30}
            value={room.daySeconds}
            disabled={!isHost}
            onChange={(e) => send.setDaySeconds(Number(e.target.value))}
            className="input max-w-[10rem]"
          />
          <span className="ml-2 text-xs text-slate-400">60–900 seconds</span>
        </label>
        <div className="flex-1 flex items-center justify-end gap-3">
          {isHost && (
            <>
              <span className="text-sm">
                <span className="text-slate-400">Cards </span>
                <span
                  className={`font-mono tabular-nums ${
                    room.selectedRoles.length === targetCount
                      ? "text-emerald-300"
                      : room.selectedRoles.length > targetCount
                        ? "text-rose-300"
                        : "text-slate-400"
                  }`}
                >
                  {room.selectedRoles.length}/{targetCount}
                </span>
              </span>
              <span className="text-sm">
                <span className="text-slate-400">Ready </span>
                <span
                  className={`font-mono tabular-nums ${
                    everyoneReady ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {nonHostActive.filter((p) => lobbyReadyIds.includes(p.id)).length}/
                  {nonHostActive.length}
                </span>
              </span>
            </>
          )}
          {isHost ? (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button
                  className={room.mutedExceptHost ? "btn-ghost" : "btn-ghost"}
                  onClick={() => send.muteAllExceptHost(!room.mutedExceptHost)}
                  title="Toggle a global mute for everyone except you"
                >
                  {room.mutedExceptHost ? "🔊 Unmute all" : "🔇 Mute all"}
                </button>
                <button
                  className="btn-primary"
                  disabled={!valid}
                  onClick={() => send.start()}
                  title={
                    valid
                      ? "Start the game"
                      : !everyoneReady
                        ? "Waiting for all players to ready up"
                        : `Need ${targetCount} role cards and 3+ active players to start`
                  }
                >
                  Start game
                </button>
              </div>
              <button
                className="btn-ghost text-sm"
                onClick={() => send.announceReadyCheck()}
                title="Plays a 'readiness check' narration on every player's device"
              >
                📢 Announce ready check
              </button>
            </div>
          ) : iAmSpectator ? (
            <span className="text-sm text-slate-400 italic">
              Spectating — waiting for the host to start
            </span>
          ) : (
            <button
              className={iAmReady ? "btn-ghost" : "btn-primary"}
              onClick={() => send.lobbyReady(!iAmReady)}
            >
              {iAmReady ? "Cancel ready" : "Ready"}
            </button>
          )}
        </div>
      </div>
      {room.mutedExceptHost && (
        <div className="text-center text-xs text-amber-300">
          🔇 Announcement mode — everyone but the host is muted.
        </div>
      )}
    </div>
  );
}

function LobbyPlayerTile({
  player,
  room,
  me,
  ready,
}: {
  player: PublicPlayer;
  room: PublicRoom;
  me: PrivateView | null;
  ready: boolean;
}) {
  const isMe = me?.myId === player.id;
  const level = useSpeakingLevel(player.id);
  const ring = speakingRingClass(level);
  const nameCls = playerColor(player.id, room.players);
  return (
    <li
      className={`rounded-md border px-3 py-2 text-sm transition-shadow ${
        player.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900 text-slate-500"
      } ${ring}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-medium ${nameCls}`}>
          {player.name}
          {isMe && <span className="ml-1 text-xs text-indigo-300">(you)</span>}
        </span>
        <div className="flex items-center gap-1">
          {player.isHost ? (
            <span className="text-xs text-amber-300">host</span>
          ) : ready ? (
            <span className="text-xs text-emerald-300">ready</span>
          ) : null}
          {me && <PlayerMenu target={player} room={room} myId={me.myId} where="lobby" />}
        </div>
      </div>
      {!player.connected && <span className="text-xs">offline</span>}
    </li>
  );
}

function LobbySpectatorTile({
  player,
  room,
  me,
}: {
  player: PublicPlayer;
  room: PublicRoom;
  me: PrivateView | null;
}) {
  const isMe = me?.myId === player.id;
  const level = useSpeakingLevel(player.id);
  const ring = speakingRingClass(level);
  const nameCls = playerColor(player.id, room.players);
  return (
    <li
      className={`rounded-md border px-3 py-2 text-sm transition-shadow ${
        player.connected ? "border-slate-800 bg-slate-900/60" : "border-slate-800 bg-slate-900 text-slate-500"
      } ${ring}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-medium ${nameCls}`}>
          {player.name}
          {isMe && <span className="ml-1 text-xs text-indigo-300">(you)</span>}
          {player.forcedSpectating && (
            <span className="ml-1 text-xs text-amber-400" title="Set to spectator by the host">
              🔒
            </span>
          )}
        </span>
        {me && <PlayerMenu target={player} room={room} myId={me.myId} where="lobby" />}
      </div>
      {!player.connected && <span className="text-xs">offline</span>}
    </li>
  );
}

function SpectatorsHostMenu({ room }: { room: PublicRoom }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position the menu under-and-right-aligned with the trigger button. Same
  // approach as PlayerMenu — portal it to body so the .panel's backdrop-blur
  // stacking context can't bury it under sibling panels.
  useLayoutEffect(() => {
    if (!open) return;
    function reposition() {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const menuWidth = 224;
      const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, r.right - menuWidth));
      const top = r.bottom + 4;
      setPos({ top, left });
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        className="text-slate-400 hover:text-slate-200 px-1 leading-none"
        onClick={() => setOpen((o) => !o)}
        title="Spectators options"
      >
        ⋯
      </button>
      {open && pos &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[99999] isolate w-56 rounded-md border border-slate-700 bg-slate-900 shadow-xl text-sm text-slate-100"
            style={{ top: pos.top, left: pos.left }}
          >
            <CheckRow
              label="Mute all spectators"
              checked={!!room.spectatorsMuted}
              onToggle={() => send.muteSpectators(!room.spectatorsMuted)}
            />
            <CheckRow
              label="Auto-lock new spectators"
              checked={!!room.spectatorsAutoLock}
              onToggle={() => send.setSpectatorsAutoLock(!room.spectatorsAutoLock)}
              note="New joiners arrive locked. You release them via their tile menu."
            />
            <CheckRow
              label="Hide game state from spectators"
              checked={!!room.spectatorsBlind}
              onToggle={() => send.setSpectatorsBlind(!room.spectatorsBlind)}
              note="Spectators see only public info — no cards, notes, or centre. Stops a spectator next to a player from leaking the game."
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function CheckRow({
  label,
  checked,
  onToggle,
  note,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  note?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="w-full text-left px-3 py-2 hover:bg-slate-800 flex items-start gap-2"
    >
      <span
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-xs ${
          checked
            ? "border-indigo-400 bg-indigo-500 text-white"
            : "border-slate-600 bg-slate-900"
        }`}
      >
        {checked ? "✓" : ""}
      </span>
      <span className="flex-1">
        {label}
        {note && <span className="block text-xs text-slate-400 mt-0.5">{note}</span>}
      </span>
    </button>
  );
}

function NarratorPicker() {
  const [pick, setPick] = useState<string>(() => loadNarrator() ?? DEFAULT_VOICE_PACK);
  const pickedLabel =
    VOICE_PACKS.find((p) => p.id === pick)?.label ?? pick;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (audioRef.current === null && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
  }
  function preview(packId: string) {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = `/voice/${packId}/Intro.mp3`;
    audioRef.current.play().catch(() => {});
  }
  function choose(packId: string) {
    setPick(packId);
    saveNarrator(packId);
  }

  return (
    <details className="panel group">
      <summary className="cursor-pointer list-none">
        <h2 className="heading text-xl text-indigo-200 flex items-center gap-2">
          <span className="text-slate-400 text-sm transition-transform group-open:rotate-90">
            ▶
          </span>
          Your narrator
          <span className="ml-auto text-sm text-slate-300 font-normal">{pickedLabel}</span>
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Pick the voice you want to hear during the night. Saved on this device — every player
          picks their own.
        </p>
      </summary>
      <ul className="mt-4 grid sm:grid-cols-2 gap-2">
        {VOICE_PACKS.map((pack) => {
          const mine = pick === pack.id;
          return (
            <li
              key={pack.id}
              className={`flex items-center justify-between gap-3 rounded-md border p-3 ${
                mine ? "border-indigo-500 bg-indigo-950/40" : "border-slate-700 bg-slate-900/40"
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium text-slate-100">
                  {pack.label}{" "}
                  <span className="text-xs text-slate-400">— {pack.blurb}</span>
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  className="btn-ghost text-xs px-2 py-1"
                  onClick={() => preview(pack.id)}
                  title="Preview the intro line"
                >
                  ▶ Preview
                </button>
                <button
                  className={mine ? "btn-primary text-xs px-2 py-1" : "btn-ghost text-xs px-2 py-1"}
                  onClick={() => choose(pack.id)}
                >
                  {mine ? "Picked" : "Pick"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function TeamPill({ team }: { team: "werewolf" | "villager" | "tanner" }) {
  const cls =
    team === "werewolf"
      ? "bg-rose-950 border-rose-800 text-rose-300"
      : team === "tanner"
        ? "bg-amber-950 border-amber-800 text-amber-300"
        : "bg-emerald-950 border-emerald-800 text-emerald-300";
  return <span className={`text-xs rounded border px-1.5 py-0.5 ${cls}`}>{team}</span>;
}

// Pick a random deck whose total card count equals players + 3, respecting
// each role's max count. Retries if the picked deck has a Minion with no
// Werewolf (server would reject that combo).
function randomDeck(numPlayers: number): Role[] {
  const target = numPlayers + 3;
  const pool: Role[] = [];
  for (const role of ALL_ROLES) {
    for (let i = 0; i < ROLE_META[role].maxCount; i++) pool.push(role);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const shuffled = shuffle(pool.slice()).slice(0, target);
    const hasMinion = shuffled.includes("minion");
    const hasWerewolf = shuffled.includes("werewolf");
    // At least one Werewolf is mandatory; Minion needs a Werewolf too.
    if (hasWerewolf && (!hasMinion || hasWerewolf)) return shuffled;
  }
  // Fallback: force a Werewolf into a fresh shuffle and drop something else.
  const fallback = shuffle(pool.slice()).slice(0, target);
  if (!fallback.includes("werewolf")) {
    fallback[0] = "werewolf";
  }
  if (fallback.includes("minion") && !fallback.includes("werewolf")) {
    fallback[fallback.indexOf("minion")] = "villager";
  }
  return fallback;
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
