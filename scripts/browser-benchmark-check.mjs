// Real model/worker smoke + lifecycle checks with a synthetic Canvas camera.
// Optional POSE_FIXTURE supplies a local full-body image; it is never deployed.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 5195, origin = `http://127.0.0.1:${port}`;
const full = process.env.BENCHMARK_FULL === "1";
const fixture = process.env.POSE_FIXTURE ? await readFile(process.env.POSE_FIXTURE) : null;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: new URL("../", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
let browser;

function instrument() {
  window.probe = { workers: new Set(), maxOutstanding: 0, cameraRequests: 0, streams: [], results: [], hidden: false, scripted: false, frozen: false };
  Object.defineProperty(document, "hidden", { configurable: true, get: () => probe.hidden });
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    outstanding = 0;
    scriptURL = "";
    constructor(...args) {
      super(...args); this.scriptURL = String(args[0]); probe.workers.add(this);
      this.addEventListener("message", ({ data }) => {
        if (data.type === "result") {
          this.outstanding--;
          probe.results.push({ inferenceMs: data.inferenceMs, count: data.landmarks[0]?.length ?? 0, worker: String(args[0]) });
        }
      });
    }
    postMessage(message, ...args) {
      if (message.type === "frame") {
        this.outstanding++; probe.maxOutstanding = Math.max(probe.maxOutstanding, this.outstanding);
        // Scripted joints test the production UI/transport freshness path,
        // distinct from the real backend runs above.
        if (probe.scripted) {
          const candidate = String(this.scriptURL ?? "").includes("movenet");
          const count = candidate ? 17 : 33;
          message.bitmap.close();
          setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { type: "result", token: message.token,
            landmarks: [Array.from({ length: count }, (_, i) => ({ x: 0.25 + (i % 2) * 0.3, y: 0.25 + i / count * 0.5, visibility: 0.9 }))],
            inferenceMs: 15, completedAtEpoch: performance.timeOrigin + performance.now() } })), 20);
          return;
        }
      }
      return super.postMessage(message, ...args);
    }
    terminate() { probe.workers.delete(this); this.outstanding = 0; return super.terminate(); }
  };
  navigator.mediaDevices.enumerateDevices = async () => ["front", "rear"].map(id => ({ kind: "videoinput", deviceId: id, label: `${id} test camera` }));
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (probe.streams.some(stream => stream.getTracks().some(track => track.readyState === "live"))) throw new Error("Second simultaneous camera requested");
    probe.cameraRequests++;
    const front = constraints.video.deviceId?.exact !== "rear";
    const source = document.createElement("canvas"); source.width = front ? 720 : 1280; source.height = front ? 1280 : 720;
    const ctx = source.getContext("2d");
    let image;
    if (window.hasFixture) { image = new Image(); image.src = "/__fixture.jpg"; await image.decode(); }
    function paint() {
      if (probe.frozen) return;
      ctx.fillStyle = "#14cc1f"; ctx.fillRect(0, 0, source.width, source.height);
      if (image) {
        const scale = Math.min(source.width / image.width, source.height / image.height) * 0.9;
        ctx.drawImage(image, (source.width - image.width * scale) / 2, (source.height - image.height * scale) / 2, image.width * scale, image.height * scale);
      }
    }
    paint(); const timer = setInterval(paint, 1000 / 30);
    const stream = source.captureStream(30), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
    track.getSettings = () => ({ deviceId: front ? "front" : "rear", facingMode: front ? "user" : "environment" });
    track.stop = () => { clearInterval(timer); stop(); };
    probe.streams.push(stream); return stream;
  };
}

const workers = page => page.evaluate(() => probe.workers.size);
const reports = page => page.evaluate(() => JSON.parse(document.getElementById("benchmark-output").value).runs);
const status = page => page.locator("#benchmark-status").textContent();
async function run(page, model) {
  await page.locator("#benchmark-model").selectOption(model);
  const before = await page.evaluate(() => probe.results.length);
  await page.locator("#benchmark-run").click();
  await page.waitForFunction(() => ["warming", "measuring", "error", "unsupported"].includes(document.getElementById("pose-benchmark").dataset.state), null, { timeout: 35000 });
  assert.match(await status(page), /warming|measuring/, `Real backend failed: ${await status(page)}`);
  await page.waitForFunction(before => probe.results.length >= before + 3, before, { timeout: 15000 });
  assert.equal(await workers(page), 1);
  if (process.env.BENCHMARK_SCREENSHOT && model === "movenet") await page.screenshot({ path: process.env.BENCHMARK_SCREENSHOT, fullPage: true });
  if (full) {
    console.log(`${model}: real worker ready; measuring fixed window on synthetic camera.`);
    await page.waitForFunction(() => document.getElementById("pose-benchmark").dataset.state === "complete", null, { timeout: 75000 });
    const report = (await reports(page)).at(-1);
    assert.equal(report.status, "complete"); assert.equal(report.metrics.measuredSeconds, 60);
    assert(report.metrics.samples.received > 0);
    if (model === "mediapipe") assert(report.blockedNetworkRequests > 0, "Long run must prove delayed vendor telemetry is blocked locally");
    assert.equal(await workers(page), 0);
    console.log(JSON.stringify({ model, fixture: Boolean(fixture), report }));
  } else {
    // Quick smoke cancels an incomplete run; it never fabricates timing results.
    await page.locator("#benchmark-stop").click();
    assert.equal((await reports(page)).at(-1).status, "interrupted");
  }
}

try {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", data => { if (String(data).includes(origin)) resolve(); });
    server.on("exit", code => reject(new Error(`Preview exited: ${code}`)));
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1 });
  const requests = [], errors = [];
  page.on("request", request => requests.push({ url: request.url(), method: request.method() }));
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(instrument);
  if (fixture) { await page.route(`${origin}/__fixture.jpg`, route => route.fulfill({ body: fixture, contentType: "image/jpeg" })); await page.addInitScript(() => { window.hasFixture = true; }); }
  await page.goto(`${origin}/?pose-benchmark=1`);
  await page.locator("#mode-pose").click(); await page.locator("#camera-button").click();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Mobile controls must not overflow horizontally");
  await page.waitForFunction(() => document.getElementById("pose-worker-state").textContent.startsWith("ready"), null, { timeout: 35000 });
  await run(page, "mediapipe"); await run(page, "movenet");
  assert.equal(await page.evaluate(() => probe.cameraRequests), 1);
  assert.equal(await page.evaluate(() => probe.maxOutstanding), 1);
  assert(await page.evaluate(() => probe.results.some(result => result.worker.includes("movenet"))));
  if (fixture) assert(await page.evaluate(() => probe.results.some(result => result.count === 17)));

  // Hidden tabs, rotation, mode and device changes terminate benchmark work.
  await page.locator("#benchmark-run").click();
  await page.waitForFunction(() => document.getElementById("pose-benchmark").dataset.state === "warming", null, { timeout: 35000 });
  await page.evaluate(() => { probe.hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  assert.equal((await reports(page)).at(-1).status, "interrupted"); assert.equal(await workers(page), 0);
  const hiddenCount = await page.evaluate(() => probe.results.length);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => probe.results.length), hiddenCount, "Hidden benchmark must stop producing results");
  await page.evaluate(() => { probe.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => document.getElementById("pose-worker-state").textContent.startsWith("ready"), null, { timeout: 35000 });
  await page.locator("#benchmark-run").click(); await page.setViewportSize({ width: 915, height: 412 });
  await page.waitForFunction(() => JSON.parse(document.getElementById("benchmark-output").value).runs.at(-1).reason.includes("resized"));
  await page.locator("#benchmark-run").click(); await page.locator("#mode-green").click();
  assert.equal(await workers(page), 0); assert.equal(await page.evaluate(() => probe.cameraRequests), 1);
  assert.equal(await page.locator("#ball-picker button").count(), 6);
  await page.locator("#mode-pose").click(); await page.locator("#benchmark-run").click();
  await page.locator("#camera-select").selectOption("rear");
  await page.waitForFunction(() => probe.cameraRequests === 2);
  assert.equal((await reports(page)).at(-1).status, "interrupted");
  assert.equal(await page.evaluate(() => probe.streams.filter(stream => stream.getTracks().some(track => track.readyState === "live")).length), 1);

  // Asset/backend failure provides a concrete unsupported state; retry works.
  await page.route("**/movenet/model.json", route => route.abort());
  await page.locator("#benchmark-run").click();
  await page.waitForFunction(() => document.getElementById("pose-benchmark").dataset.state === "unsupported", null, { timeout: 35000 });
  assert.match((await reports(page)).at(-1).reason, /MoveNet worker unavailable/); assert.equal(await workers(page), 0);
  await page.unroute("**/movenet/model.json");
  await page.locator("#benchmark-run").click();
  await page.waitForFunction(() => document.getElementById("pose-benchmark").dataset.state === "warming", null, { timeout: 35000 });
  // Scripted keypoints exercise drawing and per-frame expiry through the real
  // transport/controller, separate from the real inference observations.
  await page.evaluate(() => { probe.scripted = true; });
  await page.waitForFunction(() => {
    const canvas = document.getElementById("pose-canvas"), data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] > 200 && data[i + 2] < 180) return true;
    return false;
  });
  await page.evaluate(() => { probe.frozen = true; });
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => {
    const canvas = document.getElementById("pose-canvas"), data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 170 && data[i + 1] > 200 && data[i + 2] < 180) return true;
    return false;
  }), false, "Expired joints must disappear when the camera stops producing frames");
  await page.evaluate(() => { probe.frozen = false; probe.scripted = false; });
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await workers(page), 0);
  assert.equal(await page.evaluate(() => probe.streams.filter(stream => stream.getTracks().some(track => track.readyState === "live")).length), 0);
  assert.deepEqual(errors, []);
  const unexpected = requests.filter(request => !request.url.startsWith(origin) || request.method !== "GET");
  assert.deepEqual(unexpected, [], "All benchmark requests must be same-origin GETs");
  await page.goto(origin); assert.equal(await page.locator("#pose-benchmark").isVisible(), false);
  console.log(JSON.stringify({ passed: true, fullMeasuredRuns: full, cameraInput: fixture ? "public full-body still in synthetic Canvas stream" : "blank synthetic Canvas stream", realBackends: ["MediaPipe CPU worker", "MoveNet WASM worker"], sameOriginGetOnly: true, physicalPixelResults: "PENDING" }));
} finally { await browser?.close(); server.kill(); }
