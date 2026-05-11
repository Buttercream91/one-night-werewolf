// Small pulsing red pill rendered next to a player's name when the room is
// in server dev mode and that player is the host. Tells everyone else that
// the host has god-view powers (live roles, manual deal, force start, skip
// step, etc.) — fair-play transparency, not anti-cheat.

interface Props {
  show: boolean;
}

export function DevModeTag({ show }: Props) {
  if (!show) return null;
  return (
    <span
      className="ml-1.5 inline-block align-middle text-[10px] font-bold uppercase tracking-wider text-red-100 bg-red-700/80 border border-red-500 rounded px-1.5 py-0.5 animate-pulse"
      title="Host has dev-mode tools enabled — they can see all roles and force outcomes"
    >
      ⚠ DEV MODE
    </span>
  );
}
