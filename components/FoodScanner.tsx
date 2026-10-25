"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FoodReport } from "@/app/api/food-scanner/route";

type Point = { x: number; y: number };
type Detected = { rawValue: string; cornerPoints: Point[] };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
/* FDA guidance for healthy adults. */
const CAFFEINE_DAILY_MG = 400;
/* Names as app/api/food-scanner/route.ts returns them (Open Food Facts allergen tags, prefix stripped). */
const ALLERGEN_CHOICES = ["gluten", "milk", "eggs", "peanuts", "nuts", "soybeans", "fish", "crustaceans", "molluscs", "sesame seeds", "celery", "mustard", "sulphur dioxide and sulphites", "lupin"];
const ALLERGEN_STORAGE_KEY = "labelens-my-allergens";
const EXAMPLES = [
  { code: "5449000000996", label: "Coca-Cola" },
  { code: "070847811169", label: "Monster" },
  { code: "3017620422003", label: "Nutella" },
];

async function createDetector(): Promise<{ detector: Detector; native: boolean }> {
  const NativeDetector = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> } }).BarcodeDetector;
  if (NativeDetector) {
    const supported = await NativeDetector.getSupportedFormats().catch(() => [] as string[]);
    const formats = FORMATS.filter((format) => supported.includes(format));
    if (formats.length) return { detector: new NativeDetector({ formats }), native: true };
  }
  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return { detector: new BarcodeDetector({ formats: FORMATS as never[] }) as unknown as Detector, native: false };
}

const fmt = (value: number | null, unit: string) => value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 })} ${unit}`;

export function FoodScanner() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(null);
  const candidate = useRef<{ code: string; hits: number }>({ code: "", hits: 0 });
  const lastLookup = useRef("");

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [cameraError, setCameraError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [box, setBox] = useState<{ points: Point[]; width: number; height: number } | null>(null);
  const [manual, setManual] = useState("");
  const [report, setReport] = useState<FoodReport | null>(null);
  const [busyCode, setBusyCode] = useState("");
  const [error, setError] = useState("");
  const [myAllergens, setMyAllergens] = useState<string[]>([]);
  const [history, setHistory] = useState<{ barcode: string; name: string; caffeine: number | null }[]>([]);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.replace(/\D/g, "");
    if (!code) return;
    lastLookup.current = code;
    setBusyCode(code);
    setError("");
    try {
      const response = await fetch(`/api/food-scanner?barcode=${code}`);
      const result = await response.json() as FoodReport & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Lookup failed.");
      setReport(result);
      const caffeine = result.caffeine.perServing ?? result.caffeine.perContainer;
      setHistory((current) => [{ barcode: result.barcode, name: result.name, caffeine }, ...current.filter((item) => item.barcode !== result.barcode)].slice(0, 10));
    } catch (cause) {
      setError(`${code}: ${cause instanceof Error ? cause.message : "Lookup failed."}`);
    } finally {
      setBusyCode("");
    }
  }, []);

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(ALLERGEN_STORAGE_KEY) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
      if (Array.isArray(saved)) setMyAllergens(saved.filter((item): item is string => typeof item === "string"));
    } catch {
      // Storage can be blocked or hold bad JSON; start with no saved allergens.
    }
  }, []);

  const toggleAllergen = (name: string) => {
    const next = myAllergens.includes(name) ? myAllergens.filter((item) => item !== name) : [...myAllergens, name];
    setMyAllergens(next);
    try {
      localStorage.setItem(ALLERGEN_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Not persisted; the choice still applies until the page closes.
    }
  };

  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setBox(null);
    setCameraState("idle");
  }, []);

  const startCamera = useCallback(async (id = "") => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState("error");
      setCameraError("This browser cannot open the camera. Use HTTPS (or localhost) in a recent browser, or type the barcode below.");
      return;
    }
    stream.current?.getTracks().forEach((track) => track.stop());
    setCameraState("starting");
    setCameraError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { deviceId: { exact: id }, width: { ideal: 1280 }, height: { ideal: 720 } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (!detector.current) {
        detector.current = (await createDetector()).detector;
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((device) => device.kind === "videoinput"));
      setDeviceId(media.getVideoTracks()[0]?.getSettings().deviceId ?? id);
      setCameraState("live");
    } catch (cause) {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      setCameraState("error");
      const name = cause instanceof DOMException ? cause.name : "";
      setCameraError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in the browser's site settings and try again." : name === "NotFoundError" ? "No camera was found on this device." : `Could not start the camera${cause instanceof Error ? `: ${cause.message}` : "."}`);
    }
  }, []);

  /* Scan loop: a code must be read twice in a row before it is looked up, which filters misreads. */
  useEffect(() => {
    if (cameraState !== "live") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const element = video.current;
      if (cancelled || !element || !detector.current) return;
      if (element.readyState >= 2 && element.videoWidth) {
        try {
          const [found] = await detector.current.detect(element);
          if (found) {
            setBox({ points: found.cornerPoints, width: element.videoWidth, height: element.videoHeight });
            const code = found.rawValue.replace(/\D/g, "");
            candidate.current = candidate.current.code === code ? { code, hits: candidate.current.hits + 1 } : { code, hits: 1 };
            if (candidate.current.hits === 2 && code !== lastLookup.current) {
              navigator.vibrate?.(60);
              void lookup(code);
            }
          } else {
            setBox(null);
            candidate.current = { code: "", hits: 0 };
          }
        } catch {
          // A frame can fail to decode while the camera refocuses; the next tick tries again.
        }
      }
      if (!cancelled) timer = setTimeout(tick, 180);
    }
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cameraState, lookup]);

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const caffeine = report?.caffeine;
  const caffeineMain = caffeine ? caffeine.perServing ?? caffeine.perContainer : null;
  const caffeineShare = caffeineMain === null ? 0 : Math.min(100, (caffeineMain / CAFFEINE_DAILY_MG) * 100);
  const caffeineTone = caffeineMain === null ? "ok" : caffeineMain >= 200 ? "bad" : caffeineMain >= 100 ? "warn" : "ok";

  const allergenHits = report ? report.allergens.filter((allergen) => myAllergens.includes(allergen.toLowerCase())) : [];

  return (
    <div className="tapp">
      <header className="tapp-header">
        <span className="tapp-brand">
          <span className="tapp-brand-mark" aria-hidden="true">▦</span>
          <span>Labelens</span>
        </span>
      </header>
      <div className="tapp-title">
        <h1>Scan a food barcode</h1>
        <p className="tapp-muted">Point your camera at a barcode to see caffeine, nutrition and allergens.</p>
      </div>

      <div className="food-layout">
        <section className="tapp-panel">
          <div className="tapp-panel-head">
            <h2>Camera</h2>
            {cameraState === "live" && <span className="tapp-badge ok">Scanning</span>}
          </div>
          <div className={`food-viewport${cameraState === "live" ? " is-live" : ""}`}>
            <video ref={video} playsInline muted aria-label="Camera feed" />
            {cameraState === "live" && (
              <svg className="food-overlay" viewBox={box ? `0 0 ${box.width} ${box.height}` : "0 0 100 100"} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                {box && <polygon points={box.points.map((point) => `${point.x},${point.y}`).join(" ")} />}
              </svg>
            )}
            {cameraState === "live" && !box && <div className="food-reticle" aria-hidden="true" />}
            {cameraState !== "live" && (
              <div className="food-placeholder">
                <button className="tapp-btn tapp-btn-primary" onClick={() => void startCamera(deviceId)} disabled={cameraState === "starting"}>{cameraState === "starting" ? "Starting camera…" : "Start camera"}</button>
                {cameraError && <p className="tapp-small" style={{ color: "var(--t-bad)", margin: 0 }}>{cameraError}</p>}
              </div>
            )}
            {busyCode && <div className="food-status">Looking up {busyCode}…</div>}
          </div>
          <div className="tapp-row" style={{ marginTop: ".75rem" }}>
            {cameraState === "live" && <button className="tapp-btn tapp-btn-sm" onClick={stopCamera}>Stop camera</button>}
            {devices.length > 1 && (
              <select className="tapp-input" style={{ flex: "1 1 12rem", padding: ".3rem .5rem" }} value={deviceId} onChange={(event) => { setDeviceId(event.target.value); void startCamera(event.target.value); }} aria-label="Camera">
                {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
              </select>
            )}
          </div>
          <form className="tapp-row" style={{ marginTop: ".75rem" }} onSubmit={(event) => { event.preventDefault(); void lookup(manual); }}>
            <input className="tapp-input" style={{ flex: "1 1 12rem" }} value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Or type a barcode" aria-label="Barcode" inputMode="numeric" autoComplete="off" />
            <button className="tapp-btn" type="submit" disabled={!!busyCode || !manual.trim()}>Look up</button>
          </form>
          <div className="tapp-row tapp-small" style={{ marginTop: ".6rem" }}>
            <span className="tapp-muted">Try an example:</span>
            {EXAMPLES.map((example) => <button key={example.code} className="tapp-btn tapp-btn-sm" onClick={() => void lookup(example.code)} disabled={!!busyCode}>{example.label}</button>)}
          </div>
          <details style={{ marginTop: ".75rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>My allergens{myAllergens.length > 0 && ` (${myAllergens.length})`}</summary>
            <div className="food-allergens">
              {ALLERGEN_CHOICES.map((name) => (
                <label key={name} className="food-chip tapp-small">
                  <input type="checkbox" checked={myAllergens.includes(name)} onChange={() => toggleAllergen(name)} />{name}
                </label>
              ))}
            </div>
          </details>
          {error && <div className="tapp-notice is-bad" style={{ marginTop: "1rem", marginBottom: 0 }}><span>✕</span><span>{error}</span></div>}
        </section>

        <section className="tapp-panel food-results" aria-live="polite">
          {!report ? (
            <div className="tapp-empty">
              <p style={{ fontSize: "2rem", margin: 0 }} aria-hidden="true">▦</p>
              <p>Your result will show up here.</p>
            </div>
          ) : (
            <>
              {allergenHits.length > 0 ? (
                <div className="tapp-notice is-bad" role="alert" style={{ marginBottom: "1rem" }}><span>⚠</span><span><strong>Contains your allergens:</strong> {allergenHits.join(", ")}</span></div>
              ) : myAllergens.length > 0 && (
                <div className="tapp-notice" style={{ marginBottom: "1rem" }}><span>✓</span><span>None of your allergens are listed for this product. Lists can be incomplete, so check the label.</span></div>
              )}
              <div className="food-product">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos from Open Food Facts */}
                {report.image && <img src={report.image} alt="" />}
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0 }}>{report.name}</h2>
                  <p className="tapp-muted" style={{ margin: ".15rem 0 .4rem" }}>{[report.brand, report.quantity].filter(Boolean).join(" · ") || "Unknown brand"}</p>
                  <div className="tapp-row">
                    <span className="tapp-badge">{report.barcode}</span>
                    {report.nutriscore && <span className={`tapp-badge ${"ab".includes(report.nutriscore) ? "ok" : report.nutriscore === "c" ? "warn" : "bad"}`}>Nutri-Score {report.nutriscore.toUpperCase()}</span>}
                    {report.nova && <span className={`tapp-badge ${report.nova <= 2 ? "ok" : report.nova === 3 ? "warn" : "bad"}`}>NOVA {report.nova}</span>}
                  </div>
                </div>
              </div>

              <div className="food-caffeine">
                <div className="tapp-spread" style={{ alignItems: "flex-end" }}>
                  <div>
                    <span className="tapp-label">Caffeine{caffeine?.perServing !== null ? " per serving" : caffeine?.perContainer !== null ? " per container" : ""}</span>
                    {caffeineMain !== null ? (
                      <div className={`tapp-score ${caffeineTone}`}><strong>{Math.round(caffeineMain)}</strong><span>mg</span></div>
                    ) : caffeine && caffeine.per100 !== null ? (
                      <div className="tapp-score ok"><strong>{fmt(caffeine.per100, "mg")}</strong><span>/ {report.basis}</span></div>
                    ) : caffeine?.signals.length ? (
                      <p style={{ margin: ".3rem 0 0", color: "var(--t-warn)" }}>Contains caffeine, but the amount isn&apos;t published</p>
                    ) : (
                      <p style={{ margin: ".3rem 0 0", color: "var(--t-accent)" }}>No caffeine found</p>
                    )}
                  </div>
                  {caffeine && (caffeine.perServing !== null || caffeine.perContainer !== null || caffeine.per100 !== null) && (
                    <dl className="tapp-dl" style={{ maxWidth: "16rem" }}>
                      <dt>Per {report.basis}</dt><dd>{fmt(caffeine.per100, "mg")}</dd>
                      <dt>Per serving</dt><dd>{fmt(caffeine.perServing, "mg")}</dd>
                      <dt>Per container</dt><dd>{fmt(caffeine.perContainer, "mg")}</dd>
                    </dl>
                  )}
                </div>
                {caffeineMain !== null && (
                  <>
                    <div className={`tapp-bar ${caffeineTone}`} style={{ marginTop: ".6rem" }}><i style={{ width: `${caffeineShare}%` }} /></div>
                    <p className="tapp-small tapp-muted" style={{ margin: ".3rem 0 0" }}>{Math.round((caffeineMain / CAFFEINE_DAILY_MG) * 100)}% of the 400 mg/day the FDA considers safe for most healthy adults</p>
                  </>
                )}
                {caffeine && caffeine.signals.length > 0 && <p className="tapp-small" style={{ margin: ".4rem 0 0" }}><span className="tapp-muted">Caffeine sources in ingredients:</span> {caffeine.signals.join(", ")}</p>}
              </div>

              <div className="tapp-panel-head" style={{ marginTop: "1rem" }}><h2>Nutrition</h2>{report.servingSize && <span className="tapp-small tapp-muted">Serving: {report.servingSize}</span>}</div>
              {report.nutrients.length ? (
                <div className="tapp-table-wrap"><table className="tapp-table">
                  <thead><tr><th>Nutrient</th><th>Per {report.basis}</th><th>Per serving</th></tr></thead>
                  <tbody>{report.nutrients.map((item) => <tr key={item.key}><td>{item.label}</td><td>{fmt(item.per100, item.unit)}</td><td>{fmt(item.perServing, item.unit)}</td></tr>)}</tbody>
                </table></div>
              ) : <p className="tapp-muted tapp-small">No nutrition facts have been published for this product yet.</p>}

              {report.allergens.length > 0 && <p style={{ marginTop: "1rem" }}><span className="tapp-label">Allergens</span>{report.allergens.map((allergen) => <span key={allergen} className="tapp-badge warn" style={{ marginRight: ".3rem", textTransform: "capitalize" }}>{allergen}</span>)}</p>}
              {report.ingredients && <details style={{ marginTop: "1rem" }}><summary style={{ cursor: "pointer", fontWeight: 600 }}>Ingredients</summary><p className="tapp-small" style={{ marginBottom: 0 }}>{report.ingredients}</p></details>}
              <p className="tapp-small tapp-muted" style={{ marginTop: "1rem", marginBottom: 0 }}>Source: {report.sources.map((source, index) => <span key={source.name}>{index > 0 && " + "}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)} · {new Date(report.checkedAt).toLocaleTimeString()}</p>
            </>
          )}
        </section>
      </div>

      {history.length > 0 && (
        <section className="tapp-panel" style={{ marginTop: "1rem" }}>
          <div className="tapp-panel-head"><h2>Recent scans</h2></div>
          <div className="tapp-table-wrap"><table className="tapp-table">
            <thead><tr><th>Product</th><th>Barcode</th><th>Caffeine</th></tr></thead>
            <tbody>{history.map((item) => <tr key={item.barcode} className={`is-clickable${item.barcode === report?.barcode ? " is-selected" : ""}`} onClick={() => void lookup(item.barcode)}><td className="wrap">{item.name}</td><td>{item.barcode}</td><td>{fmt(item.caffeine, "mg")}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
      <footer className="tapp-footer"><span>Product data is crowd-sourced and can be incomplete. Check the label when it matters.</span></footer>
    </div>
  );
}
