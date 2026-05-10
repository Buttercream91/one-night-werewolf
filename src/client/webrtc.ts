import { useEffect, useState } from "react";
import { socket } from "./socket.js";
import type { Phase, PublicRoom } from "../shared/types.js";

// Voice chat over WebRTC mesh (peer-to-peer).
//
// Each pair of mic-enabled players in the same room maintains an
// RTCPeerConnection; SDP offers/answers and ICE candidates are relayed by
// the server via socket events. Audio plays through hidden HTMLAudioElements
// kept in the DOM so the browser doesn't suspend them.
//
// Phase-aware audio routing is layered on top: applyAudioMask decides, per
// remote peer, whether the inbound audio plays (canHear) AND, for the local
// mic, whether the track is enabled (canSpeak). When you can't speak in a
// phase, peers literally don't receive your voice — we don't rely on
// trusting them to mute.

type PeerEntry = {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  manualVolume: number;
  manualMuted: boolean;
  // Set by applyAudioMask. Final element.muted = manualMuted || maskMuted.
  maskMuted: boolean;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const peers = new Map<string, PeerEntry>();
let localStream: MediaStream | null = null;
let myPlayerId: string | null = null;
let micEnabledState = false;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function getOrCreatePeer(peerId: string): PeerEntry {
  const existing = peers.get(peerId);
  if (existing) return existing;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  // Hidden audio element kept in the DOM so the browser keeps it
  // un-suspended. autoplay so a track arriving plays without an extra play().
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  audioEl.setAttribute("playsinline", "");
  audioEl.style.display = "none";
  document.body.appendChild(audioEl);

  const entry: PeerEntry = {
    pc,
    audioEl,
    manualVolume: 1,
    manualMuted: false,
    maskMuted: false,
  };
  peers.set(peerId, entry);

  // Wire local tracks if we already have a mic.
  if (localStream) {
    for (const track of localStream.getAudioTracks()) {
      pc.addTrack(track, localStream);
    }
  }

  pc.ontrack = (ev) => {
    audioEl.srcObject = ev.streams[0];
    audioEl.play().catch(() => {
      // Autoplay can be blocked until first user gesture; ignore.
    });
  };

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      socket.emit("webrtc:ice", {
        target: peerId,
        candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : (ev.candidate as RTCIceCandidateInit),
      });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      // Connection is gone — drop the entry so syncPeers can recreate.
      destroyPeer(peerId);
    }
  };

  applyEntryVolume(entry);
  return entry;
}

function destroyPeer(peerId: string) {
  const e = peers.get(peerId);
  if (!e) return;
  try {
    e.pc.close();
  } catch {}
  if (e.audioEl) {
    e.audioEl.srcObject = null;
    e.audioEl.remove();
  }
  peers.delete(peerId);
  notify();
}

function applyEntryVolume(e: PeerEntry) {
  e.audioEl.volume = Math.max(0, Math.min(1, e.manualVolume));
  e.audioEl.muted = e.manualMuted || e.maskMuted;
}

function applyLocalSpeak(canSpeak: boolean) {
  if (!localStream) return;
  for (const track of localStream.getAudioTracks()) {
    track.enabled = canSpeak;
  }
}

// ---- Public API ----

export function setMyPlayerId(id: string | null) {
  myPlayerId = id;
}

export async function startMic(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (localStream) return { ok: true };
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, error: "Voice chat isn't supported in this browser" };
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Mic access denied: ${msg}` };
  }
  // Add tracks to any peer connections that already exist.
  for (const e of peers.values()) {
    for (const track of localStream.getAudioTracks()) {
      e.pc.addTrack(track, localStream);
    }
  }
  micEnabledState = true;
  socket.emit("audio:setReady", { ready: true });
  notify();
  return { ok: true };
}

export function stopMic(): void {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  micEnabledState = false;
  socket.emit("audio:setReady", { ready: false });
  // Tear down all peer connections — we'll rebuild when mic comes back.
  for (const id of [...peers.keys()]) destroyPeer(id);
  notify();
}

export function micEnabled(): boolean {
  return micEnabledState;
}

// Called on every room state. Bring the peer set into line with the
// current room: connect to mic-ready peers we don't have, drop peers who
// are gone, and (re)apply the audio mask.
export function syncPeers(room: PublicRoom): void {
  if (!myPlayerId) return;
  if (!micEnabledState || !localStream) {
    // We don't initiate connections until we have mic. If the room state
    // changes phase while we're mic-off, just update mask for any existing
    // (incoming-initiated) connections.
    applyAudioMask(room);
    return;
  }

  const wanted = new Set<string>();
  for (const p of room.players) {
    if (p.id === myPlayerId) continue;
    if (!p.connected) continue;
    if (!p.hasMic) continue;
    wanted.add(p.id);
  }

  // Drop peers who shouldn't be connected anymore.
  for (const peerId of [...peers.keys()]) {
    if (!wanted.has(peerId)) destroyPeer(peerId);
  }

  // Initiate connections for new peers (deterministic — the lower playerId
  // sends the offer, avoids glare).
  for (const peerId of wanted) {
    if (peers.has(peerId)) continue;
    const e = getOrCreatePeer(peerId);
    if (myPlayerId < peerId) {
      // We're the initiator.
      void initiateOffer(peerId, e);
    }
  }

  applyAudioMask(room);
}

async function initiateOffer(peerId: string, e: PeerEntry) {
  try {
    const offer = await e.pc.createOffer();
    await e.pc.setLocalDescription(offer);
    socket.emit("webrtc:offer", { target: peerId, sdp: offer });
  } catch {
    destroyPeer(peerId);
  }
}

// Phase-aware audio routing. Decides per peer whether their inbound audio
// plays, AND whether our local mic track is enabled (so we don't broadcast
// to peers we shouldn't be heard by).
//
// Rules (where category = "player" if active, "spectator" otherwise):
//   - lobby / reveal: everyone hears everyone, everyone speaks.
//   - night: only spectators speak; only spectators hear (other spectators).
//     Players are silent and deaf — even though spectators are broadcasting,
//     players don't get those streams played locally.
//   - day / vote: only PLAYERS speak. Spectators are silent listeners; they
//     hear the players. Other spectators hear nothing because no spectator
//     is broadcasting.
export function applyAudioMask(room: PublicRoom): void {
  if (!myPlayerId) return;
  const me = room.players.find((p) => p.id === myPlayerId);
  if (!me) return;
  const myCat = me.spectating ? "spectator" : "player";
  applyLocalSpeak(canSpeak(myCat, room.phase));
  for (const [peerId, e] of peers) {
    const peer = room.players.find((p) => p.id === peerId);
    const peerCat = peer?.spectating ? "spectator" : "player";
    e.maskMuted = !peer || !canHear(myCat, peerCat, room.phase);
    applyEntryVolume(e);
  }
}

type Cat = "player" | "spectator";

function canSpeak(myCat: Cat, phase: Phase): boolean {
  if (phase === "lobby" || phase === "reveal") return true;
  if (phase === "night") return myCat === "spectator";
  // day or vote — only players speak; spectators are silent listeners.
  return myCat === "player";
}

function canHear(myCat: Cat, peerCat: Cat, phase: Phase): boolean {
  if (phase === "lobby" || phase === "reveal") return true;
  if (phase === "night") return myCat === "spectator" && peerCat === "spectator";
  // day or vote — both players and spectators hear the players.
  return peerCat === "player";
}

// ---- Per-peer manual controls (3-dot menu) ----

export function getPeerVolume(peerId: string): number {
  return peers.get(peerId)?.manualVolume ?? 1;
}

export function setPeerVolume(peerId: string, v: number) {
  const e = peers.get(peerId);
  if (!e) return;
  e.manualVolume = Math.max(0, Math.min(1, v));
  applyEntryVolume(e);
}

export function getPeerMuted(peerId: string): boolean {
  return peers.get(peerId)?.manualMuted ?? false;
}

export function setPeerMuted(peerId: string, m: boolean) {
  const e = peers.get(peerId);
  if (!e) return;
  e.manualMuted = m;
  applyEntryVolume(e);
}

// ---- Signaling event handlers (wired from App on socket connect) ----

export async function handleOffer(from: string, sdp: RTCSessionDescriptionInit) {
  if (!localStream) return; // Won't accept incoming until mic is ready.
  const e = getOrCreatePeer(from);
  try {
    await e.pc.setRemoteDescription(sdp);
    const answer = await e.pc.createAnswer();
    await e.pc.setLocalDescription(answer);
    socket.emit("webrtc:answer", { target: from, sdp: answer });
  } catch {
    destroyPeer(from);
  }
}

export async function handleAnswer(from: string, sdp: RTCSessionDescriptionInit) {
  const e = peers.get(from);
  if (!e) return;
  try {
    await e.pc.setRemoteDescription(sdp);
  } catch {
    destroyPeer(from);
  }
}

export async function handleIce(from: string, candidate: RTCIceCandidateInit) {
  const e = peers.get(from);
  if (!e) return;
  try {
    await e.pc.addIceCandidate(candidate);
  } catch {
    // Late ICE can fail harmlessly; ignore.
  }
}

// ---- React hook for components that show mic state ----

export function useMicState(): { enabled: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((x) => x + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return { enabled: micEnabledState };
}
