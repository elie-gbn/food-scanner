"use client";

import { ALLERGENS, allergenLabel, type AllergenFinding, type AllergenId, type AllergenStatus } from "@/lib/allergens";

const STATUS: Record<AllergenStatus, { label: string; tone: string }> = {
  contains: { label: "CONTAINS", tone: "bad" },
  ingredient: { label: "IN INGREDIENTS", tone: "bad" },
  traces: { label: "MAY CONTAIN", tone: "warn" },
  likely: { label: "LIKELY", tone: "warn" },
};

export function AllergenPanel({ findings, mine, hasIngredients, fromPhoto }: { findings: AllergenFinding[]; mine: AllergenId[]; hasIngredients: boolean; fromPhoto: boolean }) {
  const flagged = findings.filter((finding) => mine.includes(finding.id));
  const byId = new Map(findings.map((finding) => [finding.id, finding]));

  return (
    <div className="food-allergens">
      {flagged.length > 0 && (
        <div className="tapp-notice is-bad food-alert" role="alert">
          <span>⚠</span>
          <span><b>Contains your allergens:</b> {flagged.map((finding) => `${allergenLabel(finding.id)}${finding.status === "traces" ? " (may contain)" : finding.status === "likely" ? " (likely)" : ""}`).join(", ")}</span>
        </div>
      )}
      <div className="tapp-panel-head" style={{ marginTop: flagged.length ? ".75rem" : 0 }}>
        <h2>Allergens</h2>
        <span className="tapp-small tapp-muted">{findings.length ? `${findings.length} of 14 flagged` : "none flagged"}</span>
      </div>
      <ul className="food-allergen-grid">
        {ALLERGENS.map((allergen) => {
          const finding = byId.get(allergen.id);
          const status = finding ? STATUS[finding.status] : null;
          return (
            <li key={allergen.id} className={`${finding ? "is-flagged" : ""}${mine.includes(allergen.id) ? " is-mine" : ""}`}>
              <span>{allergen.label}{mine.includes(allergen.id) && <span className="tapp-muted" title="In your allergen list"> ★</span>}</span>
              {status ? <span className={`tapp-badge ${status.tone}`} title={finding?.evidence ? `Matched “${finding.evidence}”` : undefined}>{status.label}</span> : <span className="tapp-muted tapp-small">—</span>}
            </li>
          );
        })}
      </ul>
      <p className="tapp-small tapp-muted" style={{ margin: ".5rem 0 0" }}>
        {fromPhoto
          ? "Allergens for photo-identified foods are educated guesses about the typical recipe. Always ask or check the label if you have an allergy."
          : hasIngredients
            ? "From the product's declared allergens, “may contain” warnings, and a scan of the ingredient list. Always confirm on the package."
            : "No ingredient list is on file for this item, so allergens can't be fully checked. Confirm on the package."}
      </p>
    </div>
  );
}
