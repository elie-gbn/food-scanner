import type { LookupFailure } from "@/lib/lookup";

const TITLE: Record<LookupFailure["kind"], string> = {
  "not-found": "This product isn't in our databases",
  unreachable: "Couldn't check this product",
  busy: "Too many lookups",
  invalid: "That isn't a valid barcode",
};

/* Shown instead of a result. It never implies the product is fine: the person is sent back to the printed label. */
export function LookupProblem({ failure, words, onRetry, busy }: { failure: LookupFailure; words: string[]; onRetry: () => void; busy: boolean }) {
  return (
    <div className="tapp-notice food-verdict is-unknown" role="alert" style={{ display: "block" }}>
      <p className="food-verdict-head">? {TITLE[failure.kind]}</p>
      <p className="tapp-small" style={{ margin: ".5rem 0 0" }}>Barcode {failure.code}. {failure.detail ?? ""}</p>
      {failure.kind === "not-found" && <p style={{ margin: ".6rem 0 0" }}>Nothing was checked for your diet or allergies. Read the ingredient list on the package yourself.</p>}
      {failure.kind === "unreachable" && <p style={{ margin: ".6rem 0 0" }}>This is a connection problem, not an answer about the product. Nothing was checked. Try again, or read the label.</p>}
      {words.length > 0 && failure.kind !== "invalid" && (
        <p style={{ margin: ".6rem 0 0" }}><strong>Look for:</strong> {words.join(", ")}</p>
      )}
      {failure.retry && <button className="tapp-btn" style={{ marginTop: ".75rem" }} onClick={onRetry} disabled={busy}>Try again</button>}
    </div>
  );
}
