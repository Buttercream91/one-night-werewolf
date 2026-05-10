import { useEffect, useRef, useState } from "react";
import type { NightPrompt, NightStep, PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";
import { send } from "../socket.js";
import { useCountdown } from "../useCountdown.js";
import { CenterCards, type CenterMode } from "./CenterCards.js";
import { NotesPanel } from "./NotesPanel.js";
import { RoleCard } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function NightPhase({ room, me }: Props) {
  const myRole = me.cardFaceDown ? undefined : (me.myKnownCurrentRole ?? me.myOriginalRole);
  const remaining = useCountdown(room.nightStepEndsAt);
  const audioBlocked = useStepAudio(room.nightStep, room.nightStepVoiceUrl);

  // The Seer has a sub-mode (player vs center). Keep it here so the CenterCards
  // up top knows when the Seer is in center-pick mode.
  const [seerMode, setSeerMode] = useState<"player" | "center" | null>(null);
  const [centerSelections, setCenterSelections] = useState<number[]>([]);

  // Reset Seer state whenever the prompt changes (new step or done).
  const promptKey = me.prompt?.kind ?? "none";
  useEffect(() => {
    setSeerMode(null);
    setCenterSelections([]);
  }, [promptKey]);

  const centerMode = computeCenterMode(me.prompt, seerMode);

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="heading text-xl text-indigo-200">Night phase</h2>
            <p className="text-sm text-slate-400 mt-1">
              Stay quiet. Each role has a fixed amount of time, whether or not anyone is playing
              that role.
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-3xl text-slate-100 tabular-nums">{remaining}s</div>
            <div className="text-xs text-slate-400">until next role</div>
          </div>
        </div>
      </div>

      <div className="panel text-center">
        {room.nightStep && (
          <p className="text-lg text-indigo-200 heading">{moderatorLine(room.nightStep)}</p>
        )}
        {audioBlocked && (
          <button onClick={() => unlockAudio()} className="mt-3 btn-ghost text-xs">
            🔊 Tap to enable narration
          </button>
        )}
      </div>

      <CenterCards
        me={me}
        mode={centerMode}
        selected={centerSelections}
        setSelected={setCenterSelections}
      />

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            {me.prompt ? (
              <ActionForm
                room={room}
                me={me}
                seerMode={seerMode}
                setSeerMode={setSeerMode}
              />
            ) : (
              <div className="text-center text-slate-400 py-6 italic">
                {me.myOriginalRole && actorIsForStep(me.myOriginalRole, room.nightStep)
                  ? "You've acted. Waiting for the night to advance…"
                  : "Stay quiet — it's not your turn."}
              </div>
            )}
          </div>
          <NotesPanel me={me} room={room} />
        </div>
        <div className="panel flex flex-col items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-slate-400">Your card</span>
          {myRole ? (
            <RoleCard role={myRole} />
          ) : me.cardFaceDown ? (
            <RoleCard faceDown caption="Unknown" />
          ) : (
            <div className="text-slate-400">Loading…</div>
          )}
          {me.myKnownCurrentRole &&
            me.myKnownCurrentRole !== me.myOriginalRole &&
            me.myOriginalRole && (
              <span className="text-xs text-amber-300">
                (was {ROLE_META[me.myOriginalRole].label})
              </span>
            )}
        </div>
      </div>
    </div>
  );
}

function computeCenterMode(prompt: NightPrompt | undefined, seerSubMode: "player" | "center" | null): CenterMode {
  if (!prompt) return "view";
  if (prompt.kind === "werewolf_lone") return "lone-wolf";
  if (prompt.kind === "drunk_choose") return "drunk";
  if (prompt.kind === "seer_choose" && seerSubMode === "center") return "seer-center";
  return "view";
}

function ActionForm({
  room,
  me,
  seerMode,
  setSeerMode,
}: {
  room: PublicRoom;
  me: PrivateView;
  seerMode: "player" | "center" | null;
  setSeerMode: (m: "player" | "center" | null) => void;
}) {
  const prompt = me.prompt!;
  return (
    <div>
      <p className="text-slate-100">{prompt.message}</p>
      <div className="mt-4">
        {prompt.kind === "ack" && <AckButton />}
        {prompt.kind === "doppelganger_choose" && (
          <DoppelgangerControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "werewolf_lone" && <LoneWolfControls />}
        {prompt.kind === "seer_choose" && (
          <SeerControls room={room} me={me} mode={seerMode} setMode={setSeerMode} />
        )}
        {prompt.kind === "robber_choose" && (
          <RobberControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "troublemaker_choose" && (
          <TroublemakerControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "drunk_choose" && (
          <p className="text-sm text-slate-400 italic">Click a center card above to take it.</p>
        )}
      </div>
    </div>
  );
}

function AckButton() {
  return (
    <button className="btn-primary" onClick={() => send.nightAction({ kind: "ack" })}>
      Got it
    </button>
  );
}

function DoppelgangerControls({ room, eligibleIds }: { room: PublicRoom; eligibleIds: string[] }) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => (
        <button
          key={p.id}
          className="btn-ghost"
          onClick={() => send.nightAction({ kind: "doppelganger_copy", targetId: p.id })}
        >
          Copy {p.name}
        </button>
      ))}
    </div>
  );
}

function LoneWolfControls() {
  return (
    <div className="flex flex-wrap gap-2">
      <p className="text-sm text-slate-400 italic">Click a center card above to peek, or skip.</p>
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "werewolf_lone_view", centerIndex: null })}
      >
        Skip
      </button>
    </div>
  );
}

function SeerControls({
  room,
  me,
  mode,
  setMode,
}: {
  room: PublicRoom;
  me: PrivateView;
  mode: "player" | "center" | null;
  setMode: (m: "player" | "center" | null) => void;
}) {
  const others = room.players.filter((p) => p.id !== me.myId);
  function viewPlayer(targetId: string) {
    send.nightAction({ kind: "seer_view_player", targetId });
  }
  if (mode === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost" onClick={() => setMode("player")}>
          Look at one player's card
        </button>
        <button className="btn-ghost" onClick={() => setMode("center")}>
          Look at two center cards
        </button>
        <button className="btn-ghost" onClick={() => send.nightAction({ kind: "seer_skip" })}>
          Skip
        </button>
      </div>
    );
  }
  if (mode === "player") {
    return (
      <div className="flex flex-wrap gap-2">
        {others.map((p) => (
          <button key={p.id} className="btn-ghost" onClick={() => viewPlayer(p.id)}>
            {p.name}
          </button>
        ))}
        <button className="btn-ghost" onClick={() => setMode(null)}>
          Back
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <p className="text-sm text-slate-400 italic">Click 2 center cards above to peek.</p>
      <button className="btn-ghost" onClick={() => setMode(null)}>
        Back
      </button>
    </div>
  );
}

function RobberControls({ room, eligibleIds }: { room: PublicRoom; eligibleIds: string[] }) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => (
        <button
          key={p.id}
          className="btn-ghost"
          onClick={() => send.nightAction({ kind: "robber_swap", targetId: p.id })}
        >
          Rob {p.name}
        </button>
      ))}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "robber_swap", targetId: null })}
      >
        Skip
      </button>
    </div>
  );
}

function TroublemakerControls({
  room,
  eligibleIds,
}: {
  room: PublicRoom;
  eligibleIds: string[];
}) {
  const [picks, setPicks] = useState<string[]>([]);
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  function toggle(id: string) {
    if (picks.includes(id)) {
      setPicks(picks.filter((x) => x !== id));
    } else if (picks.length < 2) {
      const next = [...picks, id];
      if (next.length === 2) {
        send.nightAction({ kind: "troublemaker_swap", targetIds: next as [string, string] });
        return;
      }
      setPicks(next);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => (
        <button
          key={p.id}
          className={`btn-ghost ${picks.includes(p.id) ? "ring-2 ring-indigo-400" : ""}`}
          onClick={() => toggle(p.id)}
        >
          {p.name}
        </button>
      ))}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "troublemaker_swap", targetIds: null })}
      >
        Skip
      </button>
    </div>
  );
}

// On-screen narration that mirrors the audio. Everyone sees the same line for
// each step regardless of whether the role is in play.
function moderatorLine(step: NightStep): string {
  switch (step) {
    case "intro":
      return "Everyone, close your eyes. The night begins.";
    case "doppelganger":
      return "Doppelganger, open your eyes and look at another player's card.";
    case "werewolves":
      return "Werewolves, open your eyes and look for other Werewolves.";
    case "minion":
      return "Minion, open your eyes and look for the Werewolves.";
    case "masons":
      return "Masons, open your eyes and look for other Masons.";
    case "seer":
      return "Seer, open your eyes. You may look at one player's card or two center cards.";
    case "robber":
      return "Robber, open your eyes. You may exchange your card with another player's.";
    case "troublemaker":
      return "Troublemaker, open your eyes. You may swap two other players' cards.";
    case "drunk":
      return "Drunk, open your eyes and exchange your card with one in the center.";
    case "insomniac":
      return "Insomniac, open your eyes and look at your card.";
    case "outro":
      return "Everyone, wake up. The night is over.";
  }
}

// Did this *original* role take the current step? Used to label the "you've acted" message.
function actorIsForStep(originalRole: Role, step: NightStep | undefined): boolean {
  if (!step) return false;
  if (step === "werewolves") return originalRole === "werewolf";
  if (step === "masons") return originalRole === "mason";
  if (step === "intro" || step === "outro") return false;
  return originalRole === step;
}

let audioUnlocked = false;
const audioElement: HTMLAudioElement | null = typeof Audio === "undefined" ? null : new Audio();
function unlockAudio() {
  if (!audioElement) return;
  audioElement.muted = true;
  const p = audioElement.play();
  if (p) {
    p.then(() => {
      audioElement.pause();
      audioElement.muted = false;
      audioUnlocked = true;
      window.dispatchEvent(new Event("onuw-audio-unlocked"));
    }).catch(() => {});
  }
}
function useStepAudio(step: NightStep | undefined, url: string | undefined): boolean {
  const [blocked, setBlocked] = useState(false);
  const lastStep = useRef<NightStep | undefined>(undefined);
  useEffect(() => {
    function onUnlocked() {
      setBlocked(false);
    }
    window.addEventListener("onuw-audio-unlocked", onUnlocked);
    return () => window.removeEventListener("onuw-audio-unlocked", onUnlocked);
  }, []);
  useEffect(() => {
    if (!step || step === lastStep.current) return;
    lastStep.current = step;
    if (!url || !audioElement) return;
    audioElement.src = url;
    const p = audioElement.play();
    if (p) {
      p.then(() => {
        audioUnlocked = true;
        setBlocked(false);
      }).catch(() => {
        if (!audioUnlocked) setBlocked(true);
      });
    }
  }, [step, url]);
  return blocked;
}
