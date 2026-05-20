import type { NightStep, Role } from "../../shared/types.js";
import { NIGHT_ORDER } from "../../shared/types.js";

interface Props {
  selectedRoles: Role[];
  currentStep: NightStep | undefined;
}

// Friendly labels for each step. The night flow has a few non-role steps
// (intro / outro) that we still want to show so the bar reflects what the
// narrator is actually saying.
const STEP_LABEL: Record<NightStep, string> = {
  intro: "Eyes closed",
  doppelganger: "Doppelganger",
  doppelganger_act: "Doppelganger acts",
  werewolves: "Werewolves",
  minion: "Minion",
  masons: "Masons",
  seer: "Seer",
  robber: "Robber",
  troublemaker: "Troublemaker",
  drunk: "Drunk",
  insomniac: "Insomniac",
  outro: "Wake up",
};

// Mirror of server-side isStepInPlay — whether a step actually runs based on
// the roles that were selected. Lets us hide skipped steps (e.g. there's no
// Robber in the deck → don't show a Robber step on the bar).
function stepInPlay(roles: Role[], step: NightStep): boolean {
  if (step === "intro" || step === "outro") return true;
  if (step === "doppelganger") return roles.includes("doppelganger");
  if (step === "doppelganger_act") {
    if (!roles.includes("doppelganger")) return false;
    return (
      roles.includes("seer") ||
      roles.includes("robber") ||
      roles.includes("troublemaker") ||
      roles.includes("drunk")
    );
  }
  const role: Role =
    step === "werewolves" ? "werewolf" : step === "masons" ? "mason" : (step as Role);
  return roles.includes(role);
}

export function NightProgressPanel({ selectedRoles, currentStep }: Props) {
  const inPlay = NIGHT_ORDER.filter((s) => stepInPlay(selectedRoles, s));
  const currentIdx = currentStep ? inPlay.indexOf(currentStep) : -1;

  return (
    <div className="panel">
      <h3 className="text-sm uppercase tracking-wider text-slate-400 mb-3">
        Night progress{" "}
        <span className="text-slate-500">
          (where the narrator is up to)
        </span>
      </h3>
      <ol className="flex flex-wrap gap-2">
        {inPlay.map((step, i) => {
          const state =
            currentIdx < 0 ? "upcoming" : i < currentIdx ? "done" : i === currentIdx ? "current" : "upcoming";
          const cls =
            state === "done"
              ? "border-slate-800 bg-slate-900 text-slate-500 line-through"
              : state === "current"
                ? "border-emerald-500 bg-emerald-950/60 text-emerald-200 ring-2 ring-emerald-500/40 animate-pulse"
                : "border-slate-700 bg-slate-800 text-slate-300";
          return (
            <li
              key={step}
              className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${cls}`}
            >
              {state === "done" && <span className="mr-1 text-emerald-500/80 no-underline">✓</span>}
              {STEP_LABEL[step]}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
