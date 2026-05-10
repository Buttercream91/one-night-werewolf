import type { Role } from "../../shared/types.js";
import { ROLE_META } from "../../shared/types.js";

interface Props {
  role?: Role; // optional when faceDown
  caption?: string;
  size?: "sm" | "md" | "lg";
  dim?: boolean;
  faceDown?: boolean;
  highlight?: "selected" | "peeked" | null;
  onClick?: () => void;
  flipping?: boolean; // animate flip from back to front
}

export const ROLE_IMAGE: Record<Role, string> = {
  // Note: filename keeps the "doppleganger" spelling from the original asset.
  doppelganger: "/images/roles/doppleganger.jpg",
  werewolf: "/images/roles/werewolf.jpg",
  minion: "/images/roles/minion.jpg",
  mason: "/images/roles/mason.jpg",
  seer: "/images/roles/seer.jpg",
  robber: "/images/roles/robber.jpg",
  troublemaker: "/images/roles/troublemaker.jpg",
  drunk: "/images/roles/drunk.jpg",
  insomniac: "/images/roles/insomniac.jpg",
  hunter: "/images/roles/hunter.jpg",
  tanner: "/images/roles/tanner.jpg",
  villager: "/images/roles/villager.jpg",
};

const CARD_BACK = "/images/card-back.jpg";

export function RoleCard({
  role,
  caption,
  size = "md",
  dim,
  faceDown,
  highlight,
  onClick,
  flipping,
}: Props) {
  const dims =
    size === "sm" ? "w-24 h-32" : size === "lg" ? "w-44 h-60" : "w-32 h-44";
  const meta = role ? ROLE_META[role] : null;
  const palette = meta ? palettes[meta.team] : palettes.villager;
  // Show face-down when explicitly face-down or when no role provided.
  const showFront = !faceDown && !!role;

  // Outer ring depending on highlight state (selected by user, or peeked previously).
  const ring =
    highlight === "selected"
      ? "ring-2 ring-indigo-400"
      : highlight === "peeked"
        ? "ring-2 ring-amber-400"
        : "";

  const interactiveClasses = onClick
    ? "cursor-pointer hover:scale-[1.03] active:scale-[0.98]"
    : "";

  const inner = (
    <div className={`flip-card-inner ${flipping || showFront ? "is-flipped" : ""}`}>
      <div className="flip-face flip-back">
        <img src={CARD_BACK} alt="Face down card" className="w-full h-full object-cover" />
      </div>
      <div className="flip-face flip-front">
        {meta && (
          <>
            <img
              src={ROLE_IMAGE[role!]}
              alt={meta.label}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent px-2 pt-6 pb-2 text-center">
              <span className={`heading text-sm ${palette.title}`}>{meta.label}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className={`flex flex-col items-center gap-2 ${dim ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={meta?.description ?? ""}
        className={`flip-card relative ${dims} rounded-xl border-2 ${
          showFront ? palette.border : "border-slate-700"
        } shadow-lg overflow-hidden bg-slate-950 transition-transform duration-200 ${ring} ${interactiveClasses}`}
      >
        {inner}
      </button>
      {caption && <span className="text-xs text-slate-300">{caption}</span>}
    </div>
  );
}

const palettes = {
  werewolf: {
    border: "border-rose-600",
    title: "text-rose-100",
  },
  villager: {
    border: "border-emerald-600",
    title: "text-emerald-100",
  },
  tanner: {
    border: "border-amber-600",
    title: "text-amber-100",
  },
} as const;
