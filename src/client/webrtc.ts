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

// Active-speaker analysis. One AudioContext for the page, one AnalyserNode per
// peer (and one for our local mic). The animation loop reads byte frequency
// data and stores a 0..1 level per playerId. Components subscribe via
// useSpeakingLevel(playerId) and re-render when their level meaningfully
// changes.
let audioCtx: AudioContext | null = null;
type AnalyzerEntry = {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  rafId: number;
};
const analyzers = new Map<string, AnalyzerEntry>();
const speakingLevels = new Map<string, number>();
const speakingListeners = new Set<() => void>();

function getAudioCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  const Ctor =
    (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioCtx = new Ctor();
  return audioCtx;
}

function startAnalyzer(playerId: string, stream: MediaStream) {
  if (analyzers.has(playerId)) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    return;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  // Don't connect the analyser onward — playback comes from the
  // <audio> element directly. Connecting to ctx.destination would
  // double-play.
  const data = new Uint8Array(analyser.frequencyBinCount);
  let lastNotified = 0;
  function tick() {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length / 255;
    speakingLevels.set(playerId, avg);
    if (Math.abs(avg - lastNotified) > 0.02) {
      lastNotified = avg;
      for (const fn of speakingListeners) fn();
    }
    rafId = requestAnimationFrame(tick);
  }
  let rafId = requestAnimationFrame(tick);
  analyzers.set(playerId, { source, analyser, rafId });
}

function stopAnalyzer(playerId: string) {
  const a = analyzers.get(playerId);
  if (!a) return;
  cancelAnimationFrame(a.rafId);
  try {
    a.source.disconnect();
  } catch {}
  try {
    a.analyser.disconnect();
  } catch {}
  analyzers.delete(playerId);
  if (speakingLevels.has(playerId)) {
    speakingLevels.delete(playerId);
    for (const fn of speakingListeners) fn();
  }
}

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
    // Start watching this peer's volume for the active-speaker indicator.
    startAnalyzer(peerId, ev.streams[0]);
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
  stopAnalyzer(peerId);
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
  // Tear down any listen-only peer connections we'd already established —
  // the next syncPeers (after the server confirms hasMic=true) rebuilds
  // them with our new tracks added at creation time. Avoids the SDP
  // renegotiation dance.
  for (const id of [...peers.keys()]) destroyPeer(id);
  micEnabledState = true;
  // Watch our own mic level so our own tile pulses when we talk.
  if (myPlayerId) startAnalyzer(myPlayerId, localStream);
  socket.emit("audio:setReady", { ready: true });
  notify();
  return { ok: true };
}

export function stopMic(): void {
  if (myPlayerId) stopAnalyzer(myPlayerId);
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  micEnabledState = false;
  socket.emit("audio:setReady", { ready: false });
  // Tear down peer connections — they were carrying our tracks. The next
  // syncPeers rebuilds them as listen-only (we still hear the mic-enabled
  // peers).
  for (const id of [...peers.keys()]) destroyPeer(id);
  notify();
}

export function micEnabled(): boolean {
  return micEnabledState;
}

// Called on every room state. Bring the peer set into line with the
// current room: connect to mic-ready peers we don't have, drop peers who
// are gone, and (re)apply the audio mask.
//
// Listen-only is supported: we form a peer connection whenever EITHER side
// has a mic enabled, so a player without their mic still receives audio
// from mic-enabled peers. With no mic on either side, there's nothing to
// transmit, so we skip — saves a useless connection.
export function syncPeers(room: PublicRoom): void {
  if (!myPlayerId) return;

  const wanted = new Set<string>();
  for (const p of room.players) {
    if (p.id === myPlayerId) continue;
    if (!p.connected) continue;
    // At least one side must have mic for the connection to carry audio.
    if (!p.hasMic && !micEnabledState) continue;
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
//
// Layered on top:
//   - room.spectatorsMuted forces spectator canSpeak=false in every phase.
//   - room.mutedExceptHost forces every non-host canSpeak=false (announcement
//     mode — only the host's mic is broadcasting).
export function applyAudioMask(room: PublicRoom): void {
  if (!myPlayerId) return;
  const me = room.players.find((p) => p.id === myPlayerId);
  if (!me) return;
  const myCat = me.spectating ? "spectator" : "player";
  const spectatorsMuted = !!room.spectatorsMuted;
  const mutedExceptHost = !!room.mutedExceptHost;
  const iAmHost = !!me.isHost;
  applyLocalSpeak(canSpeak(myCat, room.phase, spectatorsMuted, mutedExceptHost, iAmHost));
  for (const [peerId, e] of peers) {
    const peer = room.players.find((p) => p.id === peerId);
    const peerCat = peer?.spectating ? "spectator" : "player";
    e.maskMuted = !peer || !canHear(myCat, peerCat, room.phase);
    applyEntryVolume(e);
  }
}

type Cat = "player" | "spectator";

function canSpeak(
  myCat: Cat,
  phase: Phase,
  spectatorsMuted: boolean,
  mutedExceptHost: boolean,
  iAmHost: boolean,
): boolean {
  if (mutedExceptHost && !iAmHost) return false;
  if (myCat === "spectator" && spectatorsMuted) return false;
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
  // Accept incoming offers even without local mic — listen-only is allowed
  // and the peer's offer carries the tracks we want to play.
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

// Live volume level for a player (0..1). Returns 0 when no analyzer is
// running for that player (no mic, not connected, not yet receiving audio).
// Re-renders only when the level changes by more than ~2%, so a tile that
// isn't speaking doesn't churn render every frame.
export function useSpeakingLevel(playerId: string | undefined): number {
  const [level, setLevel] = useState(() =>
    playerId ? (speakingLevels.get(playerId) ?? 0) : 0,
  );
  useEffect(() => {
    if (!playerId) return;
    const fn = () => setLevel(speakingLevels.get(playerId) ?? 0);
    speakingListeners.add(fn);
    fn();
    return () => {
      speakingListeners.delete(fn);
    };
  }, [playerId]);
  return level;
}
