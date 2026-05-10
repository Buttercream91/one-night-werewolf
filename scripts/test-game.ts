// Spins up a Chromium window with 6 tabs:
//  - Tab 1: Alan (host) creates a room.
//  - Tabs 2-6: Kiara, Tiann, Elliott, Dustin, Kyya join the room.
// The browser stays open so you can drive the game manually.
//
// Run with:  npm run test:multiplayer
// Override the URL with $env:PLAY_URL (defaults to http://localhost:5173).

import { chromium, type BrowserContext } from "playwright";

const URL = process.env.PLAY_URL ?? "http://localhost:5173";
const HOST = "Alan";
const JOINERS = ["Kiara", "Tiann", "Elliott", "Dustin", "Kyya"];

async function createRoom(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  await page.goto(URL);

  // Default tab is "Create room". Fill name, submit.
  await page.locator('input[placeholder="e.g. Alan"]').fill(HOST);
  await page.locator('button[type="submit"]').click();

  // Wait for lobby — the room code appears as a CopyableCode button (title attr).
  const codeEl = page.getByTitle("Copy room code").first();
  await codeEl.waitFor({ state: "visible", timeout: 10_000 });
  const code = (await codeEl.textContent())?.trim();
  if (!code || !/^[A-Z]{4}$/.test(code)) {
    throw new Error(`Could not read room code (got "${code}")`);
  }
  console.log(`[host] ${HOST} created room ${code}`);
  return code;
}

async function joinRoom(context: BrowserContext, name: string, code: string) {
  const page = await context.newPage();
  await page.goto(URL);

  // Switch to the "Join room" tab. Both tab and submit have that text;
  // the tab is first in the DOM order.
  await page.getByRole("button", { name: "Join room" }).first().click();
  await page.locator('input[placeholder="e.g. Alan"]').fill(name);
  await page.locator('input[placeholder="ABCD"]').fill(code);
  await page.locator('button[type="submit"]').click();

  // Wait for the lobby to render for this player.
  await page.getByTitle("Copy room code").first().waitFor({ state: "visible", timeout: 10_000 });
  console.log(`[join] ${name} joined ${code}`);
}

async function main() {
  console.log(`Targeting ${URL}`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const code = await createRoom(context);
  for (const name of JOINERS) {
    await joinRoom(context, name, code);
  }

  console.log(`\n6 tabs open in one Chromium window. Code: ${code}`);
  console.log("Press Ctrl+C to close. Closing the browser window also exits.");

  // Keep alive until the user closes the browser or kills the process.
  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    process.on("SIGINT", () => {
      browser.close().finally(() => resolve());
    });
  });
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
