import { useEffect, useState } from "react";
import type { NightPrompt, NightStep, PrivateView, PublicRoom, Role } from "../../shared/types.js";
import { DEFAULT_VOICE_PACK, ROLE_META } from "../../shared/types.js";
import { unlockNarrationAudio, useStepAudio } from "../nightAudio.js";
import { send } from "../socket.js";
import { loadNarrator } from "../storage.js";
import { useCountdown } from "../useCountdown.js";
import { CenterCards, type CenterMode } from "./CenterCards.js";
import { NightProgressPanel } from "./NightProgressPanel.js";
import { NotesPanel } from "./NotesPanel.js";
import { RoleCard } from "./RoleCard.js";

interface Props {
  room: PublicRoom;
  me: PrivateView;
}

export function NightPhase({ room, me }: Props) {
  const myRole = me.cardFaceDown ? undefined : (me.myKnownCurrentRole ?? me.myOriginalRole);
  const remaining = useCountdown(room.nightStepEndsAt);
  const pack = loadNarrator() ?? DEFAULT_VOICE_PACK;
  const stepUrls = room.nightStepVoiceFiles?.map((f) => `/voice/${pack}/${f}`);
  const audioBlocked = useStepAudio(room.nightStep, stepUrls);

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

  const isIntro = room.nightStep === "intro";
  const flippedIds = room.nightIntroFlippedIds ?? [];
  // Total active humans who need to flip — same set the server gates on.
  const flipTotalIds = room.players
    .filter((p) => !p.spectating && p.connected && !p.bot)
    .map((p) => p.id);
  const flippedCount = flippedIds.length;
  const totalActiveCount = flipTotalIds.length;
  const iHaveFlipped = flippedIds.includes(me.myId);
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
          {isIntro ? (
            <div className="text-right">
              <div className="font-mono text-2xl text-slate-100 tabular-nums">
                {flippedCount}/{totalActiveCount}
              </div>
              <div className="text-xs text-slate-400">cards face down</div>
            </div>
          ) : (
            <div className="text-right">
              <div className="font-mono text-3xl text-slate-100 tabular-nums">{remaining}s</div>
              <div className="text-xs text-slate-400">until next role</div>
            </div>
          )}
        </div>
      </div>

      <NightProgressPanel selectedRoles={room.selectedRoles} currentStep={room.nightStep} />

      <div className="panel text-center">
        {room.nightStep && (
          <p className="text-lg text-indigo-200 heading">
            {moderatorLine(room.nightStep, room.selectedRoles)}
          </p>
        )}
        {audioBlocked && (
          <button onClick={() => unlockNarrationAudio()} className="mt-3 btn-ghost text-xs">
            🔊 Tap to enable narration
          </button>
        )}
      </div>

      <CenterCards
        me={me}
        room={room}
        mode={centerMode}
        selected={centerSelections}
        setSelected={setCenterSelections}
      />

      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
        <div className="space-y-6">
          <div className="panel">
            {isIntro ? (
              <div className="text-center text-slate-300 py-4">
                {iHaveFlipped ? (
                  <p>
                    Card face down. Waiting for the rest of the table…{" "}
                    <span className="text-slate-400">
                      ({flippedCount}/{totalActiveCount})
                    </span>
                  </p>
                ) : (
                  <p>
                    Look at your card, then tap it to turn it face down. The night begins
                    once everyone has flipped.
                  </p>
                )}
              </div>
            ) : me.prompt ? (
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
        <div
          className={`panel flex flex-col items-center gap-3 ${
            isIntro && !iHaveFlipped ? "intro-pulse" : ""
          }`}
        >
          <span className="text-xs uppercase tracking-wider text-slate-400">Your card</span>
          {isIntro && !iHaveFlipped && myRole ? (
            // During intro the card is a button: tap to flip face-down and
            // signal ready. The server short-circuits the step once everyone
            // has flipped.
            <RoleCard
              role={myRole}
              onClick={() => send.nightAction({ kind: "ack" })}
              caption="Tap to turn face down"
            />
          ) : myRole ? (
            <RoleCard role={myRole} />
          ) : me.cardFaceDown ? (
            <RoleCard faceDown caption={isIntro ? "Face down" : "Unknown"} />
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
  if (prompt.kind === "apprentice_seer_choose") return "apprentice-seer";
  if (prompt.kind === "witch_choose") return "witch-peek";
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
        {prompt.kind === "sentinel_choose" && (
          <SentinelControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "alpha_wolf_choose" && (
          <AlphaWolfControls
            room={room}
            eligibleIds={prompt.eligiblePlayerIds}
            hasCenterWolf={prompt.hasCenterWolf}
          />
        )}
        {prompt.kind === "mystic_wolf_choose" && (
          <MysticWolfControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "apprentice_seer_choose" && (
          <p className="text-sm text-slate-400 italic">
            Click a centre card above to peek, or skip.
          </p>
        )}
        {prompt.kind === "apprentice_seer_choose" && (
          <button
            className="btn-ghost mt-2"
            onClick={() =>
              send.nightAction({ kind: "apprentice_seer_view", centerIndex: null })
            }
          >
            Skip
          </button>
        )}
        {prompt.kind === "paranormal_investigator_choose" && (
          <ParanormalInvestigatorControls
            room={room}
            eligibleIds={prompt.eligiblePlayerIds}
            picksRemaining={prompt.picksRemaining}
          />
        )}
        {prompt.kind === "witch_choose" && (
          <div className="flex flex-wrap gap-2 items-center">
            <p className="text-sm text-slate-400 italic">
              Click a centre card above to peek (you'll then have to swap it).
            </p>
            <button
              className="btn-ghost"
              onClick={() =>
                send.nightAction({ kind: "witch_peek_center", centerIndex: null })
              }
            >
              Skip
            </button>
          </div>
        )}
        {prompt.kind === "witch_swap_choose" && (
          <WitchSwapControls
            room={room}
            eligibleIds={prompt.eligiblePlayerIds}
            peekedRole={prompt.peekedRole}
            peekedIndex={prompt.peekedIndex}
          />
        )}
        {prompt.kind === "village_idiot_choose" && (
          <VillageIdiotControls
            room={room}
            affectedIds={prompt.affectedPlayerIds}
          />
        )}
        {prompt.kind === "revealer_choose" && (
          <RevealerControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
        )}
        {prompt.kind === "curator_choose" && (
          <CuratorControls room={room} eligibleIds={prompt.eligiblePlayerIds} />
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
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be targeted" : undefined}
            onClick={() => send.nightAction({ kind: "doppelganger_copy", targetId: p.id })}
          >
            Copy {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
    </div>
  );
}

function AlphaWolfControls({
  room,
  eligibleIds,
  hasCenterWolf,
}: {
  room: PublicRoom;
  eligibleIds: string[];
  hasCenterWolf: boolean;
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  if (!hasCenterWolf) {
    return (
      <div className="flex flex-wrap gap-2 items-center">
        <p className="text-sm text-slate-400 italic">
          No Werewolf card is in the centre — there's nothing to swap.
        </p>
        <button
          className="btn-ghost"
          onClick={() => send.nightAction({ kind: "alpha_wolf_swap", targetId: null })}
        >
          Continue
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be swapped" : undefined}
            onClick={() => send.nightAction({ kind: "alpha_wolf_swap", targetId: p.id })}
          >
            Give the wolf card to {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "alpha_wolf_swap", targetId: null })}
      >
        Skip
      </button>
    </div>
  );
}

function CuratorControls({
  room,
  eligibleIds,
}: {
  room: PublicRoom;
  eligibleIds: string[];
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't place an artifact" : undefined}
            onClick={() => send.nightAction({ kind: "curator_place", targetId: p.id })}
          >
            🎴 Place on {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "curator_place", targetId: null })}
      >
        Skip
      </button>
    </div>
  );
}

function RevealerControls({
  room,
  eligibleIds,
}: {
  room: PublicRoom;
  eligibleIds: string[];
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be flipped" : undefined}
            onClick={() => send.nightAction({ kind: "revealer_flip", targetId: p.id })}
          >
            Flip {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "revealer_flip", targetId: null })}
      >
        Skip
      </button>
    </div>
  );
}

function WitchSwapControls({
  room,
  eligibleIds,
  peekedRole,
  peekedIndex,
}: {
  room: PublicRoom;
  eligibleIds: string[];
  peekedRole: Role;
  peekedIndex: number;
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        You peeked centre #{peekedIndex + 1}:{" "}
        <span className="text-slate-200 font-medium">{ROLE_META[peekedRole].label}</span>.
        You must now swap it with any player's card.
      </p>
      <div className="flex flex-wrap gap-2">
        {eligible.map((p) => {
          const isShielded = shielded.includes(p.id);
          return (
            <button
              key={p.id}
              className="btn-ghost"
              disabled={isShielded}
              title={isShielded ? "Shielded by the Sentinel — can't be swapped" : undefined}
              onClick={() => send.nightAction({ kind: "witch_swap", targetId: p.id })}
            >
              Give to {p.name}
              {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VillageIdiotControls({
  room,
  affectedIds,
}: {
  room: PublicRoom;
  affectedIds: string[];
}) {
  const affectedNames = affectedIds
    .map((id) => room.players.find((p) => p.id === id)?.name ?? "?")
    .join(" → ");
  const enoughToRotate = affectedIds.length >= 2;
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        {enoughToRotate ? (
          <>
            Rotation ring (left = each card shifts left): {affectedNames}.
          </>
        ) : (
          <>
            Only {affectedIds.length} player would shift — there's nothing to
            rotate. Skip.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn-ghost"
          disabled={!enoughToRotate}
          onClick={() =>
            send.nightAction({ kind: "village_idiot_rotate", direction: "left" })
          }
        >
          ← Rotate left
        </button>
        <button
          className="btn-ghost"
          disabled={!enoughToRotate}
          onClick={() =>
            send.nightAction({ kind: "village_idiot_rotate", direction: "right" })
          }
        >
          Rotate right →
        </button>
        <button
          className="btn-ghost"
          onClick={() =>
            send.nightAction({ kind: "village_idiot_rotate", direction: null })
          }
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function ParanormalInvestigatorControls({
  room,
  eligibleIds,
  picksRemaining,
}: {
  room: PublicRoom;
  eligibleIds: string[];
  picksRemaining: number;
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">
        {picksRemaining === 2
          ? "Pick your first target. If they're a Werewolf, Minion or Tanner you become that team and your investigation ends."
          : "Pick a second target, or stop here."}
      </p>
      <div className="flex flex-wrap gap-2">
        {eligible.map((p) => {
          const isShielded = shielded.includes(p.id);
          return (
            <button
              key={p.id}
              className="btn-ghost"
              disabled={isShielded}
              title={isShielded ? "Shielded by the Sentinel — can't be viewed" : undefined}
              onClick={() => send.nightAction({ kind: "pi_view", targetId: p.id })}
            >
              Look at {p.name}
              {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
            </button>
          );
        })}
        <button
          className="btn-ghost"
          onClick={() => send.nightAction({ kind: "pi_stop" })}
        >
          {picksRemaining === 2 ? "Skip" : "Stop"}
        </button>
      </div>
    </div>
  );
}

function MysticWolfControls({
  room,
  eligibleIds,
}: {
  room: PublicRoom;
  eligibleIds: string[];
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be viewed" : undefined}
            onClick={() => send.nightAction({ kind: "mystic_wolf_view", targetId: p.id })}
          >
            Look at {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "mystic_wolf_view", targetId: null })}
      >
        Skip
      </button>
    </div>
  );
}

function SentinelControls({
  room,
  eligibleIds,
}: {
  room: PublicRoom;
  eligibleIds: string[];
}) {
  const eligible = room.players.filter((p) => eligibleIds.includes(p.id));
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => (
        <button
          key={p.id}
          className="btn-ghost"
          onClick={() => send.nightAction({ kind: "sentinel_shield", targetId: p.id })}
        >
          🛡 Shield {p.name}
        </button>
      ))}
      <button
        className="btn-ghost"
        onClick={() => send.nightAction({ kind: "sentinel_shield", targetId: null })}
      >
        Skip
      </button>
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
    const shielded = room.shieldedPlayerIds ?? [];
    return (
      <div className="flex flex-wrap gap-2">
        {others.map((p) => {
          const isShielded = shielded.includes(p.id);
          return (
            <button
              key={p.id}
              className="btn-ghost"
              disabled={isShielded}
              title={isShielded ? "Shielded by the Sentinel — can't be viewed" : undefined}
              onClick={() => viewPlayer(p.id)}
            >
              {p.name}
              {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
            </button>
          );
        })}
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
  const shielded = room.shieldedPlayerIds ?? [];
  return (
    <div className="flex flex-wrap gap-2">
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className="btn-ghost"
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be robbed" : undefined}
            onClick={() => send.nightAction({ kind: "robber_swap", targetId: p.id })}
          >
            Rob {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
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
  const shielded = room.shieldedPlayerIds ?? [];
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
      {eligible.map((p) => {
        const isShielded = shielded.includes(p.id);
        return (
          <button
            key={p.id}
            className={`btn-ghost ${picks.includes(p.id) ? "ring-2 ring-indigo-400" : ""}`}
            disabled={isShielded}
            title={isShielded ? "Shielded by the Sentinel — can't be swapped" : undefined}
            onClick={() => toggle(p.id)}
          >
            {p.name}
            {isShielded && <span className="ml-1 text-sky-300">🛡</span>}
          </button>
        );
      })}
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
// each step regardless of whether the role is in play — except doppelganger_act
// which only names the actionable roles actually in this round's deck.
const DG_ACT_ROLES_ORDER: Role[] = ["seer", "robber", "troublemaker", "drunk"];

function moderatorLine(step: NightStep, selectedRoles: Role[]): string {
  switch (step) {
    case "intro":
      return "Everyone, look at your card. Turn it face down when you are ready to begin.";
    case "night_starts":
      return "The night begins.";
    case "sentinel":
      return "Sentinel, open your eyes. Place a shield token on any player's card but your own.";
    case "doppelganger":
      return "Doppelganger, open your eyes and look at another player's card.";
    case "doppelganger_act": {
      const active = DG_ACT_ROLES_ORDER.filter((r) => selectedRoles.includes(r)).map(
        (r) => ROLE_META[r].label,
      );
      if (active.length === 0) return ""; // step shouldn't run in this case
      const list =
        active.length === 1
          ? active[0]
          : active.slice(0, -1).join(", ") + " or " + active[active.length - 1];
      return `If you viewed the ${list} card, do your action now.`;
    }
    case "werewolves":
      return "Werewolves, open your eyes and look for other Werewolves. Dream Wolf, the wolves can see you.";
    case "alpha_wolf":
      return "Alpha Wolf, exchange the centre Werewolf card with any other player's card.";
    case "mystic_wolf":
      return "Mystic Wolf, you may look at another player's card.";
    case "minion":
      return "Minion, open your eyes and look for the Werewolves.";
    case "masons":
      return "Masons, open your eyes and look for other Masons.";
    case "seer":
      return "Seer, open your eyes. You may look at one player's card or two center cards.";
    case "apprentice_seer":
      return "Apprentice Seer, you may look at one of the centre cards.";
    case "paranormal_investigator":
      return "P.I., you may look at up to two players' cards. Stop if you see a Werewolf, Minion, or Tanner — you become that role.";
    case "robber":
      return "Robber, open your eyes. You may exchange your card with another player's.";
    case "witch":
      return "Witch, you may look at one centre card. If you do, you must swap it with any player's card.";
    case "troublemaker":
      return "Troublemaker, open your eyes. You may swap two other players' cards.";
    case "village_idiot":
      return "Village Idiot, you may rotate every other player's card to the left or to the right.";
    case "drunk":
      return "Drunk, open your eyes and exchange your card with one in the center.";
    case "insomniac":
      return "Insomniac, open your eyes and look at your card.";
    case "doppelganger_insomniac":
      return "Doppelganger, if you copied the Insomniac, look at your card.";
    case "revealer":
      return "Revealer, you may flip another player's card face up. If they're on the wolf or tanner team it stays hidden.";
    case "doppelganger_revealer":
      return "Doppelganger, if you copied the Revealer, you may flip another player's card.";
    case "curator":
      return "Curator, you may place an artifact token face down on any player's card.";
    case "doppelganger_curator":
      return "Doppelganger, if you copied the Curator, you may place an artifact on a card without one.";
    case "outro":
      return "Everyone wake up, the night will end in 5… 4… 3… 2… 1.";
  }
}

// Did this *original* role take the current step? Used to label the "you've
// acted" message. doppelganger_act fires for the Doppelganger only — the real
// Seer/Robber/Troublemaker/Drunk still wait for their own steps.
function actorIsForStep(originalRole: Role, step: NightStep | undefined): boolean {
  if (!step) return false;
  if (step === "werewolves") return originalRole === "werewolf";
  if (step === "masons") return originalRole === "mason";
  if (step === "doppelganger_act") return originalRole === "doppelganger";
  if (
    step === "doppelganger_insomniac" ||
    step === "doppelganger_revealer" ||
    step === "doppelganger_curator"
  ) {
    return originalRole === "doppelganger";
  }
  if (step === "intro" || step === "night_starts" || step === "outro") return false;
  return originalRole === step;
}

