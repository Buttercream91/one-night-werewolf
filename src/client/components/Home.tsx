import { useEffect, useState } from "react";
import { createRoom, joinRoom, listPublicRooms } from "../socket.js";

interface Props {
  onJoined: () => void;
  onTutorial: () => void;
}

export function Home({ onJoined, onTutorial }: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [makePrivate, setMakePrivate] = useState(false);
  const [publicRooms, setPublicRooms] = useState<
    Array<{
      code: string;
      roomName?: string;
      hostName: string;
      playerCount: number;
      spectatorCount: number;
      phase: import("../../shared/types.js").Phase;
    }>
  >([]);
  const [listLoading, setListLoading] = useState(false);

  async function refreshList() {
    setListLoading(true);
    try {
      const rooms = await listPublicRooms();
      setPublicRooms(rooms);
    } finally {
      setListLoading(false);
    }
  }

  // Auto-fetch the list when the Join tab is opened.
  useEffect(() => {
    if (tab !== "join") return;
    void refreshList();
  }, [tab]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Enter a name");
    setBusy(true);
    setErr(null);
    const res = await createRoom(name.trim(), {
      private: makePrivate,
      roomName: roomName.trim() || undefined,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onJoined();
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Enter a name");
    if (!code.trim()) return setErr("Enter a room code");
    setBusy(true);
    setErr(null);
    const res = await joinRoom(name.trim(), code.trim().toUpperCase());
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onJoined();
  }

  async function handleJoinFromList(roomCode: string) {
    if (!name.trim()) return setErr("Enter a name first");
    setBusy(true);
    setErr(null);
    const res = await joinRoom(name.trim(), roomCode);
    setBusy(false);
    if (!res.ok) return setErr(res.error);
    onJoined();
  }

  return (
    <div className="mx-auto max-w-md panel">
      <div className="mb-4 grid grid-cols-2 rounded-md bg-slate-800 p-1">
        <button
          onClick={() => setTab("create")}
          className={`rounded px-3 py-1.5 text-sm font-medium transition ${tab === "create" ? "bg-slate-950 text-indigo-200" : "text-slate-300"}`}
        >
          Create room
        </button>
        <button
          onClick={() => setTab("join")}
          className={`rounded px-3 py-1.5 text-sm font-medium transition ${tab === "join" ? "bg-slate-950 text-indigo-200" : "text-slate-300"}`}
        >
          Join room
        </button>
      </div>

      <form onSubmit={tab === "create" ? handleCreate : handleJoin} className="space-y-3">
        <label className="block">
          <span className="block text-sm text-slate-300 mb-1">Your name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alan"
            maxLength={24}
            autoFocus
          />
        </label>
        {tab === "join" && (
          <label className="block">
            <span className="block text-sm text-slate-300 mb-1">Room code</span>
            <input
              className="input font-mono uppercase tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD"
              maxLength={4}
            />
          </label>
        )}
        {tab === "create" && (
          <>
            <label className="block">
              <span className="block text-sm text-slate-300 mb-1">
                Lobby name <span className="text-slate-500 text-xs">(optional)</span>
              </span>
              <input
                className="input"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. Werewolf Wednesdays"
                maxLength={40}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={makePrivate}
                onChange={(e) => setMakePrivate(e.target.checked)}
                className="accent-indigo-400"
              />
              <span>
                Private room
                <span className="block text-xs text-slate-500">
                  Won't appear in the public lobby browser. Friends still join with the code.
                </span>
              </span>
            </label>
          </>
        )}
        {err && <div className="text-sm text-rose-300">{err}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "…" : tab === "create" ? "Create room" : "Join room"}
        </button>
      </form>

      {tab === "join" && (
        <div className="mt-6 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-300">Public lobbies</span>
            <button
              onClick={refreshList}
              disabled={listLoading}
              className="btn-ghost text-xs px-2 py-1"
              title="Refresh list"
            >
              {listLoading ? "…" : "↻ Refresh"}
            </button>
          </div>
          {publicRooms.length === 0 ? (
            <p className="text-xs text-slate-500 italic">
              {listLoading ? "Loading…" : "No public lobbies open right now."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {publicRooms.map((r) => (
                <li
                  key={r.code}
                  className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-100 truncate flex items-center gap-2">
                      <span>
                        {r.roomName ?? <span className="text-slate-400 italic">Untitled</span>}{" "}
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                      </span>
                      {r.phase !== "lobby" && (
                        <span
                          className="text-[10px] uppercase tracking-wider rounded border border-amber-700 bg-amber-950/50 text-amber-300 px-1.5"
                          title="A round is in progress — you'll join as a spectator"
                        >
                          {r.phase === "night"
                            ? "Night"
                            : r.phase === "day"
                              ? "Day"
                              : r.phase === "vote"
                                ? "Vote"
                                : "Reveal"}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      hosted by {r.hostName} · {r.playerCount} player
                      {r.playerCount === 1 ? "" : "s"}
                      {r.spectatorCount > 0 && `, ${r.spectatorCount} spectating`}
                      {r.phase !== "lobby" && " · join as spectator"}
                    </div>
                  </div>
                  <button
                    className="btn-ghost text-xs px-2 py-1"
                    disabled={busy || !name.trim()}
                    onClick={() => handleJoinFromList(r.code)}
                    title={
                      !name.trim()
                        ? "Enter your name first"
                        : r.phase === "lobby"
                          ? "Join this lobby"
                          : "Round in progress — you'll join as a spectator"
                    }
                  >
                    {r.phase === "lobby" ? "Join" : "Watch"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-6 text-xs text-slate-400">
        Tip: get on a Discord/Zoom call together first — discussion happens by voice. The app
        handles roles, the night phase, and voting.
      </p>

      <div className="mt-4 border-t border-slate-800 pt-4 flex items-center justify-between">
        <span className="text-sm text-slate-300">First time playing?</span>
        <button onClick={onTutorial} className="btn-ghost text-sm">
          How to play
        </button>
      </div>
    </div>
  );
}
