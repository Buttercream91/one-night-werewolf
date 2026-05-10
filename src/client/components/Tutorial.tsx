import { useEffect, useRef, useState } from "react";
import { DEFAULT_VOICE_PACK, type Role } from "../../shared/types.js";
import { loadNarrator } from "../storage.js";
import { RoleCard } from "./RoleCard.js";

// One-page guided tour of the rules and the interface. Each step has an
// optional audio clip; we try the user's preferred narrator pack first and
// fall back to bill (DEFAULT_VOICE_PACK) on load failure.
//
// Audio file naming: /voice/<pack>/Tutorial_<id>.mp3.

interface Step {
  id: string; // matches the audio filename's tail.
  title: string;
  text: string;
  // Optional role illustration shown beside the text.
  role?: Role;
  // Free-form footnote (rendered smaller, italic) for tip-style notes.
  note?: string;
}

const STEPS: Step[] = [
  {
    id: "Welcome",
    title: "Welcome",
    text:
      "Welcome to One Night Ultimate Werewolf. Each round, every player gets one role and the village has one night to find the wolves. This tour walks through the rules and the controls.",
  },
  {
    id: "Setup",
    title: "Setup",
    text:
      "At the start of a round the deck is dealt. Every player gets a face-down role card. Three extra cards are placed in the centre. Nobody starts holding a centre card.",
  },
  {
    id: "Phases",
    title: "The three phases",
    text:
      "Each round has three phases. Night, where roles act in secret. Day, where you talk it out. Vote, where the village decides who dies.",
  },
  {
    id: "Goal",
    title: "How you win",
    text:
      "Villagers win if they kill at least one Werewolf. Werewolves and the Minion win if no Werewolf is killed. The Tanner wins only if they themselves are killed by the vote.",
  },
  {
    id: "Werewolf",
    title: "Werewolf",
    text:
      "Werewolves wake at night and see each other. If you are the only Werewolf, you may peek at one of the centre cards to learn what's not in play.",
    role: "werewolf",
  },
  {
    id: "Minion",
    title: "Minion",
    text:
      "The Minion sees the Werewolves but the Werewolves don't see them. The Minion wins with the wolf team — even if the Minion themselves is killed.",
    role: "minion",
  },
  {
    id: "Mason",
    title: "Mason",
    text:
      "The two Masons wake together and see each other. They are villagers and trust each other on sight. If only one Mason is in play, that Mason knows it.",
    role: "mason",
  },
  {
    id: "Seer",
    title: "Seer",
    text:
      "The Seer can look at one other player's card, or peek at two of the three centre cards. Their report is reliable — anyone claiming Seer should be tested.",
    role: "seer",
  },
  {
    id: "Robber",
    title: "Robber",
    text:
      "The Robber swaps their card with another player's, then peeks at their new card. The other player becomes the Robber and doesn't know it.",
    role: "robber",
  },
  {
    id: "Troublemaker",
    title: "Troublemaker",
    text:
      "The Troublemaker swaps two other players' cards without looking. The two players don't know they were swapped. Chaos ensues.",
    role: "troublemaker",
  },
  {
    id: "Drunk",
    title: "Drunk",
    text:
      "The Drunk swaps their card with one of the centre cards without looking. They almost certainly aren't a Drunk anymore — they just don't know what they are.",
    role: "drunk",
  },
  {
    id: "Insomniac",
    title: "Insomniac",
    text:
      "The Insomniac wakes at the very end of the night and looks at their own card. If a Robber or Troublemaker swapped them, the Insomniac sees what they actually are now.",
    role: "insomniac",
  },
  {
    id: "Hunter",
    title: "Hunter",
    text:
      "The Hunter has no night action. If the Hunter is killed by the village vote, the player the Hunter voted for also dies.",
    role: "hunter",
  },
  {
    id: "Tanner",
    title: "Tanner",
    text:
      "The Tanner is on no team. They win only if the village kills them, and they lose if anyone else dies — including no one. Convince the village you're a wolf.",
    role: "tanner",
  },
  {
    id: "Doppelganger",
    title: "Doppelganger",
    text:
      "The Doppelganger acts first. They look at another player's card and become a copy of that role. If they copy a Werewolf, they're now a Werewolf. They act on the copied role's turn.",
    role: "doppelganger",
  },
  {
    id: "Villager",
    title: "Villager",
    text:
      "Villagers have no night action. They win with the village team. They listen, talk, and vote.",
    role: "villager",
  },
  {
    id: "Night",
    title: "Night phase",
    text:
      "During the night, the app calls each role in turn. Only that role is awake; the rest stay quiet. Spectators can chat with each other. Players are silent and deaf.",
  },
  {
    id: "Day",
    title: "Day phase",
    text:
      "Once the night is over, the day timer starts. Talk it out — accuse, claim a role, lie if you have to. Players talk among themselves. Spectators can hear the players but can't speak.",
  },
  {
    id: "Accuse",
    title: "Accusing",
    text:
      "On a player's tile, click Accuse to publicly call out which role you think they are. You can hold accusations against multiple targets. Accusations are coloured by who made them.",
  },
  {
    id: "Vote",
    title: "Voting",
    text:
      "When the day timer ends or everyone hits Ready, the vote begins. Pick a player to kill. The player with the most votes dies — ties die together. Nobody dies if no one gets two votes.",
  },
  {
    id: "Winning",
    title: "Who wins",
    text:
      "If a Werewolf was killed, villagers win. If no Werewolf was killed, the wolf team wins. The Tanner wins only if killed alone. House rule: in a wolfless game, killing the Minion is a village win, killing a villager is a wolf-team win.",
  },
  {
    id: "Wrap",
    title: "Ready to play",
    text:
      "That's it. Create a room, share the code with your friends, and have fun. Tip: jump on a separate voice call too if voice chat in-app fails for anyone — the app handles role logic, you handle the deceiving.",
  },
];

interface Props {
  onExit: () => void;
}

export function Tutorial({ onExit }: Props) {
  const [idx, setIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const step = STEPS[idx];

  // Play the step's narration when the step changes. Try the user's preferred
  // pack first and fall back to bill on a 404 / decode error.
  useEffect(() => {
    if (!audioRef.current) return;
    const a = audioRef.current;
    a.pause();
    const userPack = loadNarrator() ?? DEFAULT_VOICE_PACK;
    const userUrl = `/voice/${userPack}/Tutorial_${step.id}.mp3`;
    let triedFallback = false;
    function onError() {
      if (!triedFallback && userPack !== DEFAULT_VOICE_PACK) {
        triedFallback = true;
        a.src = `/voice/${DEFAULT_VOICE_PACK}/Tutorial_${step.id}.mp3`;
        a.play().catch(() => {});
      }
    }
    a.onerror = onError;
    a.src = userUrl;
    a.play().catch(() => {});
  }, [idx, step.id]);

  function replay() {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  }

  function next() {
    if (idx < STEPS.length - 1) setIdx(idx + 1);
  }
  function prev() {
    if (idx > 0) setIdx(idx - 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="panel">
        <div className="flex items-center justify-between gap-3 mb-1">
          <span className="text-xs uppercase tracking-wider text-indigo-300">
            Step {idx + 1} of {STEPS.length}
          </span>
          <button onClick={onExit} className="btn-ghost text-xs px-2 py-1">
            Exit tutorial
          </button>
        </div>
        <h2 className="heading text-2xl text-indigo-200 mt-1">{step.title}</h2>
        <div className="mt-4 grid sm:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <p className="text-slate-100 leading-relaxed">{step.text}</p>
            {step.note && (
              <p className="mt-2 text-xs italic text-slate-400">{step.note}</p>
            )}
          </div>
          {step.role && <RoleCard role={step.role} size="sm" />}
        </div>
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={prev}
          disabled={idx === 0}
          className="btn-ghost"
        >
          ← Back
        </button>
        <div className="flex items-center gap-2">
          <button onClick={replay} className="btn-ghost text-sm" title="Replay narration">
            🔊 Replay
          </button>
        </div>
        {idx < STEPS.length - 1 ? (
          <button onClick={next} className="btn-primary">
            Next →
          </button>
        ) : (
          <button onClick={onExit} className="btn-primary">
            Done
          </button>
        )}
      </div>

      {/* Hidden audio element driven by the step effect. */}
      <audio ref={audioRef} preload="auto" />
    </div>
  );
}
