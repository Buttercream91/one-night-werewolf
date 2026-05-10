import { useEffect, useRef, useState } from "react";
import type { PublicPlayer, PublicRoom } from "../../shared/types.js";
import { send } from "../socket.js";
import {
  getPeerMuted,
  getPeerVolume,
  setPeerMuted,
  setPeerVolume,
} from "../webrtc.js";

// 3-dot menu attached to a player tile. Local-device options (volume / mute)
// are always available. Self-options (spectate) appear on your own tile.
// Host-only options (kick, force-spectate, promote) appear when the viewer
// is the host and the target isn't them.
//
// In contexts where a host action would be nonsensical (e.g. mid-game force
// spectate is possible but kick is lobby-only), we simply gate the action
// behind `where`.

interface Props {
  target: PublicPlayer;
  room: PublicRoom;
  myId: string;
  // Lobby supports kick (rotates code); mid-game tiles don't.
  where: "lobby" | "game";
}

export function PlayerMenu({ target, room, myId, where }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click outside closes the menu.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const me = room.players.find((p) => p.id === myId);
  const isMe = target.id === myId;
  const iAmHost = !!me?.isHost;
  const targetIsHost = target.isHost;
  const targetIsForcedSpec = !!target.forcedSpectating;
  const targetIsSpec = !!target.spectating;

  return (
    <div ref={ref} className="relative">
      <button
        className="text-slate-400 hover:text-slate-200 px-1 leading-none"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        title="Player options"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-52 rounded-md border border-slate-700 bg-slate-900 shadow-xl text-sm text-slate-100">
          {/* Volume / mute (local device only — controls our remote audio
              element for this peer; harmless before voice chat is wired). */}
          {!isMe && (
            <PeerVolumeRow targetId={target.id} />
          )}
          {!isMe && <Sep />}

          {isMe && (
            <>
              {!target.isHost && !targetIsForcedSpec && (
                <Item
                  label={targetIsSpec ? "Join the game" : "Switch to spectator"}
                  onClick={() => {
                    send.spectate(!targetIsSpec);
                    setOpen(false);
                  }}
                />
              )}
              {targetIsForcedSpec && (
                <ItemDisabled label="Spectator (locked by host)" />
              )}
            </>
          )}

          {iAmHost && !isMe && (
            <>
              {isMe ? null : <Sep />}
              <Item
                label={targetIsForcedSpec ? "Release from spectator" : "Move to spectator"}
                onClick={() => {
                  send.forceSpectate(target.id, !targetIsForcedSpec);
                  setOpen(false);
                }}
                title={
                  targetIsForcedSpec
                    ? "Lift the spectator lock — the player can opt back in"
                    : "Move them to spectator. Only you can release them."
                }
              />
              {!targetIsHost && (
                <Item
                  label="Promote to host"
                  onClick={() => {
                    if (
                      confirm(
                        `Promote ${target.name} to host? You'll lose host controls and become a regular player.`,
                      )
                    ) {
                      send.promoteHost(target.id);
                      setOpen(false);
                    }
                  }}
                />
              )}
              {where === "lobby" && (
                <Item
                  label="Kick from room"
                  destructive
                  onClick={() => {
                    if (confirm(`Kick ${target.name}? The room code will change.`)) {
                      send.kick(target.id);
                      setOpen(false);
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Item({
  label,
  onClick,
  destructive,
  title,
}: {
  label: string;
  onClick: () => void;
  destructive?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-full text-left px-3 py-2 hover:bg-slate-800 ${
        destructive ? "text-rose-300 hover:text-rose-200" : ""
      }`}
    >
      {label}
    </button>
  );
}

function ItemDisabled({ label }: { label: string }) {
  return <div className="px-3 py-2 text-slate-500 italic">{label}</div>;
}

function Sep() {
  return <div className="border-t border-slate-800" />;
}

// Per-peer volume + mute, both stored locally. Pre-voice-chat these are
// no-ops on actual playback (no remote audio element exists yet) but the UI
// state still persists so the value is in place when audio lands.
function PeerVolumeRow({ targetId }: { targetId: string }) {
  const [volume, setVolume] = useState(() => getPeerVolume(targetId));
  const [muted, setMuted] = useState(() => getPeerMuted(targetId));

  function changeVolume(v: number) {
    setVolume(v);
    setPeerVolume(targetId, v);
  }
  function toggleMute() {
    const next = !muted;
    setMuted(next);
    setPeerMuted(targetId, next);
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">Audio</span>
        <button
          className="text-xs text-slate-300 hover:text-slate-100"
          onClick={toggleMute}
          title={muted ? "Unmute" : "Mute"}
        >
          {muted ? "🔇 Muted" : "🔊"}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        disabled={muted}
        onChange={(e) => changeVolume(Number(e.target.value))}
        className="w-full mt-1 accent-indigo-400"
      />
    </div>
  );
}
