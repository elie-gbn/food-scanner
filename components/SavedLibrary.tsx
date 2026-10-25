"use client";

import { useMemo, useState } from "react";
import { reportId, type FoodReport } from "@/lib/report";
import { isEmptyProfile } from "@/lib/profile";
import { evaluate, headline, type Profile } from "@/lib/verdict";

export type SavedScan = { report: FoodReport; savedAt: string; note: string; thumb: string | null };

type Filter = "all" | "flagged" | "caffeine" | "photo";
type Sort = "newest" | "oldest" | "caffeine" | "calories" | "name";

/* FDA guidance for healthy adults. */
const CAFFEINE_DAILY_MG = 400;
export const caffeineAmount = (report: FoodReport) => report.caffeine.perServing ?? report.caffeine.perContainer;
const kcal = (report: FoodReport) => report.nutrients.find((item) => item.key === "energy-kcal")?.perServing ?? null;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function SavedLibrary({ saved, profile, onOpen, onDelete, onNote, onClear }: {
  saved: SavedScan[];
  profile: Profile;
  onOpen: (scan: SavedScan) => void;
  onDelete: (id: string) => void;
  onNote: (id: string, note: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");
  const checking = !isEmptyProfile(profile);

  /* Verdicts are re-run against the current profile, so changing what you avoid updates the whole list. */
  const verdicts = useMemo(() => new Map(saved.map((scan) => [reportId(scan.report), checking ? headline(evaluate(scan.report, profile)) : null])), [saved, profile, checking]);

  const today = useMemo(() => {
    const now = new Date();
    const items = saved.filter((scan) => sameDay(new Date(scan.savedAt), now));
    return { count: items.length, caffeine: items.reduce((total, scan) => total + (caffeineAmount(scan.report) ?? 0), 0) };
  }, [saved]);

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    const list = saved.filter((scan) => {
      const { report } = scan;
      if (words && !`${report.name} ${report.brand ?? ""} ${report.barcode} ${scan.note}`.toLowerCase().includes(words)) return false;
      const status = verdicts.get(reportId(report))?.status;
      if (filter === "flagged") return status === "contains" || status === "may-contain";
      if (filter === "caffeine") return (caffeineAmount(report) ?? report.caffeine.per100 ?? 0) > 0 || report.caffeine.signals.length > 0;
      if (filter === "photo") return report.origin === "photo";
      return true;
    });
    const by: Record<Sort, (a: SavedScan, b: SavedScan) => number> = {
      newest: (a, b) => b.savedAt.localeCompare(a.savedAt),
      oldest: (a, b) => a.savedAt.localeCompare(b.savedAt),
      caffeine: (a, b) => (caffeineAmount(b.report) ?? -1) - (caffeineAmount(a.report) ?? -1),
      calories: (a, b) => (kcal(b.report) ?? -1) - (kcal(a.report) ?? -1),
      name: (a, b) => a.report.name.localeCompare(b.report.name),
    };
    return [...list].sort(by[sort]);
  }, [saved, query, filter, sort, verdicts]);

  function exportJson() {
    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: `labelens-saved-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!saved.length) {
    return (
      <section className="tapp-panel">
        <div className="tapp-empty">
          <p style={{ fontSize: "2rem", margin: 0 }} aria-hidden="true">☆</p>
          <p>Nothing saved yet. Scan, search or photograph a food, then press <strong>Save</strong> to keep it here.</p>
          <p className="tapp-small tapp-muted">Saved on this device only. It is never sent anywhere.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="food-kpis">
        <div className="tapp-panel"><span className="tapp-label">Saved</span><strong>{saved.length}</strong><span className="tapp-small tapp-muted">on this device</span></div>
        <div className="tapp-panel"><span className="tapp-label">Saved today</span><strong>{today.count}</strong><span className="tapp-small tapp-muted">items</span></div>
        <div className="tapp-panel">
          <span className="tapp-label">Caffeine today</span>
          <strong style={{ color: today.caffeine >= CAFFEINE_DAILY_MG ? "var(--t-bad)" : undefined }}>{Math.round(today.caffeine)} mg</strong>
          <span className="tapp-small tapp-muted">{Math.round((today.caffeine / CAFFEINE_DAILY_MG) * 100)}% of 400 mg, from today&apos;s saves</span>
        </div>
      </div>

      <section className="tapp-panel">
        <div className="tapp-row" style={{ marginBottom: ".75rem" }}>
          <input className="tapp-input" style={{ flex: "1 1 14rem" }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved items and notes" aria-label="Search saved items" />
          <select className="tapp-input" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter">
            <option value="all">All items</option>
            <option value="flagged" disabled={!checking}>Flagged for me</option>
            <option value="caffeine">Has caffeine</option>
            <option value="photo">From photos</option>
          </select>
          <select className="tapp-input" value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="caffeine">Most caffeine</option>
            <option value="calories">Most calories</option>
            <option value="name">Name A–Z</option>
          </select>
        </div>

        {visible.length ? (
          <ul className="food-saved">
            {visible.map((scan) => {
              const { report } = scan;
              const id = reportId(report);
              const verdict = verdicts.get(id);
              const picture = report.image ?? scan.thumb;
              const mg = caffeineAmount(report);
              const energy = kcal(report);
              return (
                <li key={id}>
                  <button className="food-saved-main" onClick={() => onOpen(scan)} aria-label={`Open ${report.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos and local data URLs */}
                    {picture ? <img src={picture} alt="" /> : <span className="food-saved-ph" aria-hidden="true">{report.origin === "photo" ? "◉" : report.barcode ? "▦" : "⌕"}</span>}
                    <span style={{ minWidth: 0 }}>
                      <strong className="food-saved-name">{report.name}</strong>
                      <span className="tapp-small tapp-muted">{[report.brand, new Date(scan.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}</span>
                      <span className="tapp-row tapp-small" style={{ marginTop: ".3rem" }}>
                        {verdict && verdict.status !== "clear" && <span className={`tapp-badge ${verdict.status === "contains" ? "bad" : "warn"}`}>{verdict.status === "unknown" ? "Can't tell" : verdict.text}</span>}
                        <span className="tapp-badge">{mg !== null ? `${Math.round(mg)} mg caffeine` : report.caffeine.signals.length ? "Caffeine ?" : "No caffeine"}</span>
                        {energy !== null && <span className="tapp-badge">{Math.round(energy)} kcal</span>}
                      </span>
                    </span>
                  </button>
                  <div className="tapp-row" style={{ marginTop: ".5rem" }}>
                    <input className="tapp-input tapp-small" style={{ flex: "1 1 12rem" }} defaultValue={scan.note} onBlur={(event) => { if (event.target.value !== scan.note) onNote(id, event.target.value); }} placeholder="Add a note (where you bought it, how it tasted…)" aria-label={`Note for ${report.name}`} maxLength={280} />
                    <button className="tapp-btn tapp-btn-sm" onClick={() => onDelete(id)} aria-label={`Delete ${report.name}`}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="tapp-muted">No saved items match.</p>}

        <div className="tapp-row" style={{ marginTop: "1rem", justifyContent: "space-between" }}>
          <span className="tapp-small tapp-muted">Saved on this device only. Export to keep a copy.</span>
          <span className="tapp-row">
            <button className="tapp-btn tapp-btn-sm" onClick={exportJson}>Export JSON</button>
            <button className="tapp-btn tapp-btn-sm" onClick={() => { if (window.confirm(`Delete all ${saved.length} saved items? This can't be undone.`)) onClear(); }}>Delete all</button>
          </span>
        </div>
      </section>
    </>
  );
}
