import { useState } from "react";

interface Props {
  code: string;
  className?: string;
}

export function CopyableCode({ code, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Older browsers / insecure origins — silently no-op.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied!" : "Copy room code"}
      className={`font-mono underline decoration-dotted underline-offset-2 hover:text-indigo-300 transition ${
        copied ? "text-emerald-300" : ""
      } ${className}`}
    >
      {copied ? "Copied!" : code}
    </button>
  );
}
