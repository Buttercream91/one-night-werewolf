import { useEffect, useRef, useState } from "react";
import type { PrivateView, PublicRoom } from "../shared/types.js";
import { CopyableCode } from "./components/CopyableCode.js";
import { Game } from "./components/Game.js";
import { Home } from "./components/Home.js";
import { Lobby } from "./components/Lobby.js";
import { joinRoom, send, socket } from "./socket.js";
import {
  setMusicMuted,
  setMusicVolume,
  startMusic,
  stopMusic,
  useMusicControls,
} from "./music.js";
import { setServerTimeOffset } from "./useCountdown.js";
import { clearSession, loadSession, saveSession, type SessionData } from "./storage.js";

// Pool of looping night-phase tracks. One is chosen at random when the night
// phase begins and loops for the rest of that game; a fresh pick happens on
// the next game's night.
const NIGHT_MUSIC_URLS = ["/audio/night-music-1.mp3", "/audio/night-music-2.mp3"];

function pickNightTrack(): string {
  return NIGHT_MUSIC_URLS[Math.floor(Math.random() * NIGHT_MUSIC_URLS.length)];
}

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

  // Music plays during the night phase only. A track is picked at random the
  // first moment we enter night and loops for the rest of that game; once the
  // phase leaves night (day/vote/reveal), the choice is reset so the next
  // game gets a fresh pick. Pausing keeps the same track but stops playback;
  // resuming restarts it.
  const currentTrack = useRef<string | null>(null);
  useEffect(() => {
    const inNight = !!room && room.phase === "night";
    if (inNight && currentTrack.current === null) {
      currentTrack.current = pickNightTrack();
    } else if (!inNight && currentTrack.current !== null) {
      currentTrack.current = null;
    }
    const playing = inNight && !room?.paused;
    if (playing && currentTrack.current) startMusic(currentTrack.current);
    else stopMusic();
  }, [room?.phase, room?.paused]);

  function leaveRoom() {
    socket.emit("room:leave");
    clearSession();
    setSession(null);
    setRoom(null);
    setMe(null);
    stopMusic();
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
              <MusicControls />
              {room.paused && (
                <span className="text-xs uppercase tracking-wider px-2 py-1 rounded border border-amber-700 bg-amber-950/50 text-amber-300">
                  Paused
                </span>
              )}
              {room.phase !== "lobby" && room.phase !== "reveal" && me && (
                <PauseButton room={room} myId={me.myId} />
              )}
              {room.phase !== "lobby" && me && (
                <BackToLobbyButton room={room} myId={me.myId} />
              )}
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

function MusicControls() {
  const { volume, muted } = useMusicControls();
  return (
    <div className="flex items-center gap-1.5">
      <button
        className="text-xs px-1.5 py-0.5 rounded text-slate-300 hover:text-slate-100"
        onClick={() => setMusicMuted(!muted)}
        title={muted ? "Unmute music" : "Mute music"}
      >
        {muted ? "🔇" : volume === 0 ? "🔈" : volume < 0.5 ? "🔉" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        disabled={muted}
        onChange={(e) => setMusicVolume(Number(e.target.value))}
        className="w-16 accent-indigo-400"
        title="Music volume"
      />
    </div>
  );
}

function PauseButton({ room, myId }: { room: PublicRoom; myId: string }) {
  const me = room.players.find((p) => p.id === myId);
  if (!me?.isHost) return null;
  const paused = !!room.paused;
  return (
    <button
      className="btn-ghost text-xs px-2 py-1"
      onClick={() => send.pause(!paused)}
      title={paused ? "Resume the round" : "Pause timers and freeze player actions"}
    >
      {paused ? "Resume" : "Pause"}
    </button>
  );
}

function BackToLobbyButton({ room, myId }: { room: PublicRoom; myId: string }) {
  const me = room.players.find((p) => p.id === myId);
  if (me?.spectating) {
    return <span className="text-xs text-slate-400">spectating</span>;
  }
  return (
    <button
      className="btn-ghost text-xs px-2 py-1"
      onClick={() => {
        if (
          confirm(
            "Step out for the rest of this round? Your card stays in the deck but you stop acting. You'll be back in the lobby when the round ends.",
          )
        ) {
          send.spectate();
        }
      }}
      title="Step back to spectate the rest of this round"
    >
      Back to lobby
    </button>
  );
}
