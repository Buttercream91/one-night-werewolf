import { useEffect, useState } from "react";

// Server epoch ms minus client epoch ms, captured from the most recent
// `room:state`. Lets countdown timers self-correct for clock skew between
// the player's machine and the Render server.
let serverTimeOffset = 0;

export function setServerTimeOffset(offset: number) {
  serverTimeOffset = offset;
}

function nowOnServer(): number {
  return Date.now() + serverTimeOffset;
}

// Whole seconds remaining until `endsAt` (a server epoch ms). Returns 0 when
// `endsAt` is undefined or already past.
export function useCountdown(endsAt: number | undefined, mode: "ceil" | "floor" = "ceil"): number {
  const [now, setNow] = useState(() => nowOnServer());

  useEffect(() => {
    if (!endsAt) return;
    // Snap immediately when endsAt changes so we don't show one frame of the
    // previous step's stale `now` (which would inflate the displayed time).
    setNow(nowOnServer());

    const t = setInterval(() => setNow(nowOnServer()), 250);

    // Browsers throttle setInterval in inactive tabs, so the visible countdown
    // can lag well behind reality. Snap back to the truth on tab focus.
    function onVisible() {
      if (document.visibilityState === "visible") setNow(nowOnServer());
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [endsAt]);

  if (!endsAt) return 0;
  const ms = endsAt - now;
  return Math.max(0, mode === "ceil" ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
}
