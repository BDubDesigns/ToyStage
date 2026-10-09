import { BENCHMARK_MODELS } from "./benchmark-session";
import type { BenchmarkReport, BenchmarkUpdate } from "./benchmark-session";
import type { BenchmarkModel } from "./benchmark-joints";

export class BenchmarkPanel {
  private readonly section = document.getElementById("pose-benchmark")!;
  private readonly run = document.getElementById("benchmark-run") as HTMLButtonElement;
  private readonly stop = document.getElementById("benchmark-stop") as HTMLButtonElement;
  private readonly model = document.getElementById("benchmark-model") as HTMLSelectElement;
  private readonly output = document.getElementById("benchmark-output") as HTMLTextAreaElement;
  private readonly reports: BenchmarkReport[] = [];
  private readonly hud = document.getElementById("benchmark-hud")!;
  private available = false;

  constructor(private readonly start: (model: BenchmarkModel, update: (update: BenchmarkUpdate) => void) => void,
    private readonly cancel: (reason: string) => void) {
    this.run.addEventListener("click", () => {
      if (!this.available) return;
      this.run.disabled = true; this.stop.disabled = false;
      document.getElementById("benchmark-status")!.textContent = "Loading selected worker…";
      this.start(this.model.value as BenchmarkModel, this.update);
    });
    this.model.addEventListener("change", () => { this.cancel("Model selection changed."); this.hud.hidden = true; });
    this.stop.addEventListener("click", () => { this.cancel("Stopped by user; partial run."); this.hud.hidden = true; this.stop.disabled = true; this.run.disabled = !this.available; });
    document.getElementById("benchmark-copy")!.addEventListener("click", async () => {
      try {
        if (!navigator.clipboard) throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(this.output.value);
        document.getElementById("benchmark-copy-status")!.textContent = "Summary copied.";
      } catch { this.output.focus(); this.output.select(); document.getElementById("benchmark-copy-status")!.textContent = "Select and copy the summary below."; }
    });
    document.getElementById("benchmark-clear")!.addEventListener("click", () => { this.reports.length = 0; this.export(); });
    this.export();
  }

  setAvailable(pose: boolean, live: boolean): void {
    this.section.hidden = !pose;
    this.available = pose && live;
    this.run.disabled = !this.available;
    if (!this.available) { this.stop.disabled = true; this.hud.hidden = true; }
  }

  private update = (update: BenchmarkUpdate): void => {
    const { metrics, state } = update;
    this.section.dataset.state = state;
    this.hud.hidden = ["interrupted", "error", "unsupported"].includes(state);
    this.hud.textContent = `${update.model === "mediapipe" ? "A · Lite" : "B · Lightning"} · ${state}${update.remainingSeconds ? ` ${update.remainingSeconds}s` : ""}\n${metrics && metrics.measuredSeconds > 0 ? `${metrics.stageFps.toFixed(1)} stage FPS · ${metrics.freshSampleHz.toFixed(1)} fresh Hz\n${metrics.usablePoseHz.toFixed(1)} usable Hz · ${metrics.captureToUsableLandmarksMs.p95 ?? "—"} ms latency p95` : "Loading/warmup excluded"}`;
    document.getElementById("benchmark-status")!.textContent = `${BENCHMARK_MODELS[update.model].name} · ${state}${update.remainingSeconds ? ` · ${update.remainingSeconds}s remaining` : ""}${update.report ? ` · ${update.report.reason}` : ""}`;
    document.getElementById("benchmark-live")!.textContent = metrics && metrics.measuredSeconds > 0
      ? `${metrics.stageFps.toFixed(1)} stage FPS · ${metrics.freshSampleHz.toFixed(1)} fresh samples/s · ${metrics.usablePoseHz.toFixed(1)} usable poses/s · inference p50/p95 ${metrics.inferenceMs.p50 ?? "—"}/${metrics.inferenceMs.p95 ?? "—"} ms · usable latency p50/p95 ${metrics.captureToUsableLandmarksMs.p50 ?? "—"}/${metrics.captureToUsableLandmarksMs.p95 ?? "—"} ms · ${metrics.noUsablePoseSeconds}s without usable pose`
      : "Warmup/loading excluded. Keep your body in view. Cyan = left wrist, coral = right wrist, lime = nose.";
    if (update.report) {
      this.reports.push(update.report);
      if (this.reports.length > 4) this.reports.shift();
      this.run.disabled = !this.available;
      this.export();
    }
  };

  private export(): void {
    this.output.value = JSON.stringify({ schema: "ToyStage pose benchmark v1", physicalPixelResults: "PENDING owner hardware testing",
      recommendation: "PENDING Pixel hardware data", protocol: "10s warmup + 60s measured. Same view/settings. A/B or ABBA; cool between runs.",
      limits: "Availability/confidence are not accuracy ground truth. Capture clock starts at bitmap request, not sensor exposure. Shared 13 joints only; no toe/heel/finger detail. Raw overlay, no added smoothing/prediction; model-internal tracking differs. Candidate worker timing includes RGB preparation and model preprocessing. No game/strike comparison.",
      runs: this.reports }, null, 2);
  }
}
