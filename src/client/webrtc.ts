// Per-peer audio controls. The actual WebRTC layer (mic capture, peer
// connections, remote audio elements) lands in a follow-up commit; this
// module exposes stable getters/setters used by the 3-dot menu so the UI
// is in place when voice chat is wired in.

const volumes = new Map<string, number>();
const muted = new Map<string, boolean>();

export function getPeerVolume(peerId: string): number {
  return volumes.get(peerId) ?? 1;
}

export function setPeerVolume(peerId: string, v: number) {
  volumes.set(peerId, Math.max(0, Math.min(1, v)));
  // TODO: apply to the corresponding remote audio element once peer
  // connections are wired.
}

export function getPeerMuted(peerId: string): boolean {
  return muted.get(peerId) ?? false;
}

export function setPeerMuted(peerId: string, m: boolean) {
  muted.set(peerId, m);
  // TODO: apply to the corresponding remote audio element once peer
  // connections are wired.
}
