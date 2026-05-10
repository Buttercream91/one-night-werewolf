// Per-player display color. Stable for the lifetime of the room — assigned by
// the player's index in the room's players array (which only grows in lobby
// and stays put once the game starts). Used for player names and any text
// attributable to that player (accusations, game log lines).
//
// Colors picked for legibility on the dark slate background. Avoids the
// emerald/rose/amber that already carry meaning ("ready", "killed",
// "accusation") and avoids the indigo "you" highlight.

const PLAYER_TEXT_COLORS = [
  "text-sky-300",
  "text-fuchsia-300",
  "text-lime-300",
  "text-orange-300",
  "text-cyan-300",
  "text-violet-300",
  "text-pink-300",
  "text-yellow-300",
  "text-teal-300",
  "text-red-300",
];

export function playerColor(playerId: string, players: { id: string }[]): string {
  const idx = players.findIndex((p) => p.id === playerId);
  if (idx < 0) return "text-slate-200";
  return PLAYER_TEXT_COLORS[idx % PLAYER_TEXT_COLORS.length];
}
