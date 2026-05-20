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
  intro: "Night Begins",
  night_starts: "Night underway",
  sentinel: "Sentinel",
  doppelganger: "Doppelganger",
  doppelganger_act: "Doppelganger acts",
  werewolves: "Werewolves",
  alpha_wolf: "Alpha Wolf",
  mystic_wolf: "Mystic Wolf",
  minion: "Minion",
  masons: "Masons",
  seer: "Seer",
  apprentice_seer: "Apprentice Seer",
  paranormal_investigator: "P.I.",
  robber: "Robber",
  witch: "Witch",
  troublemaker: "Troublemaker",
  village_idiot: "Village Idiot",
  drunk: "Drunk",
  insomniac: "Insomniac",
  doppelganger_insomniac: "DG-Insomniac",
  revealer: "Revealer",
  doppelganger_revealer: "DG-Revealer",
  curator: "Curator",
  doppelganger_curator: "DG-Curator",
  outro: "Wake up",
};

// Mirror of server-side isStepInPlay — whether a step actually runs based on
// the roles that were selected. Lets us hide skipped steps (e.g. there's no
// Robber in the deck → don't show a Robber step on the bar).
function stepInPlay(roles: Role[], step: NightStep): boolean {
  if (step === "intro" || step === "night_starts" || step === "outro") return true;
  if (step === "doppelganger") return roles.includes("doppelganger");
  if (step === "doppelganger_act") {
    if (!roles.includes("doppelganger")) return false;
    return (
      roles.includes("seer") ||
      roles.includes("robber") ||
      roles.includes("troublemaker") ||
      roles.includes("drunk") ||
      // Daybreak roles that act immediately in doppelganger_act once
      // implemented; included in the gating so the step still shows on the
      // progress bar even before their per-role setup lands.
      roles.includes("sentinel") ||
      roles.includes("alpha_wolf") ||
      roles.includes("mystic_wolf") ||
      roles.includes("apprentice_seer") ||
      roles.includes("paranormal_investigator") ||
      roles.includes("witch") ||
      roles.includes("village_idiot")
    );
  }
  if (step === "doppelganger_insomniac")
    return roles.includes("doppelganger") && roles.includes("insomniac");
  if (step === "doppelganger_revealer")
    return roles.includes("doppelganger") && roles.includes("revealer");
  if (step === "doppelganger_curator")
    return roles.includes("doppelganger") && roles.includes("curator");
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
