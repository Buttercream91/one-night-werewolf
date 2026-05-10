import { useEffect, useState } from "react";
import type { PrivateView, PublicRoom } from "../shared/types.js";
import { CopyableCode } from "./components/CopyableCode.js";
import { Game } from "./components/Game.js";
import { Home } from "./components/Home.js";
import { Lobby } from "./components/Lobby.js";
import { joinRoom, socket } from "./socket.js";
import { setServerTimeOffset } from "./useCountdown.js";
import { clearSession, loadSession, saveSession, type SessionData } from "./storage.js";

export function App() {
  const [session, setSession] = useState<SessionData | null>(() => loadSession());
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [me, setMe] = useState<PrivateView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  // Track whether we've ever been connected so we can label the indicator
  // accurately ("Connecting…" on first load vs "Reconnecting…" after a drop).
  const [everConnected, setEverConnected] = useState(socket.connected);
  const [error, setError] = useState<string | null>(null);

  // Wire socket → react state.
  useEffect(() => {
    function onConnect() {
      console.log("[onuw] socket connect", socket.id);
      setConnected(true);
      setEverConnected(true);
    }
    function onDisconnect(reason: string) {
      console.log("[onuw] socket disconnect", reason);
      setConnected(false);
    }
    function onRoomState(r: PublicRoom) {
      setServerTimeOffset(r.serverNow - Date.now());
      setRoom(r);
      // The host can rotate the room's join code when kicking. Keep the saved
      // session in lockstep so a refresh reconnects with the current code.
      setSession((prev) => {
        if (!prev || prev.roomCode === r.code) return prev;
        const next = { ...prev, roomCode: r.code };
        saveSession(next);
        return next;
      });
    }
    function onYouState(v: PrivateView) {
      setMe(v);
    }
    function onJoined(payload: { roomCode: string; playerId: string; name: string }) {
      const data = { roomCode: payload.roomCode, playerId: payload.playerId, name: payload.name };
      saveSession(data);
      setSession(data);
      setError(null);
    }
    function onError(payload: { message: string }) {
      setError(payload.message);
    }
    function onKicked(payload: { reason: string }) {
      clearSession();
      setSession(null);
      setRoom(null);
      setMe(null);
      setError(payload.reason);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:state", onRoomState);
    socket.on("you:state", onYouState);
    socket.on("joined", onJoined);
    socket.on("error", onError);
    socket.on("kicked", onKicked);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:state", onRoomState);
      socket.off("you:state", onYouState);
      socket.off("joined", onJoined);
      socket.off("error", onError);
      socket.off("kicked", onKicked);
    };
  }, []);

  // (Re)attach to our room on every connect — the server keeps no persistent
  // state about us across reconnects (e.g., dev server restarts), so we have
  // to re-announce ourselves. The server treats this as an idempotent reconnect.
  useEffect(() => {
    if (!connected || !session) return;
    let cancelled = false;
    (async () => {
      const res = await joinRoom(session.name, session.roomCode, session.playerId);
      if (cancelled) return;
      if (!res.ok) {
        setError(`Couldn't rejoin room ${session.roomCode}: ${res.error}`);
        clearSession();
        setSession(null);
        setRoom(null);
        setMe(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connected, session?.roomCode, session?.playerId, session?.name]);

  function leaveRoom() {
    socket.emit("room:leave");
    clearSession();
    setSession(null);
    setRoom(null);
    setMe(null);
  }

  // Routing: if no session yet, show home. Otherwise show lobby/game based on phase.
  return (
    <div className="min-h-screen px-4 py-6 sm:py-10">
      <header className="mx-auto max-w-7xl mb-6 flex items-center justify-between">
        <h1 className="heading text-2xl sm:text-3xl text-indigo-200">One Night Werewolf</h1>
        <div className="flex items-center gap-3 text-sm">
          {!connected && everConnected && (
            <span className="text-amber-300">Reconnecting…</span>
          )}
          {!connected && !everConnected && (
            <span className="text-slate-400">Connecting…</span>
          )}
          {session && room && (
            <>
              <span className="text-slate-400">
                Room <CopyableCode code={room.code} className="text-slate-100" />
              </span>
              <button onClick={leaveRoom} className="btn-ghost text-xs px-2 py-1">
                Leave
              </button>
            </>
          )}
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-7xl mb-4 rounded-md border border-rose-700 bg-rose-950/60 px-3 py-2 text-rose-200 text-sm">
          {error}{" "}
          <button onClick={() => setError(null)} className="underline">
            dismiss
          </button>
        </div>
      )}

      {!session && <Home onJoined={() => {}} />}
      {session && !room && <div className="mx-auto max-w-md panel text-center">Joining room…</div>}
      {session && room && room.phase === "lobby" && <Lobby room={room} me={me} />}
      {session && room && room.phase !== "lobby" && <Game room={room} me={me} />}
    </div>
  );
}
