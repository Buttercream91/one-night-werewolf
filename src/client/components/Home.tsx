import { useState } from "react";
import { createRoom, joinRoom } from "../socket.js";

interface Props {
  onJoined: () => void;
}

export function Home({ onJoined }: Props) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"create" | "join">("create");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Enter a name");
    setBusy(true);
    setErr(null);
    const res = await createRoom(name.trim());
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
        {err && <div className="text-sm text-rose-300">{err}</div>}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "…" : tab === "create" ? "Create room" : "Join room"}
        </button>
      </form>

      <p className="mt-6 text-xs text-slate-400">
        Tip: get on a Discord/Zoom call together first — discussion happens by voice. The app
        handles roles, the night phase, and voting.
      </p>
    </div>
  );
}
