import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function statusColor(status: string) {
  if (status === "running" || status === "success")
    return { text: "text-emerald-400", bg: "bg-emerald-400/10", border: "border-emerald-400/25" };
  if (status === "destroyed")
    return { text: "text-neutral-500", bg: "bg-neutral-500/10", border: "border-neutral-500/25" };
  if (status === "queued")
    return { text: "text-sky-400", bg: "bg-sky-400/10", border: "border-sky-400/25" };
  if (status === "dispatching" || status === "workflow_dispatched")
    return { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/25" };
  if (status.includes("destroy"))
    return { text: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/25" };
  if (status.includes("failed") || status.includes("permanent"))
    return { text: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/25" };
  return { text: "text-neutral-500", bg: "bg-neutral-500/10", border: "border-neutral-500/25" };
}

export function StatusPill({ status }: { status: string }) {
  const c = statusColor(status);
  const active = status === "running" || status === "dispatching";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2.5 py-1 rounded-full border ${c.text} ${c.bg} ${c.border}`}>
      {active && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {status}
    </span>
  );
}

export function parseUTC(iso: string): number {
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z";
  return new Date(s).getTime();
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - parseUTC(iso);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ttlInfo(createdAt: string, ttlHours: number): { label: string; pct: number; urgent: boolean } {
  if (!ttlHours || ttlHours >= 8760) return { label: "no auto-destroy", pct: 100, urgent: false };
  const created = parseUTC(createdAt);
  const expiresAt = created + ttlHours * 3600_000;
  const totalMs = ttlHours * 3600_000;
  const remainingMs = expiresAt - Date.now();
  if (remainingMs <= 0) return { label: "expired", pct: 0, urgent: true };
  const pct = Math.round((remainingMs / totalMs) * 100);
  const urgent = remainingMs < 3 * 3600_000;
  const h = Math.floor(remainingMs / 3600_000);
  const m = Math.floor((remainingMs % 3600_000) / 60_000);
  const label = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
  return { label, pct, urgent };
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

export function Card({ children, className = "", onClick }: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`border border-neutral-800 rounded-2xl bg-neutral-950 ${onClick ? "cursor-pointer hover:border-neutral-700 transition-colors" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-600 font-mono mb-3">
      {children}
    </p>
  );
}

export function EmptyState({ label, sub }: { label: string; sub?: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-neutral-700 font-mono text-sm">{label}</p>
      {sub && <p className="text-neutral-800 font-mono text-xs mt-1">{sub}</p>}
    </div>
  );
}

export function DeleteConfirm({ onConfirm, onCancel, label = "Delete?" }: {
  onConfirm: () => void;
  onCancel: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 font-mono">{label}</span>
      <button onClick={onConfirm} className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-400 border border-red-900/60 hover:bg-red-900/60 transition-colors">yes</button>
      <button onClick={onCancel} className="text-xs px-2 py-1 rounded bg-neutral-800 text-neutral-500 hover:bg-neutral-700 transition-colors">no</button>
    </div>
  );
}

// ─── Playbook Dropdown (portal) ───────────────────────────────────────────────

export function PlaybookDropdown({
  anchorRef,
  playbooks,
  selected,
  onSelect,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  playbooks: { id: string; label: string; desc: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
      width: Math.max(rect.width, 220),
    });
  }, [anchorRef]);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as globalThis.Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  return createPortal(
    <div
      style={{ position: "absolute", top: pos.top, left: pos.left, minWidth: pos.width, zIndex: 9999 }}
      className="bg-neutral-900 border border-neutral-700 rounded-xl overflow-hidden shadow-2xl shadow-black/80"
      onMouseDown={e => e.stopPropagation()}
    >
      {playbooks.map((pb, i) => (
        <button
          key={pb.id}
          onClick={() => { onSelect(pb.id); onClose(); }}
          className={`w-full text-left px-4 py-3 transition-colors hover:bg-neutral-800 ${
            i < playbooks.length - 1 ? "border-b border-neutral-800" : ""
          } ${selected === pb.id ? "bg-neutral-800/60" : ""}`}
        >
          <p className="text-xs font-mono text-neutral-200">{pb.label}</p>
          <p className="text-[11px] text-neutral-600 mt-0.5">{pb.desc}</p>
        </button>
      ))}
    </div>,
    document.body
  );
}
