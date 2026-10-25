"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reportId, type FoodReport } from "@/lib/report";
import { highlightTerms } from "@/lib/diet";
import { classifyLookup, watchFor, type LookupFailure } from "@/lib/lookup";
import { isEmptyProfile } from "@/lib/profile";
import { ingredientView, LANGUAGES, translateUrl } from "@/lib/translate";
import { recognizeFood, type Guess } from "@/lib/recognize";
import { useStored } from "@/lib/use-stored";
import { assessData, evaluate, headline } from "@/lib/verdict";
import { ProfileSetup } from "./ProfileSetup";
import { caffeineAmount, SavedLibrary, type SavedScan } from "./SavedLibrary";
import { LookupProblem } from "./LookupProblem";
import { VerdictBanner } from "./VerdictBanner";
import { useProfile } from "./useProfile";

type Point = { x: number; y: number };
type Detected = { rawValue: string; cornerPoints: Point[] };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
/* FDA guidance for healthy adults. */
const CAFFEINE_DAILY_MG = 400;
const EXAMPLES = [
  { query: "5449000000996", label: "Coca-Cola" },
  { query: "070847811169", label: "Monster" },
  { query: "3017620422003", label: "Nutella" },
  { query: "espresso", label: "espresso" },
  { query: "green tea", label: "green tea" },
];

/** Downscale an image or video frame to a JPEG data URL. */
function toJpeg(source: CanvasImageSource, width: number, height: number, max: number, quality = 0.85) {
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file isn't an image the browser can read.")); };
    image.src = url;
  });
}

type Results = { title: string; reports: FoodReport[]; warnings: string[] };

async function createDetector(): Promise<{ detector: Detector; native: boolean }> {
  const NativeDetector = (globalThis as { BarcodeDetector?: { new (options: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> } }).BarcodeDetector;
  if (NativeDetector) {
    const supported = await NativeDetector.getSupportedFormats().catch(() => [] as string[]);
    const formats = FORMATS.filter((format) => supported.includes(format));
    if (formats.length) return { detector: new NativeDetector({ formats }), native: true };
  }
  const { BarcodeDetector, setZXingModuleOverrides } = await import("barcode-detector/ponyfill");
  // Serve the decoder from /public so scanning does not depend on reaching a CDN.
  setZXingModuleOverrides({ locateFile: (path, prefix) => path.endsWith(".wasm") ? "/zxing_reader.wasm" : prefix + path });
  return { detector: new BarcodeDetector({ formats: FORMATS as never[] }) as unknown as Detector, native: false };
}

const fmt = (value: number | null, unit: string) => value === null ? "—" : `${value.toLocaleString(undefined, { maximumFractionDigits: value < 10 ? 2 : 1 })} ${unit}`;

export function FoodScanner() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(null);
  const candidate = useRef<{ code: string; hits: number }>({ code: "", hits: 0 });
  const lastLookup = useRef("");
  const failures = useRef(0);

  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [cameraError, setCameraError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [box, setBox] = useState<{ points: Point[]; width: number; height: number } | null>(null);
  const [manual, setManual] = useState("");
  const [report, setReport] = useState<FoodReport | null>(null);
  const [busyCode, setBusyCode] = useState("");
  const [error, setError] = useState("");
  const [failure, setFailure] = useState<LookupFailure | null>(null);
  const { profile, setProfile } = useProfile();
  const [history, setHistory] = useState<{ barcode: string; name: string; caffeine: number | null }[]>([]);
  const [tab, setTab] = useState<"scan" | "saved">("scan");
  const [results, setResults] = useState<Results | null>(null);
  /** Search results the current report was opened from, for "Back to results". */
  const [backTo, setBackTo] = useState<Results | null>(null);
  /** Photo thumbnail and the recognizer's other guesses, for the current photo result. */
  const [photo, setPhoto] = useState<{ thumb: string; alternatives: Guess[] } | null>(null);
  const [busy, setBusy] = useState("");
  const [saved, setSaved, savedLoaded] = useStored<SavedScan[]>("labelens-saved", []);

  /* Show one result and clear whatever else was on screen. */
  const show = useCallback((next: FoodReport | null, extra: { backTo?: Results | null; photo?: { thumb: string; alternatives: Guess[] } | null } = {}) => {
    setReport(next);
    setResults(null);
    setFailure(null);
    setError("");
    setBackTo(extra.backTo ?? null);
    setPhoto(extra.photo ?? null);
    setTab("scan");
  }, []);

  const lookup = useCallback(async (raw: string) => {
    const code = raw.replace(/\D/g, "");
    if (!code) return;
    lastLookup.current = code;
    setBusyCode(code);
    setError("");
    setFailure(null);
    // Never leave the previous product on screen while another one is being looked up or has failed.
    show(null);
    try {
      const response = await fetch(`/api/food-scanner?barcode=${code}`);
      const result = await response.json().catch(() => ({})) as FoodReport & { error?: string };
      if (!response.ok) {
        setFailure(classifyLookup(response.status, code, result.error ?? null));
        return;
      }
      setReport(result);
      const caffeine = result.caffeine.perServing ?? result.caffeine.perContainer;
      setHistory((current) => [{ barcode: result.barcode, name: result.name, caffeine }, ...current.filter((item) => item.barcode !== result.barcode)].slice(0, 10));
    } catch {
      setFailure(classifyLookup(null, code));
    } finally {
      setBusyCode("");
    }
  }, [show]);

  const run = useCallback(async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  }, []);

  const search = useCallback((query: string) => run(`Searching “${query}”…`, async () => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const result = await response.json().catch(() => ({})) as { results?: FoodReport[]; warnings?: string[]; error?: string };
    if (!response.ok || !result.results) throw new Error(result.error ?? "Search failed. Try again in a moment.");
    if (!result.results.length) throw new Error(`No foods found for “${query}”.`);
    show(null);
    setResults({ title: `Results for “${query}”`, reports: result.results, warnings: result.warnings ?? [] });
  }), [run, show]);

  const showGuess = useCallback((guess: Guess, alternatives: Guess[], thumb: string, picked = false) => run(`Looking up ${guess.name}…`, async () => {
    const confidence = picked ? "picked" : guess.probability >= 0.7 ? "high" : guess.probability >= 0.35 ? "medium" : "low";
    const response = await fetch(`/api/identify?food=${encodeURIComponent(guess.name)}&confidence=${confidence}`);
    const result = await response.json().catch(() => ({})) as FoodReport & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Lookup failed.");
    show(result, { photo: { thumb, alternatives: alternatives.filter((item) => item.name !== guess.name) } });
  }), [run, show]);

  /* Recognition runs entirely in the browser; only the recognized food's name goes to the server. */
  const identify = useCallback((image: HTMLImageElement | HTMLVideoElement, width: number, height: number) => run("Recognizing food…", async () => {
    const thumb = toJpeg(image, width, height, 240, 0.75);
    const blob = await (await fetch(toJpeg(image, width, height, 512))).blob();
    const { guesses, notFood } = await recognizeFood(blob, (percent) => setBusy(`Downloading the food model (one time, ~43 MB)… ${percent}%`));
    if (notFood || !guesses.length) throw new Error("No food recognized in that photo. Try getting closer, or search by name.");
    await showGuess(guesses[0], guesses, thumb);
  }), [run, showGuess]);

  function submit(value = manual) {
    const text = value.trim();
    if (!text) return;
    setManual(text);
    if (/^\d[\d\s-]{6,}$/.test(text)) void lookup(text);
    else void search(text);
  }

  function captureFrame() {
    const element = video.current;
    if (element?.videoWidth) void identify(element, element.videoWidth, element.videoHeight);
  }

  async function uploadPhoto(file: File | undefined) {
    if (!file) return;
    try {
      const image = await loadImage(file);
      void identify(image, image.naturalWidth, image.naturalHeight);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read that photo.");
    }
  }

  const isSaved = report ? saved.some((scan) => reportId(scan.report) === reportId(report)) : false;
  function toggleSave() {
    if (!report) return;
    const id = reportId(report);
    setSaved((current) => current.some((scan) => reportId(scan.report) === id)
      ? current.filter((scan) => reportId(scan.report) !== id)
      : [{ report, savedAt: new Date().toISOString(), note: "", thumb: report.image ? null : photo?.thumb ?? null }, ...current]);
  }

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
        video: id ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      // Webcams often default to fixed focus; ask for autofocus where the camera supports it.
      await media.getVideoTracks()[0]?.applyConstraints({ advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet] }).catch(() => {});
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
          failures.current = 0;
        } catch {
          // A frame can fail to decode while the camera refocuses; keep trying, but say so if it never recovers.
          if (++failures.current === 15) setError("The barcode reader isn't working. Type the barcode below instead.");
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

  const findings = useMemo(() => report ? evaluate(report, profile) : [], [report, profile]);
  const quality = useMemo(() => report ? assessData(report) : { state: "ok" as const, reasons: [] }, [report]);
  const highlights = useMemo(() => findings.flatMap((finding) => finding.status === "contains" || finding.status === "may-contain" ? finding.terms : []), [findings]);
  const view = report ? ingredientView(report) : null;
  const translation = view ? translateUrl(view.original ?? view.english, profile.language) : null;
  const marked = (text: string) => highlightTerms(text, highlights).map((piece, index) => piece.hit ? <mark key={index} className="food-hit">{piece.text}</mark> : piece.text);
  const hasHit = findings.some((finding) => finding.status === "contains" || finding.status === "may-contain");

  return (
    <div className="tapp">
      <header className="tapp-header">
        <span className="tapp-brand">
          <span className="tapp-brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="#fff"><rect x="2" y="3" width="2" height="14" /><rect x="6" y="3" width="1" height="14" /><rect x="9" y="3" width="3" height="14" /><rect x="14" y="3" width="1" height="14" /><rect x="17" y="3" width="1" height="14" /></svg>
          </span>
          <span>Labelens</span>
        </span>
        <nav className="food-tabs" aria-label="Sections">
          <button className={tab === "scan" ? "is-active" : ""} onClick={() => setTab("scan")} aria-current={tab === "scan" ? "page" : undefined}>Scan</button>
          <button className={tab === "saved" ? "is-active" : ""} onClick={() => setTab("saved")} aria-current={tab === "saved" ? "page" : undefined}>Saved{savedLoaded && saved.length ? ` (${saved.length})` : ""}</button>
        </nav>
      </header>
      <div className="tapp-title">
        <h1>Scan a food barcode</h1>
        <p className="tapp-muted">Tell us what you avoid, then scan a barcode, photograph a food, or search by name to see what is in it.</p>
        <div className="food-bars" aria-hidden="true" />
      </div>

      <ProfileSetup profile={profile} onChange={setProfile} />

      <div className="food-layout" hidden={tab !== "scan"}>
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
            {cameraState === "live" && !box && <div className="food-status">Hold the barcode flat inside the corners</div>}
            {cameraState !== "live" && (
              <div className="food-placeholder">
                <button className="tapp-btn tapp-btn-primary" onClick={() => void startCamera(deviceId)} disabled={cameraState === "starting"}>{cameraState === "starting" ? "Starting camera…" : "Start camera"}</button>
                {cameraError && <p className="tapp-small" style={{ color: "var(--t-bad)", margin: 0 }}>{cameraError}</p>}
              </div>
            )}
            {(busyCode || busy) && <div className="food-status">{busy || `Looking up ${busyCode}…`}</div>}
          </div>
          <div className="tapp-row" style={{ marginTop: ".75rem" }}>
            {cameraState === "live" && <button className="tapp-btn tapp-btn-primary" onClick={captureFrame} disabled={!!busy}>Identify food in frame</button>}
            <label className={`tapp-btn${cameraState === "live" ? "" : " tapp-btn-primary"}`} aria-disabled={!!busy}>
              {cameraState === "live" ? "Upload a photo" : "Photo of food"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {cameraState === "live" && <button className="tapp-btn tapp-btn-sm" onClick={stopCamera}>Stop camera</button>}
            {devices.length > 1 && (
              <select className="tapp-input" style={{ flex: "1 1 12rem", padding: ".3rem .5rem" }} value={deviceId} onChange={(event) => { setDeviceId(event.target.value); void startCamera(event.target.value); }} aria-label="Camera">
                {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
              </select>
            )}
          </div>
          <p className="tapp-small tapp-muted" style={{ margin: ".5rem 0 0" }}>Barcodes are read automatically. For fresh food, meals or drinks without a label, take a photo: it is recognized on this device and never uploaded.</p>
          <form className="tapp-row" style={{ marginTop: ".75rem" }} onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <input className="tapp-input" style={{ flex: "1 1 12rem" }} value={manual} onChange={(event) => setManual(event.target.value)} placeholder="Barcode or food name, e.g. banana" aria-label="Barcode or food name" autoComplete="off" enterKeyHint="search" />
            <button className="tapp-btn" type="submit" disabled={!!busyCode || !!busy || !manual.trim()}>Look up</button>
          </form>
          <div className="tapp-row tapp-small" style={{ marginTop: ".6rem" }}>
            <span className="tapp-muted">Try an example:</span>
            {EXAMPLES.map((example) => <button key={example.query} className="tapp-btn tapp-btn-sm" onClick={() => submit(example.query)} disabled={!!busyCode || !!busy}>{example.label}</button>)}
          </div>
          {error && <div className="tapp-notice is-bad" style={{ marginTop: "1rem", marginBottom: 0 }}><span>✕</span><span>{error}</span></div>}
        </section>

        <section className="tapp-panel food-results" aria-live="polite">
          {!report && results ? (
            <>
              <div className="tapp-panel-head"><h2>{results.title}</h2></div>
              {results.warnings.map((warning) => <p key={warning} className="tapp-small tapp-muted">{warning}</p>)}
              <ul className="food-candidates">
                {results.reports.map((item) => (
                  <li key={reportId(item)}>
                    <button onClick={() => show(item, { backTo: results })}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos from Open Food Facts */}
                      {item.image ? <img src={item.image} alt="" /> : <span className="food-saved-ph" aria-hidden="true">{item.generic ? "⌕" : "▦"}</span>}
                      <span style={{ minWidth: 0 }}>
                        <strong>{item.name}</strong>
                        <span className="tapp-small tapp-muted">{[item.brand, item.generic ? "Typical recipe (USDA)" : item.sources[0]?.name].filter(Boolean).join(" · ")}</span>
                      </span>
                      {caffeineAmount(item) !== null && <span className="tapp-small food-candidate-mg">{Math.round(caffeineAmount(item)!)} mg</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : !report && failure ? (
            <LookupProblem failure={failure} words={watchFor(profile)} onRetry={() => void lookup(failure.code)} busy={!!busyCode} />
          ) : !report ? (
            <div className="tapp-empty">
              <p style={{ fontSize: "2rem", margin: 0 }} aria-hidden="true">▦</p>
              <p>{busyCode ? `Looking up ${busyCode}…` : busy || "Your result will show up here."}</p>
            </div>
          ) : (
            <>
              {backTo && <button className="tapp-btn tapp-btn-sm" style={{ marginBottom: ".75rem" }} onClick={() => { show(null); setResults(backTo); }}>← Back to results</button>}
              <VerdictBanner headline={headline(findings)} findings={findings} quality={quality} hasProfile={!isEmptyProfile(profile)} />
              <div className="food-product">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos and local photo thumbnails */}
                {(report.image ?? photo?.thumb) && <img src={report.image ?? photo?.thumb} alt="" />}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 style={{ margin: 0 }}>{report.name}</h2>
                  <p className="tapp-muted" style={{ margin: ".15rem 0 .4rem" }}>{[report.brand, report.quantity].filter(Boolean).join(" · ") || (report.origin === "photo" ? "Recognized from your photo" : report.generic ? "Typical recipe, not a specific product" : "Unknown brand")}</p>
                  <div className="tapp-row">
                    {report.barcode && <span className="tapp-badge">{report.barcode}</span>}
                    {report.photo && <span className={`tapp-badge ${report.photo.confidence === "picked" || report.photo.confidence === "high" ? "ok" : report.photo.confidence === "medium" ? "warn" : "bad"}`}>{report.photo.confidence === "picked" ? "Picked by you" : `${report.photo.confidence[0].toUpperCase()}${report.photo.confidence.slice(1)} confidence`}</span>}
                    {report.nutriscore && <span className={`tapp-badge ${"ab".includes(report.nutriscore) ? "ok" : report.nutriscore === "c" ? "warn" : "bad"}`}>Nutri-Score {report.nutriscore.toUpperCase()}</span>}
                    {report.nova && <span className={`tapp-badge ${report.nova <= 2 ? "ok" : report.nova === 3 ? "warn" : "bad"}`}>NOVA {report.nova}</span>}
                  </div>
                </div>
                <button className={`tapp-btn tapp-btn-sm${isSaved ? "" : " tapp-btn-primary"}`} onClick={toggleSave} aria-pressed={isSaved} style={{ flex: "none" }}>{isSaved ? "★ Saved" : "☆ Save"}</button>
              </div>
              {photo && photo.alternatives.length > 0 && (
                <div className="tapp-row tapp-small" style={{ marginTop: ".6rem" }}>
                  <span className="tapp-muted">Not right? Did you mean</span>
                  {photo.alternatives.map((guess) => <button key={guess.name} className="tapp-btn tapp-btn-sm" disabled={!!busy} onClick={() => void showGuess(guess, [...photo.alternatives, { name: report.name, probability: 0 }], photo.thumb, true)}>{guess.name}</button>)}
                  <span className="tapp-muted">or search by name.</span>
                </div>
              )}

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
                      <p style={{ margin: ".3rem 0 0", color: report.ingredients ? "var(--t-accent)" : "var(--t-dim)" }}>{report.ingredients ? "No caffeine found" : "No caffeine data for this product"}</p>
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
              {view?.original ? (
                <details key={`${report.barcode}-${hasHit}`} open={hasHit} style={{ marginTop: "1rem" }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ingredients</summary>
                  {view.english && (
                    <>
                      <span className="tapp-label" style={{ display: "block", marginTop: ".6rem" }}>English, as written in the database (can leave things out; the original below is what counts)</span>
                      <p className="tapp-small" style={{ margin: 0 }}>{marked(view.english)}</p>
                    </>
                  )}
                  <span className="tapp-label" style={{ display: "block", marginTop: ".6rem" }}>Original{view.originalLang ? ` (${view.originalLang})` : ""}</span>
                  <p className="tapp-small" style={{ margin: 0 }}>{marked(view.original)}</p>
                  {translation && (
                    <p className="tapp-small" style={{ margin: ".6rem 0 0" }}>
                      <a href={translation} target="_blank" rel="noreferrer">Translate to {LANGUAGES.find((entry) => entry.code === profile.language)?.name} with Google Translate</a>{" "}
                      <span className="tapp-muted">(machine translation; the ingredient text is sent to Google)</span>
                    </p>
                  )}
                </details>
              ) : <p className="tapp-small tapp-muted" style={{ marginTop: "1rem" }}>{report.generic ? `No ingredient list: this is a typical recipe (USDA “${report.generic.description}”), not a labelled product. Serving: ${report.servingSize ?? "100 g"}.` : "No ingredient list is published for this product."}</p>}
              <p className="tapp-small tapp-muted" style={{ marginTop: "1rem", marginBottom: 0 }}>Source: {report.sources.map((source, index) => <span key={source.name}>{index > 0 && " + "}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></span>)} · {new Date(report.checkedAt).toLocaleTimeString()}</p>
            </>
          )}
        </section>
      </div>

      {tab === "saved" && (
        <SavedLibrary
          saved={saved}
          profile={profile}
          onOpen={(scan) => show(scan.report, { photo: scan.thumb ? { thumb: scan.thumb, alternatives: [] } : null })}
          onDelete={(id) => setSaved((current) => current.filter((scan) => reportId(scan.report) !== id))}
          onNote={(id, note) => setSaved((current) => current.map((scan) => reportId(scan.report) === id ? { ...scan, note } : scan))}
          onClear={() => setSaved([])}
        />
      )}

      {tab === "scan" && history.length > 0 && (
        <section className="tapp-panel" style={{ marginTop: "1rem" }}>
          <div className="tapp-panel-head"><h2>Recent scans</h2></div>
          <div className="tapp-table-wrap"><table className="tapp-table">
            <thead><tr><th>Product</th><th>Barcode</th><th>Caffeine</th></tr></thead>
            <tbody>{history.map((item) => <tr key={item.barcode} className={`is-clickable${item.barcode === report?.barcode ? " is-selected" : ""}`} onClick={() => void lookup(item.barcode)}><td className="wrap">{item.name}</td><td>{item.barcode}</td><td>{fmt(item.caffeine, "mg")}</td></tr>)}</tbody>
          </table></div>
        </section>
      )}
      <footer className="tapp-footer"><span>Not medical advice. Product data is crowd-sourced and can be wrong or incomplete. Always check the printed label.</span></footer>
    </div>
  );
}
