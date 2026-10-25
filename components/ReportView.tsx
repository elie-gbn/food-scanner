"use client";

import { AllergenPanel } from "@/components/AllergenPanel";
import type { AllergenId } from "@/lib/allergens";
import type { Guess } from "@/lib/recognize";
import type { FoodReport } from "@/lib/types";

/* FDA guidance for healthy adults. */
export const CAFFEINE_DAILY_MG = 400;

export const fmt = (value: number | null, unit: string) => value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 })} ${unit}`;
export const caffeineAmount = (report: FoodReport) => report.caffeine.perServing ?? report.caffeine.perContainer;
export const kcalPerServing = (report: FoodReport) => report.nutrients.find((item) => item.key === "energy-kcal")?.perServing ?? null;
const tone = (mg: number | null) => mg === null ? "ok" : mg >= 200 ? "bad" : mg >= 100 ? "warn" : "ok";

export function ReportView({ report, image, mine, saved, onSave, onBack, alternatives, onAlternative }: {
  report: FoodReport;
  /** Local photo to show when the report has no product image. */
  image?: string | null;
  mine: AllergenId[];
  saved: boolean;
  onSave: () => void;
  onBack?: { label: string; action: () => void };
  /** Other likely foods from photo recognition, offered as one-tap corrections. */
  alternatives?: Guess[];
  onAlternative?: (guess: Guess) => void;
}) {
  const caffeine = report.caffeine;
  const main = caffeineAmount(report);
  const picture = report.image ?? image ?? null;

  return (
    <>
      {onBack && <button className="tapp-btn tapp-btn-sm" style={{ marginBottom: ".75rem" }} onClick={onBack.action}>← {onBack.label}</button>}
      <div className="food-product">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos and local data URLs */}
        {picture && <img src={picture} alt="" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0 }}>{report.name}</h2>
          <p className="tapp-muted" style={{ margin: ".15rem 0 .4rem" }}>{[report.brand, report.quantity].filter(Boolean).join(" · ") || (report.origin === "photo" ? "Identified from photo" : "Generic food")}</p>
          <div className="tapp-row">
            {report.barcode && <span className="tapp-badge">{report.barcode}</span>}
            {report.photo && <span className={`tapp-badge ${report.photo.confidence === "picked" ? "info" : report.photo.confidence === "high" ? "ok" : report.photo.confidence === "medium" ? "warn" : "bad"}`}>{report.photo.confidence === "picked" ? "PICKED BY YOU" : `${report.photo.confidence.toUpperCase()} CONFIDENCE`}</span>}
            {report.nutriscore && <span className={`tapp-badge ${"ab".includes(report.nutriscore) ? "ok" : report.nutriscore === "c" ? "warn" : "bad"}`}>NUTRI-SCORE {report.nutriscore.toUpperCase()}</span>}
            {report.nova && <span className={`tapp-badge ${report.nova <= 2 ? "ok" : report.nova === 3 ? "warn" : "bad"}`}>NOVA {report.nova}</span>}
          </div>
        </div>
        <button className={`tapp-btn tapp-btn-sm${saved ? "" : " tapp-btn-primary"}`} onClick={onSave} aria-pressed={saved} style={{ flex: "none" }}>{saved ? "★ Saved" : "☆ Save"}</button>
      </div>

      {alternatives && alternatives.length > 0 && onAlternative && (
        <div className="tapp-row tapp-small" style={{ marginTop: ".6rem" }}>
          <span className="tapp-muted">Not right? Did you mean</span>
          {alternatives.map((guess) => <button key={guess.name} className="tapp-btn tapp-btn-sm" onClick={() => onAlternative(guess)}>{guess.name}{guess.probability >= 0.01 ? ` · ${Math.round(guess.probability * 100)}%` : ""}</button>)}
          <span className="tapp-muted">or search by name.</span>
        </div>
      )}

      <div className="food-caffeine">
        <div className="tapp-spread" style={{ alignItems: "flex-end" }}>
          <div>
            <span className="tapp-label">CAFFEINE{caffeine.perServing !== null ? " PER SERVING" : caffeine.perContainer !== null ? " PER CONTAINER" : ""}</span>
            {main !== null ? (
              <div className={`tapp-score ${tone(main)}`}><strong>{Math.round(main)}</strong><span>mg</span></div>
            ) : caffeine.per100 !== null ? (
              <div className="tapp-score ok"><strong>{fmt(caffeine.per100, "mg")}</strong><span>/ {report.basis}</span></div>
            ) : caffeine.signals.length ? (
              <p style={{ margin: ".3rem 0 0", color: "var(--t-warn)" }}>Contains caffeine, but the amount isn&apos;t published</p>
            ) : (
              <p style={{ margin: ".3rem 0 0", color: "var(--t-hot)" }}>No caffeine listed<br /><span className="tapp-small tapp-muted">Based on the published ingredients{report.ingredients ? "" : " (none on file)"}</span></p>
            )}
          </div>
          {(caffeine.perServing !== null || caffeine.perContainer !== null || caffeine.per100 !== null) && (
            <dl className="tapp-dl" style={{ maxWidth: "16rem" }}>
              <dt>Per {report.basis}</dt><dd>{fmt(caffeine.per100, "mg")}</dd>
              <dt>Per serving</dt><dd>{fmt(caffeine.perServing, "mg")}</dd>
              <dt>Per container</dt><dd>{fmt(caffeine.perContainer, "mg")}</dd>
            </dl>
          )}
        </div>
        {main !== null && (
          <>
            <div className={`tapp-bar ${tone(main)}`} style={{ marginTop: ".6rem" }}><i style={{ width: `${Math.min(100, (main / CAFFEINE_DAILY_MG) * 100)}%` }} /></div>
            <p className="tapp-small tapp-muted" style={{ margin: ".3rem 0 0" }}>{Math.round((main / CAFFEINE_DAILY_MG) * 100)}% of the 400 mg/day the FDA considers safe for most healthy adults</p>
          </>
        )}
        {caffeine.signals.length > 0 && <p className="tapp-small" style={{ margin: ".4rem 0 0" }}><span className="tapp-muted">Caffeine sources:</span> {caffeine.signals.join(", ")}</p>}
      </div>

      <AllergenPanel findings={report.allergens} mine={mine} hasIngredients={!!report.ingredients} fromPhoto={report.origin === "photo"} />

      <div className="tapp-panel-head" style={{ marginTop: "1rem" }}><h2>Nutrition</h2>{report.servingSize && <span className="tapp-small tapp-muted">Serving: {report.servingSize}</span>}</div>
      {report.nutrients.length ? (
        <div className="tapp-table-wrap"><table className="tapp-table">
          <thead><tr><th>NUTRIENT</th><th>PER {report.basis.toUpperCase()}</th><th>PER SERVING</th></tr></thead>
          <tbody>{report.nutrients.map((item) => <tr key={item.key}><td>{item.label}</td><td>{fmt(item.per100, item.unit)}</td><td>{fmt(item.perServing, item.unit)}</td></tr>)}</tbody>
        </table></div>
      ) : <p className="tapp-muted tapp-small">No nutrition facts have been published for this item yet.</p>}
      {report.photo && <p className="tapp-small tapp-muted" style={{ marginBottom: 0 }}>{report.photo.confidence === "picked" ? `You picked ${report.name}.` : `Recognized as ${report.name} (${report.photo.confidence} confidence).`} Serving: {report.photo.portion}. Values are for a typical serving from the closest USDA match.</p>}

      {report.ingredients && <details style={{ marginTop: "1rem" }}><summary className="tapp-muted" style={{ cursor: "pointer" }}>Ingredients</summary><p className="tapp-small" style={{ marginBottom: 0 }}>{report.ingredients}</p></details>}
      <p className="tapp-small tapp-muted" style={{ marginTop: "1rem", marginBottom: 0 }}>Source: {report.sources.map((source, index) => <span key={source.name}>{index > 0 && " + "}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)}{report.origin === "photo" && " · recognized on your device"} · {new Date(report.checkedAt).toLocaleString()}</p>
    </>
  );
}
