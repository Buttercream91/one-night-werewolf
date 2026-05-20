// Generates the night-phase voice pack(s) using ElevenLabs.
// Requires env var ELEVENLABS_API_KEY (free tier ~10k chars/month).
//
// Run with:
//   $env:ELEVENLABS_API_KEY = "..."   # PowerShell, current session
//   npm run voice:gen                  # generate every pack listed in VOICE_PACKS
//   npm run voice:gen -- brian         # only the brian pack
//   npm run voice:gen -- --force       # regenerate even if file exists
//
// Files land at public/voice/<packId>/<Clip>.mp3.
// On first run, any pre-existing public/voice/*.mp3 files are moved into the
// "brian" subdir so the previous generation is preserved without duplicate cost.

import fs from "node:fs";
import path from "node:path";
import { VOICE_PACKS } from "../src/shared/types.js";

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ELEVENLABS_API_KEY env var not set. Run: $env:ELEVENLABS_API_KEY = "your-key"');
  process.exit(1);
}

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const PACK_FILTER = args.filter((a) => !a.startsWith("--"));

const MODEL = "eleven_turbo_v2_5";
const VOICE_SETTINGS = {
  stability: 0.6,
  similarity_boost: 0.75,
  style: 0.35,
  use_speaker_boost: true,
};
const ROOT_VOICE_DIR = path.resolve("public/voice");

const CLIPS: Record<string, string> = {
  Intro:
    "Everyone, look at your card. Turn it face down when you are ready to begin.",
  // Brief transition clip — plays once every player has flipped, just before
  // the first role acts.
  TheNightBegins: "The night begins.",
  Doppelganger:
    "Doppelganger, wake up and look at another player's card. You are now a copy of that role.",
  // Atomic clips for the dynamic doppelganger_act narration. The server picks
  // which Role clips to include based on the deck and the client plays
  // [Prefix, Role1, (Or, before last), ..., Suffix] back-to-back.
  Doppelganger_Act_Prefix: "If you viewed the",
  Doppelganger_Act_Seer: "Seer",
  Doppelganger_Act_Robber: "Robber",
  Doppelganger_Act_Troublemaker: "Troublemaker",
  Doppelganger_Act_Drunk: "Drunk",
  Doppelganger_Act_Or: "or",
  Doppelganger_Act_Suffix: "do your action now.",
  Werewolves:
    "Werewolves, wake up and look for other werewolves. If you are the only werewolf, you may look at one card from the center.",
  // Online play has no table to peek under, so we drop the rulebook's
  // thumbs-up choreography and just tell the Minion the result directly.
  // The server-side "minion sees werewolves" note is delivered the moment
  // this clip plays, so the line lands at the same time as the info.
  Minion: "Minion, you may now see who the werewolves are.",
  Mason: "Masons, wake up and look for other masons.",
  Seer: "Seer, wake up. You may look at another player's card, or look at two cards from the center.",
  Robber:
    "Robber, wake up. You may exchange your card with another player's card, then look at your new card.",
  Troublemaker:
    "Troublemaker, wake up. You may switch the cards of two other players without looking at them.",
  Drunk: "Drunk, wake up and exchange your card with one of the cards in the center.",
  Insomniac: "Insomniac, wake up and look at your card.",
  Outro: "Everyone wake up, the night will end in 5... 4... 3... 2... 1.",
  BeginVote: "It's time to vote. Choose a player to kill.",
  WerewolvesWin: "The Werewolves win!",
  VillagersWin: "The Villagers win!",
  TannerWins: "The Tanner wins!",

  // Host-fired announcements.
  ReadyCheck: "This is a readiness check! The game will begin shortly. Select the Ready button to begin.",

  // Narrated tutorial. One clip per step. Step IDs match Tutorial.tsx.
  Tutorial_Welcome:
    "Welcome to One Night Ultimate Werewolf. Each round, every player gets one role and the village has one night to find the wolves. This tour walks through the rules and the controls.",
  Tutorial_Setup:
    "At the start of a round the deck is dealt. Every player gets a face-down role card. Three extra cards are placed in the centre. Nobody starts holding a centre card.",
  Tutorial_Phases:
    "Each round has three phases. Night, where roles act in secret. Day, where you talk it out. Vote, where the village decides who dies.",
  Tutorial_Goal:
    "Villagers win if they kill at least one werewolf. Werewolves and the Minion win if no werewolf is killed. The Tanner wins only if they themselves are killed by the vote.",
  Tutorial_Werewolf:
    "Werewolves wake at night and see each other. If you are the only werewolf, you may peek at one of the centre cards to learn what is not in play.",
  Tutorial_Minion:
    "The Minion sees the werewolves but the werewolves do not see them. The Minion wins with the wolf team, even if the Minion themselves is killed.",
  Tutorial_Mason:
    "The two Masons wake together and see each other. They are villagers and trust each other on sight. If only one Mason is in play, that Mason knows it.",
  Tutorial_Seer:
    "The Seer can look at one other player's card, or peek at two of the three centre cards. Their report is reliable. Anyone claiming Seer should be tested.",
  Tutorial_Robber:
    "The Robber swaps their card with another player's, then peeks at their new card. The other player becomes the Robber and does not know it.",
  Tutorial_Troublemaker:
    "The Troublemaker swaps two other players' cards without looking. The two players do not know they were swapped.",
  Tutorial_Drunk:
    "The Drunk swaps their card with one of the centre cards without looking. They almost certainly are not a Drunk anymore. They just do not know what they are.",
  Tutorial_Insomniac:
    "The Insomniac wakes at the very end of the night and looks at their own card. If a Robber or Troublemaker swapped them, the Insomniac sees what they actually are now.",
  Tutorial_Hunter:
    "The Hunter has no night action. If the Hunter is killed by the village vote, the player the Hunter voted for also dies.",
  Tutorial_Tanner:
    "The Tanner is on no team. They win only if the village kills them, and they lose if anyone else dies — including no one. Convince the village you are a wolf.",
  Tutorial_Doppelganger:
    "The Doppelganger acts first. They look at another player's card and become a copy of that role. If they copy a werewolf, they are now a werewolf. They act on the copied role's turn.",
  Tutorial_Villager:
    "Villagers have no night action. They win with the village team. They listen, talk, and vote.",
  Tutorial_Night:
    "During the night, the app calls each role in turn. Only that role is awake; the rest stay quiet. Spectators can chat with each other. Players are silent and deaf.",
  Tutorial_Day:
    "Once the night is over, the day timer starts. Talk it out. Accuse, claim a role, lie if you have to. Players talk among themselves. Spectators can hear the players but cannot speak.",
  Tutorial_Accuse:
    "On a player's tile, click Accuse to publicly call out which role you think they are. You can hold accusations against multiple targets. Accusations are coloured by who made them.",
  Tutorial_Vote:
    "When the day timer ends or everyone hits ready, the vote begins. Pick a player to kill. The player with the most votes dies. Ties die together. Nobody dies if no one gets two votes.",
  Tutorial_Winning:
    "If a werewolf was killed, villagers win. If no werewolf was killed, the wolf team wins. The Tanner wins only if killed alone. House rule: in a wolfless game, killing the Minion is a village win, killing a villager is a wolf-team win.",
  Tutorial_Wrap:
    "That's it. Create a room, share the code with your friends, and have fun. Tip: jump on a separate voice call too if voice chat in-app fails for anyone. The app handles role logic, you handle the deceiving.",
};

async function generate() {
  fs.mkdirSync(ROOT_VOICE_DIR, { recursive: true });
  migrateLooseFilesIntoBrian();

  const packs = PACK_FILTER.length
    ? VOICE_PACKS.filter((p) => PACK_FILTER.includes(p.id))
    : VOICE_PACKS;
  if (packs.length === 0) {
    console.error(`No matching packs. Known: ${VOICE_PACKS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }

  for (const pack of packs) {
    const dir = path.join(ROOT_VOICE_DIR, pack.id);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`\n[${pack.id}] ${pack.label}`);
    let failed = 0;
    for (const [name, text] of Object.entries(CLIPS)) {
      const outFile = path.join(dir, `${name}.mp3`);
      if (!FORCE && fs.existsSync(outFile)) {
        console.log(`  ${name}.mp3 ... cached`);
        continue;
      }
      process.stdout.write(`  ${name}.mp3 ... `);
      try {
        const buf = await synthesize(pack.ttsVoiceId, text);
        fs.writeFileSync(outFile, buf);
        process.stdout.write(`${(buf.length / 1024).toFixed(1)} KB\n`);
      } catch (err: any) {
        failed++;
        process.stdout.write(`FAILED — ${err.message}\n`);
      }
    }
    if (failed > 0) {
      console.log(`  ⚠ ${failed} clip(s) failed for ${pack.id} — voice id may need a paid plan.`);
    }
  }
  console.log("\nDone.");
}

async function synthesize(voiceId: string, text: string): Promise<Buffer> {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": API_KEY!,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// First-run migration: if previous generations live at public/voice/*.mp3
// (no subdir), move them under public/voice/brian/ so they're not lost.
function migrateLooseFilesIntoBrian() {
  const loose = fs
    .readdirSync(ROOT_VOICE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".mp3"));
  if (loose.length === 0) return;
  const target = path.join(ROOT_VOICE_DIR, "brian");
  fs.mkdirSync(target, { recursive: true });
  for (const f of loose) {
    const src = path.join(ROOT_VOICE_DIR, f);
    const dst = path.join(target, f);
    if (!fs.existsSync(dst)) fs.renameSync(src, dst);
    else fs.unlinkSync(src);
  }
  console.log(`Migrated ${loose.length} loose mp3s to public/voice/brian/`);
}

generate().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
