import { useEffect, useRef, useState } from "react";
import type { ChatMessage, PrivateView, PublicRoom } from "../../shared/types.js";
import { playerColor } from "../playerColor.js";
import { send } from "../socket.js";

interface Props {
  room: PublicRoom;
  me: PrivateView | null;
}

// Lobby-only text chat. Server stores the last 50 messages on the room and
// emits them via room:state; we just render and provide an input. Messages
// are wiped at game start.
export function ChatPanel({ room, me }: Props) {
  const [draft, setDraft] = useState("");
  const messages: ChatMessage[] = room.chatMessages ?? [];
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the latest message visible — auto-scroll the message container to
  // its bottom whenever the count grows.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    send.chat(text);
    setDraft("");
  }

  return (
    <div className="panel">
      <h2 className="heading text-xl text-indigo-200 mb-2">Lobby chat</h2>
      <div
        ref={listRef}
        className="h-48 overflow-y-auto rounded-md border border-slate-800 bg-slate-900/40 p-3 text-sm space-y-1"
      >
        {messages.length === 0 ? (
          <p className="text-slate-500 italic text-xs">No messages yet — say hi.</p>
        ) : (
          messages.map((m) => {
            const cls = playerColor(m.fromId, room.players);
            return (
              <div key={m.id} className="leading-snug break-words">
                <span className={`font-medium ${cls}`}>{m.fromName}</span>
                <span className="text-slate-500 text-xs ml-1">{formatTs(m.ts)}</span>
                <span className="ml-2 text-slate-200">{m.text}</span>
              </div>
            );
          })
        )}
      </div>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder={me ? "Send a message…" : "Joining…"}
          maxLength={200}
          disabled={!me}
          className="input flex-1 text-sm"
        />
        <button
          onClick={submit}
          disabled={!me || draft.trim().length === 0}
          className="btn-ghost text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}
