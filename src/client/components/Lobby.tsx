import { useMemo, useRef, useState } from "react";
import type { PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { ALL_ROLES, DEFAULT_VOICE_PACK, ROLE_META, VOICE_PACKS } from "../../shared/types.js";
import { send } from "../socket.js";
import { loadNarrator, saveNarrator } from "../storage.js";
import { CopyableCode } from "./CopyableCode.js";
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
  const targetCount = room.players.length + 3;
  const lobbyReadyIds = room.lobbyReadyIds ?? [];
  const everyoneReady = room.players
    .filter((p) => !p.isHost)
    .every((p) => lobbyReadyIds.includes(p.id));
  const valid =
    room.selectedRoles.length === targetCount &&
    room.players.length >= 3 &&
    room.players.length <= 10 &&
    everyoneReady;
  const iAmReady = !!me && lobbyReadyIds.includes(me.myId);

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
    send.setRoles(randomDeck(room.players.length));
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="heading text-xl text-indigo-200">Players</h2>
            <p className="text-sm text-slate-400">
              Share the code <CopyableCode code={room.code} className="text-slate-100" /> with your
              friends. {room.players.length}/10 in the room.
            </p>
          </div>
        </div>
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {room.players.map((p) => {
            const ready = lobbyReadyIds.includes(p.id);
            const isMe = me?.myId === p.id;
            const canKick = isHost && !p.isHost && !isMe;
            return (
              <li
                key={p.id}
                className={`rounded-md border px-3 py-2 text-sm ${
                  p.connected ? "border-slate-700 bg-slate-800" : "border-slate-800 bg-slate-900 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  <div className="flex items-center gap-1.5">
                    {p.isHost ? (
                      <span className="text-xs text-amber-300">host</span>
                    ) : ready ? (
                      <span className="text-xs text-emerald-300">ready</span>
                    ) : null}
                    {canKick && (
                      <button
                        className="text-xs text-rose-300 hover:text-rose-200 px-1.5 py-0.5 rounded border border-rose-900 hover:border-rose-700"
                        onClick={() => {
                          if (confirm(`Kick ${p.name}? The room code will change.`)) {
                            send.kick(p.id);
                          }
                        }}
                        title="Kick this player; room code will rotate"
                      >
                        Kick
                      </button>
                    )}
                  </div>
                </div>
                {!p.connected && <span className="text-xs">offline</span>}
                {isMe && <span className="text-xs text-indigo-300">you</span>}
              </li>
            );
          })}
        </ul>
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
                  {lobbyReadyIds.length}/{room.players.filter((p) => !p.isHost).length}
                </span>
              </span>
            </>
          )}
          {isHost ? (
            <button
              className="btn-primary"
              disabled={!valid}
              onClick={() => send.start()}
              title={
                valid
                  ? "Start the game"
                  : !everyoneReady
                    ? "Waiting for all players to ready up"
                    : `Need ${targetCount} role cards and 3+ players to start`
              }
            >
              Start game
            </button>
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
    </div>
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
