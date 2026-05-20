import { describe, expect, test } from "vitest";
import type { Role } from "../shared/types.js";
import { isStepInPlay, stepFilesFor } from "./night.js";

describe("isStepInPlay", () => {
  test("intro / night_starts / outro always run", () => {
    expect(isStepInPlay([], "intro")).toBe(true);
    expect(isStepInPlay([], "night_starts")).toBe(true);
    expect(isStepInPlay([], "outro")).toBe(true);
  });

  test("doppelganger only runs when Doppelganger is in the deck", () => {
    expect(isStepInPlay(["werewolf"], "doppelganger")).toBe(false);
    expect(isStepInPlay(["werewolf", "doppelganger"], "doppelganger")).toBe(true);
  });

  test("doppelganger_act needs DG AND at least one actionable role", () => {
    // DG alone → no actionable role → skip
    expect(
      isStepInPlay(["werewolf", "doppelganger"], "doppelganger_act"),
    ).toBe(false);
    // DG + Seer → runs
    expect(
      isStepInPlay(["werewolf", "doppelganger", "seer"], "doppelganger_act"),
    ).toBe(true);
    // DG + Robber → runs
    expect(
      isStepInPlay(["werewolf", "doppelganger", "robber"], "doppelganger_act"),
    ).toBe(true);
    // Seer present but no DG → skip (DG can't act on it)
    expect(isStepInPlay(["werewolf", "seer"], "doppelganger_act")).toBe(false);
    // DG + Werewolf (non-actionable in DG-act) → skip
    expect(
      isStepInPlay(["werewolf", "doppelganger", "werewolf"], "doppelganger_act"),
    ).toBe(false);
  });

  test("werewolves and masons map to their role names correctly", () => {
    expect(isStepInPlay(["werewolf"], "werewolves")).toBe(true);
    expect(isStepInPlay(["mason", "mason"], "masons")).toBe(true);
    expect(isStepInPlay(["seer"], "werewolves")).toBe(false);
  });
});

describe("stepFilesFor — doppelganger_act dynamic sequence", () => {
  const seed: Role[] = ["werewolf", "doppelganger"];

  test("Seer only", () => {
    expect(stepFilesFor("doppelganger_act", [...seed, "seer"])).toEqual([
      "Doppelganger_Act_Prefix.mp3",
      "Doppelganger_Act_Seer.mp3",
      "Doppelganger_Act_Suffix.mp3",
    ]);
  });

  test("Seer + Robber inserts the Or before the last role", () => {
    expect(
      stepFilesFor("doppelganger_act", [...seed, "seer", "robber"]),
    ).toEqual([
      "Doppelganger_Act_Prefix.mp3",
      "Doppelganger_Act_Seer.mp3",
      "Doppelganger_Act_Or.mp3",
      "Doppelganger_Act_Robber.mp3",
      "Doppelganger_Act_Suffix.mp3",
    ]);
  });

  test("all four actionable roles → Or appears before Drunk", () => {
    expect(
      stepFilesFor("doppelganger_act", [
        ...seed,
        "seer",
        "robber",
        "troublemaker",
        "drunk",
      ]),
    ).toEqual([
      "Doppelganger_Act_Prefix.mp3",
      "Doppelganger_Act_Seer.mp3",
      "Doppelganger_Act_Robber.mp3",
      "Doppelganger_Act_Troublemaker.mp3",
      "Doppelganger_Act_Or.mp3",
      "Doppelganger_Act_Drunk.mp3",
      "Doppelganger_Act_Suffix.mp3",
    ]);
  });

  test("static steps return a single-file array", () => {
    expect(stepFilesFor("intro", ["werewolf"])).toEqual(["Intro.mp3"]);
    expect(stepFilesFor("night_starts", ["werewolf"])).toEqual([
      "TheNightBegins.mp3",
    ]);
    expect(stepFilesFor("werewolves", ["werewolf"])).toEqual([
      "Werewolves.mp3",
    ]);
  });
});
