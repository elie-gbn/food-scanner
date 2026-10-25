"use client";

import { useMemo, useState } from "react";
import { caffeineAmount, CAFFEINE_DAILY_MG, kcalPerServing } from "@/components/ReportView";
import { allergenLabel, type AllergenId } from "@/lib/allergens";
import type { FoodReport } from "@/lib/types";

export type SavedScan = { report: FoodReport; savedAt: string; note: string; thumb: string | null };

type Filter = "all" | "mine" | "caffeine" | "photo";
type Sort = "newest" | "oldest" | "caffeine" | "calories" | "name";

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function SavedLibrary({ saved, mine, onOpen, onDelete, onNote, onClear }: {
  saved: SavedScan[];
  mine: AllergenId[];
  onOpen: (scan: SavedScan) => void;
  onDelete: (id: string) => void;
  onNote: (id: string, note: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("newest");

  const today = useMemo(() => {
    const now = new Date();
    const items = saved.filter((scan) => sameDay(new Date(scan.savedAt), now));
    return { count: items.length, caffeine: items.reduce((total, scan) => total + (caffeineAmount(scan.report) ?? 0), 0) };
  }, [saved]);

  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    const list = saved.filter((scan) => {
      const { report } = scan;
      if (words && !`${report.name} ${report.brand ?? ""} ${report.barcode ?? ""} ${scan.note}`.toLowerCase().includes(words)) return false;
      if (filter === "mine") return report.allergens.some((finding) => mine.includes(finding.id));
      if (filter === "caffeine") return (caffeineAmount(report) ?? report.caffeine.per100 ?? 0) > 0 || report.caffeine.signals.length > 0;
      if (filter === "photo") return report.origin === "photo";
      return true;
    });
    const by: Record<Sort, (a: SavedScan, b: SavedScan) => number> = {
      newest: (a, b) => b.savedAt.localeCompare(a.savedAt),
      oldest: (a, b) => a.savedAt.localeCompare(b.savedAt),
      caffeine: (a, b) => (caffeineAmount(b.report) ?? -1) - (caffeineAmount(a.report) ?? -1),
      calories: (a, b) => (kcalPerServing(b.report) ?? -1) - (kcalPerServing(a.report) ?? -1),
      name: (a, b) => a.report.name.localeCompare(b.report.name),
    };
    return [...list].sort(by[sort]);
  }, [saved, query, filter, sort, mine]);

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
          <p>Nothing saved yet. Scan, search, or photograph a food, then press <b>Save</b> to keep it here.</p>
          <p className="tapp-small">Saved scans stay in this browser on this device.</p>
        </div>
      </section>
    );
  }

  return (
    <>
      <div className="tapp-kpis food-kpis">
        <div className="tapp-kpi"><span>SAVED</span><strong>{saved.length}</strong><small>items in this browser</small></div>
        <div className="tapp-kpi"><span>SAVED TODAY</span><strong>{today.count}</strong><small>items</small></div>
        <div className="tapp-kpi"><span>CAFFEINE TODAY</span><strong style={{ color: today.caffeine >= CAFFEINE_DAILY_MG ? "var(--t-bad)" : undefined }}>{Math.round(today.caffeine)} mg</strong><small>{Math.round((today.caffeine / CAFFEINE_DAILY_MG) * 100)}% of 400 mg, from today&apos;s saves</small></div>
      </div>

      <section className="tapp-panel">
        <div className="tapp-row" style={{ marginBottom: ".75rem" }}>
          <input className="tapp-input" style={{ flex: "1 1 14rem" }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved items and notes" aria-label="Search saved items" />
          <select className="tapp-input" value={filter} onChange={(event) => setFilter(event.target.value as Filter)} aria-label="Filter">
            <option value="all">All items</option>
            <option value="mine">Has my allergens</option>
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
              const flagged = report.allergens.filter((finding) => mine.includes(finding.id));
              const picture = report.image ?? scan.thumb;
              const mg = caffeineAmount(report);
              const kcal = kcalPerServing(report);
              return (
                <li key={report.id}>
                  <button className="food-saved-main" onClick={() => onOpen(scan)} aria-label={`Open ${report.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos and local data URLs */}
                    {picture ? <img src={picture} alt="" /> : <span className="food-saved-ph" aria-hidden="true">{report.origin === "photo" ? "◉" : report.barcode ? "▦" : "⌕"}</span>}
                    <span style={{ minWidth: 0 }}>
                      <b className="food-saved-name">{report.name}</b>
                      <span className="tapp-small tapp-muted">{[report.brand, new Date(scan.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })].filter(Boolean).join(" · ")}</span>
                      <span className="tapp-row tapp-small" style={{ marginTop: ".3rem" }}>
                        <span className="tapp-badge info">{mg !== null ? `${Math.round(mg)} MG CAFFEINE` : report.caffeine.signals.length ? "CAFFEINE ?" : "NO CAFFEINE"}</span>
                        {kcal !== null && <span className="tapp-badge">{Math.round(kcal)} KCAL</span>}
                        {flagged.map((finding) => <span key={finding.id} className="tapp-badge bad">⚠ {allergenLabel(finding.id).toUpperCase()}</span>)}
                      </span>
                    </span>
                  </button>
                  <div className="tapp-row" style={{ marginTop: ".5rem" }}>
                    <input className="tapp-input tapp-small" style={{ flex: "1 1 12rem", padding: ".3rem .5rem" }} defaultValue={scan.note} onBlur={(event) => { if (event.target.value !== scan.note) onNote(report.id, event.target.value); }} placeholder="Add a note (where you bought it, how it tasted…)" aria-label={`Note for ${report.name}`} maxLength={280} />
                    <button className="tapp-btn tapp-btn-sm tapp-btn-danger" onClick={() => onDelete(report.id)} aria-label={`Delete ${report.name}`}>Delete</button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="tapp-muted">No saved items match.</p>}

        <div className="tapp-row" style={{ marginTop: "1rem", justifyContent: "space-between" }}>
          <span className="tapp-small tapp-muted">Saved scans live in this browser only. Export them to keep a copy.</span>
          <span className="tapp-row">
            <button className="tapp-btn tapp-btn-sm" onClick={exportJson}>Export JSON</button>
            <button className="tapp-btn tapp-btn-sm tapp-btn-danger" onClick={() => { if (window.confirm(`Delete all ${saved.length} saved items? This can't be undone.`)) onClear(); }}>Delete all</button>
          </span>
        </div>
      </section>
    </>
  );
}
