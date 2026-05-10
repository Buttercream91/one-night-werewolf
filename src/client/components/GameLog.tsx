import type { ActionLogEntry, PublicRoom } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";

interface Props {
  room: PublicRoom;
}

// Chronological narrative of the night and vote, shown only at reveal.
export function GameLog({ room }: Props) {
  const log = room.actionLog ?? [];
  const nameOf = (id: string) => room.players.find((p) => p.id === id)?.name ?? "?";

  if (log.length === 0) return null;

  return (
    <div className="panel">
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">Game log</h3>
      <ol className="space-y-1.5 text-sm text-slate-200">
        {log.map((entry, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-1.5 inline-block h-1 w-1 rounded-full bg-slate-500 shrink-0" />
            <span>{describeEntry(entry, nameOf)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function describeEntry(e: ActionLogEntry, nameOf: (id: string) => string): string {
  switch (e.kind) {
    case "doppelganger_copied":
      return `${nameOf(e.actorId)} (Doppelganger) copied ${nameOf(e.targetId)} and became ${ROLE_META[e.copiedRole].label}.`;
    case "werewolves_revealed":
      return `Werewolves saw each other: ${e.actorIds.map(nameOf).join(", ")}.`;
    case "lone_wolf_peeked":
      return `${nameOf(e.actorId)} (lone Werewolf) peeked center ${e.centerIndex + 1} — ${ROLE_META[e.role].label}.`;
    case "lone_wolf_skipped":
      return `${nameOf(e.actorId)} (lone Werewolf) skipped the center peek.`;
    case "minion_saw_werewolves":
      return e.werewolfIds.length === 0
        ? `${nameOf(e.actorId)} (Minion) saw there were no Werewolves in play.`
        : `${nameOf(e.actorId)} (Minion) saw the Werewolves: ${e.werewolfIds.map(nameOf).join(", ")}.`;
    case "masons_revealed":
      return `Masons saw each other: ${e.actorIds.map(nameOf).join(", ")}.`;
    case "lone_mason":
      return `${nameOf(e.actorId)} (Mason) saw no other Mason was in play.`;
    case "seer_saw_player":
      return `${nameOf(e.actorId)} (Seer) looked at ${nameOf(e.targetId)}'s card — ${ROLE_META[e.role].label}.`;
    case "seer_saw_center":
      return `${nameOf(e.actorId)} (Seer) peeked center ${e.cards.map((c) => `#${c.index + 1} ${ROLE_META[c.role].label}`).join(" and ")}.`;
    case "seer_skipped":
      return `${nameOf(e.actorId)} (Seer) chose not to look.`;
    case "robber_swapped":
      return `${nameOf(e.actorId)} (Robber) stole ${nameOf(e.targetId)}'s card and became ${ROLE_META[e.newRole].label}.`;
    case "robber_skipped":
      return `${nameOf(e.actorId)} (Robber) chose not to steal.`;
    case "troublemaker_swapped":
      return `${nameOf(e.actorId)} (Troublemaker) swapped the cards of ${nameOf(e.targetIds[0])} and ${nameOf(e.targetIds[1])}.`;
    case "troublemaker_skipped":
      return `${nameOf(e.actorId)} (Troublemaker) didn't swap anyone.`;
    case "drunk_swapped":
      return `${nameOf(e.actorId)} (Drunk) traded their card with center ${e.centerIndex + 1} (without looking).`;
    case "insomniac_saw":
      return `${nameOf(e.actorId)} (Insomniac) checked their card — ${ROLE_META[e.role].label}.`;
    case "vote":
      return `${nameOf(e.voterId)} voted for ${e.targetId === "no_kill" ? "no one" : nameOf(e.targetId)}.`;
    case "killed":
      return e.via === "hunter"
        ? `${nameOf(e.targetId)} was killed by the Hunter's last vote.`
        : `${nameOf(e.targetId)} was killed by the village vote.`;
    case "no_one_died":
      return "Nobody received enough votes — no one was killed.";
  }
}
