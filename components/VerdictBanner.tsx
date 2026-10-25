import type { DataQuality, Finding, Headline, Status } from "@/lib/verdict";
import { phrase } from "@/lib/verdict";

const TONE: Record<Status, { icon: string; tag: string; box: string }> = {
  contains: { icon: "⚠", tag: "Contains", box: "is-bad" },
  "may-contain": { icon: "!", tag: "May contain", box: "is-warn" },
  unknown: { icon: "?", tag: "Can't tell", box: "is-unknown" },
  clear: { icon: "✓", tag: "Not found", box: "" },
};

/* The answer a traveller reads first. Colour is never the only signal: every state has its own icon and words. */
export function VerdictBanner({ headline, findings, quality, hasProfile }: { headline: Headline | null; findings: Finding[]; quality: DataQuality; hasProfile: boolean }) {
  if (!hasProfile || !headline) {
    return (
      <div className="tapp-notice food-verdict is-unknown" role="status" style={{ marginBottom: "1rem" }}>
        <span aria-hidden="true">?</span>
        <span><strong>Choose what you avoid first.</strong> Open &ldquo;What can&apos;t you eat?&rdquo; above and tick your diet or allergies. Until then this product is not checked.</span>
      </div>
    );
  }
  const tone = TONE[headline.status];
  return (
    <section className={`tapp-notice food-verdict ${tone.box}`} role={headline.status === "contains" || headline.status === "may-contain" ? "alert" : "status"} style={{ marginBottom: "1rem", display: "block" }} aria-label="Result for your diet and allergies">
      <p className="food-verdict-head"><span aria-hidden="true">{tone.icon}</span> {headline.text}</p>
      <ul className="food-verdict-list">
        {findings.map((finding) => (
          <li key={finding.restriction}>
            <strong>{TONE[finding.status].tag}: {finding.status === "clear" || finding.status === "unknown" ? finding.label : phrase(finding)}</strong>
            {finding.evidence.slice(0, 4).map((line) => <span key={line} className="tapp-small"> · {line}</span>)}
            {finding.status !== "contains" && finding.notes.filter((note) => !quality.reasons.includes(note)).map((note) => <span key={note} className="tapp-small tapp-muted"> · {note}</span>)}
          </li>
        ))}
      </ul>
      {quality.state !== "ok" && findings.some((finding) => finding.status !== "contains") && (
        <p className="tapp-small" style={{ margin: ".6rem 0 0" }}><strong>Why some answers are &ldquo;can&apos;t tell&rdquo;:</strong> {quality.reasons.slice(0, 2).join(" ")} Check the label.</p>
      )}
      {headline.status === "clear" && <p className="tapp-small" style={{ margin: ".5rem 0 0" }}>This only means nothing was found in what the database lists. It is not a guarantee. Check the label.</p>}
    </section>
  );
}
