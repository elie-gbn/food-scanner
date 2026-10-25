"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { caffeineAmount, ReportView } from "@/components/ReportView";
import { SavedLibrary, type SavedScan } from "@/components/SavedLibrary";
import { ALLERGENS, type AllergenId } from "@/lib/allergens";
import { recognizeFood, type Guess } from "@/lib/recognize";
import type { FoodReport } from "@/lib/types";
import { useStored } from "@/lib/use-stored";

type Point = { x: number; y: number };
type Detected = { rawValue: string; cornerPoints: Point[] };
type Detector = { detect: (source: HTMLVideoElement) => Promise<Detected[]> };
type Candidate = { report: FoodReport | null; name: string; detail: string };
type View =
  | { kind: "empty" }
  | { kind: "results"; title: string; items: Candidate[]; image: string | null; warnings: string[] }
  | { kind: "report"; report: FoodReport; image: string | null; fromResults: boolean; alternatives?: Guess[] };

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
const EXAMPLES = [
  { query: "5449000000996", label: "Coca-Cola" },
  { query: "070847811169", label: "Monster" },
  { query: "3017620422003", label: "Nutella" },
  { query: "espresso", label: "espresso" },
  { query: "green tea", label: "green tea" },
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

export function FoodScanner() {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const detector = useRef<Detector | null>(null);
  const candidate = useRef<{ code: string; hits: number }>({ code: "", hits: 0 });
  const lastLookup = useRef("");

  const [tab, setTab] = useState<"scan" | "saved">("scan");
  const [cameraState, setCameraState] = useState<"idle" | "starting" | "live" | "error">("idle");
  const [cameraError, setCameraError] = useState("");
  const [engine, setEngine] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [box, setBox] = useState<{ points: Point[]; width: number; height: number } | null>(null);
  const [input, setInput] = useState("");
  const [view, setView] = useState<View>({ kind: "empty" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved, savedLoaded] = useStored<SavedScan[]>("labelens.saved", []);
  const [mine, setMine] = useStored<AllergenId[]>("labelens.allergens", []);
  const [showProfile, setShowProfile] = useState(false);
  const [lastResults, setLastResults] = useState<Extract<View, { kind: "results" }> | null>(null);

  const showReport = useCallback((report: FoodReport, image: string | null = null, fromResults = false) => {
    setView({ kind: "report", report, image, fromResults });
    setTab("scan");
  }, []);

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

  const lookupBarcode = useCallback((raw: string) => {
    const code = raw.replace(/\D/g, "");
    lastLookup.current = code;
    return run(`Looking up ${code}…`, async () => {
      const response = await fetch(`/api/food-scanner?barcode=${code}`);
      const result = await response.json() as FoodReport & { error?: string };
      if (!response.ok) throw new Error(`${code}: ${result.error ?? "Lookup failed."}`);
      showReport(result);
    });
  }, [run, showReport]);

  const search = useCallback((query: string) => run(`Searching “${query}”…`, async () => {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const result = await response.json() as { results?: FoodReport[]; warnings?: string[]; error?: string };
    if (!response.ok || !result.results) throw new Error(result.error ?? "Search failed.");
    if (!result.results.length) throw new Error(`No foods found for “${query}”.`);
    const next: Extract<View, { kind: "results" }> = {
      kind: "results",
      title: `Results for “${query}”`,
      image: null,
      warnings: result.warnings ?? [],
      items: result.results.map((report) => ({ report, name: report.name, detail: [report.brand, report.sources[0]?.name].filter(Boolean).join(" · ") })),
    };
    setLastResults(next);
    setView(next);
    setTab("scan");
  }), [run]);

  const showGuess = useCallback((guess: Guess, alternatives: Guess[], thumb: string | null, picked = false) => run(`Looking up ${guess.name}…`, async () => {
    const confidence = picked ? "picked" : guess.probability >= 0.7 ? "high" : guess.probability >= 0.35 ? "medium" : "low";
    const response = await fetch(`/api/identify?food=${encodeURIComponent(guess.name)}&confidence=${confidence}`);
    const result = await response.json() as FoodReport & { error?: string };
    if (!response.ok) throw new Error(result.error ?? "Lookup failed.");
    setLastResults(null);
    setView({ kind: "report", report: result, image: thumb, fromResults: false, alternatives: alternatives.filter((item) => item.name !== guess.name) });
    setTab("scan");
  }), [run]);

  /* Recognition runs entirely in the browser; only the recognized food's name goes to the server. */
  const identify = useCallback((image: HTMLImageElement | HTMLVideoElement, width: number, height: number) => run("Recognizing food…", async () => {
    const thumb = toJpeg(image, width, height, 240, 0.75);
    const blob = await (await fetch(toJpeg(image, width, height, 512))).blob();
    const { guesses, notFood } = await recognizeFood(blob, (percent) => setBusy(`Downloading the food model (one time, ~43 MB)… ${percent}%`));
    if (notFood || !guesses.length) throw new Error("No food recognized in that photo. Try getting closer, or search by name.");
    await showGuess(guesses[0], guesses, thumb);
  }), [run, showGuess]);

  function submit(value = input) {
    const text = value.trim();
    if (!text) return;
    setInput(text);
    if (/^\d[\d\s-]{6,}$/.test(text)) void lookupBarcode(text);
    else void search(text);
  }

  function captureFrame() {
    const element = video.current;
    if (!element?.videoWidth) return;
    void identify(element, element.videoWidth, element.videoHeight);
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
      setCameraError("This browser can't open the camera here (it needs HTTPS or localhost). You can still upload a photo, or type a barcode or food name.");
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
        const created = await createDetector();
        detector.current = created.detector;
        setEngine(created.native ? "Native BarcodeDetector" : "ZXing WebAssembly");
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
      setCameraError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in the browser's site settings, or upload a photo instead." : name === "NotFoundError" ? "No camera was found on this device. You can upload a photo instead." : `Could not start the camera${cause instanceof Error ? `: ${cause.message}` : "."}`);
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
            if (candidate.current.hits === 2 && code && code !== lastLookup.current) {
              navigator.vibrate?.(60);
              void lookupBarcode(code);
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
  }, [cameraState, lookupBarcode]);

  useEffect(() => () => stream.current?.getTracks().forEach((track) => track.stop()), []);

  const isSaved = (id: string) => saved.some((scan) => scan.report.id === id);
  function toggleSave(report: FoodReport, image: string | null) {
    setSaved((current) => current.some((scan) => scan.report.id === report.id)
      ? current.filter((scan) => scan.report.id !== report.id)
      : [{ report, savedAt: new Date().toISOString(), note: "", thumb: report.image ? null : image }, ...current]);
  }

  return (
    <div className="tapp">
      <header className="tapp-header">
        <span className="tapp-brand">
          <span className="tapp-brand-mark" aria-hidden="true">▦</span>
          <span>Labelens<small>FOOD SCANNER</small></span>
        </span>
        <nav className="tapp-tabs food-tabs" aria-label="Sections">
          <button className={tab === "scan" ? "is-active" : ""} onClick={() => setTab("scan")} aria-current={tab === "scan" ? "page" : undefined}>Scan</button>
          <button className={tab === "saved" ? "is-active" : ""} onClick={() => setTab("saved")} aria-current={tab === "saved" ? "page" : undefined}>Saved{savedLoaded && saved.length ? ` (${saved.length})` : ""}</button>
        </nav>
      </header>
      <div className="tapp-title">
        <p className="tapp-eyebrow">BARCODES · PHOTOS · NAME SEARCH · ALLERGENS</p>
        <h1>Caffeine &amp; nutrition scanner</h1>
        <p className="tapp-muted">Scan a barcode, snap a photo of any food, or search by name. Caffeine, nutrition, and allergens are looked up live and shown next to the camera.</p>
      </div>

      <section className="tapp-panel food-profile">
        <button className="food-profile-toggle" onClick={() => setShowProfile((open) => !open)} aria-expanded={showProfile}>
          <span><b>My allergens</b> <span className="tapp-muted tapp-small">{mine.length ? mine.map((id) => ALLERGENS.find((allergen) => allergen.id === id)?.label).join(", ") : "none set. Pick yours to get warnings"}</span></span>
          <span aria-hidden="true">{showProfile ? "▴" : "▾"}</span>
        </button>
        {showProfile && (
          <div className="food-chips" role="group" aria-label="My allergens">
            {ALLERGENS.map((allergen) => {
              const on = mine.includes(allergen.id);
              return <button key={allergen.id} className={`food-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setMine((current) => on ? current.filter((id) => id !== allergen.id) : [...current, allergen.id])}>{on ? "✓ " : ""}{allergen.label}</button>;
            })}
          </div>
        )}
      </section>

      <div className="food-layout" hidden={tab !== "scan"}>
        <section className="tapp-panel">
          <div className="tapp-panel-head">
            <h2>Camera</h2>
            <span className={`tapp-badge ${cameraState === "live" ? "ok" : cameraState === "error" ? "bad" : "info"}`}>{cameraState === "live" ? "SCANNING" : cameraState.toUpperCase()}</span>
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
            {busy && <div className="food-status">{busy}</div>}
          </div>
          <div className="tapp-row" style={{ marginTop: ".75rem" }}>
            {cameraState === "live" && <button className="tapp-btn tapp-btn-primary" onClick={captureFrame} disabled={!!busy}>◉ Identify food in frame</button>}
            <label className={`tapp-btn${cameraState === "live" ? "" : " tapp-btn-primary"}`} aria-disabled={!!busy}>
              ⇪ {cameraState === "live" ? "Upload" : "Photo of food"}
              <input type="file" accept="image/*" capture="environment" hidden disabled={!!busy} onChange={(event) => { void uploadPhoto(event.target.files?.[0]); event.target.value = ""; }} />
            </label>
            {cameraState === "live" && <button className="tapp-btn tapp-btn-sm" onClick={stopCamera}>Stop camera</button>}
            {devices.length > 1 && (
              <select className="tapp-input" style={{ flex: "1 1 10rem", padding: ".3rem .5rem" }} value={deviceId} onChange={(event) => { setDeviceId(event.target.value); void startCamera(event.target.value); }} aria-label="Camera">
                {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
              </select>
            )}
          </div>
          <p className="tapp-small tapp-muted" style={{ margin: ".5rem 0 0" }}>Barcodes are read automatically{engine ? ` (${engine})` : ""}. For fresh food, meals, or drinks without a label, use <b>Identify food</b> or upload a photo. Recognition runs on your device, free.</p>
          <form className="tapp-row" style={{ marginTop: ".75rem" }} onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <input className="tapp-input" style={{ flex: "1 1 12rem" }} value={input} onChange={(event) => setInput(event.target.value)} placeholder="Barcode or food name, e.g. “banana”" aria-label="Barcode or food name" autoComplete="off" enterKeyHint="search" />
            <button className="tapp-btn" type="submit" disabled={!!busy || !input.trim()}>Look up</button>
          </form>
          <div className="tapp-row tapp-small" style={{ marginTop: ".6rem" }}>
            <span className="tapp-muted">Try:</span>
            {EXAMPLES.map((example) => <button key={example.query} className="tapp-btn tapp-btn-sm" onClick={() => submit(example.query)} disabled={!!busy}>{example.label}</button>)}
          </div>
          {error && <div className="tapp-notice is-bad" style={{ marginTop: "1rem", marginBottom: 0 }}><span>✕</span><span>{error}</span></div>}
        </section>

        <section className="tapp-panel food-results" aria-live="polite" aria-busy={!!busy}>
          {view.kind === "empty" && (
            <div className="tapp-empty">
              <p style={{ fontSize: "2rem", margin: 0 }} aria-hidden="true">▦</p>
              <p>Scan a barcode, photograph a food, or search by name. Its caffeine, allergens, and nutrition will show up here.</p>
            </div>
          )}
          {view.kind === "results" && (
            <>
              <div className="tapp-panel-head"><h2>{view.title}</h2></div>
              {view.warnings.map((warning) => <div key={warning} className="tapp-notice is-warn"><span>!</span><span>{warning}</span></div>)}
              <ul className="food-candidates">
                {view.items.map((item, index) => (
                  <li key={`${item.report?.id ?? item.name}-${index}`}>
                    <button onClick={() => item.report && showReport(item.report, view.image, true)} disabled={!item.report}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote product photos and local data URLs */}
                      {(item.report?.image ?? view.image) && <img src={item.report?.image ?? view.image ?? ""} alt="" />}
                      <span style={{ minWidth: 0 }}>
                        <b>{item.name}</b>
                        <span className="tapp-small tapp-muted">{item.detail}</span>
                      </span>
                      {item.report && <span className="tapp-small food-candidate-mg">{caffeineAmount(item.report) !== null ? `${Math.round(caffeineAmount(item.report)!)} mg` : item.report.caffeine.per100 !== null ? `${Math.round(item.report.caffeine.per100)} mg/100` : ""}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {view.kind === "report" && (
            <ReportView
              report={view.report}
              image={view.image}
              mine={mine}
              saved={isSaved(view.report.id)}
              onSave={() => toggleSave(view.report, view.image)}
              onBack={view.fromResults && lastResults ? { label: "Back to results", action: () => setView(lastResults) } : undefined}
              alternatives={view.alternatives}
              onAlternative={(guess) => view.alternatives && void showGuess(guess, [...view.alternatives, { name: view.report.name, query: "", allergens: [], probability: 0 }], view.image, true)}
            />
          )}
        </section>
      </div>

      {tab === "saved" && (
        <SavedLibrary
          saved={saved}
          mine={mine}
          onOpen={(scan) => { setLastResults(null); showReport(scan.report, scan.thumb); }}
          onDelete={(id) => setSaved((current) => current.filter((scan) => scan.report.id !== id))}
          onNote={(id, note) => setSaved((current) => current.map((scan) => scan.report.id === id ? { ...scan, note } : scan))}
          onClear={() => setSaved([])}
        />
      )}

      <footer className="tapp-footer"><span>Labelens · live lookups from Open Food Facts and USDA FoodData Central</span><span>Data is crowd-sourced and photo results are estimates. Check the label when it matters.</span></footer>
    </div>
  );
}
