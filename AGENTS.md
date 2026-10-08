# AGENTS.md

This file is the working guide for coding agents contributing to ToyStage. Read it before making changes. Keep it concise, factual, and updated when repository commands, structure, architecture, or workflow conventions change.

## Project

ToyStage is a web-first experiment that lets children use real toys inside digital scenes.

The initial setup uses a camera pointed at a green-screen play area. ToyStage removes the green background in real time, composites the physical toys into a chosen digital scene, and later uses the keyed foreground as game input so virtual objects can react to real toy movement.

The first defining interaction is a virtual ball that can be hit by a physical toy or hand without requiring sensors in the toy or ML object recognition.

Pose Mode is a separate local body-tracking view in the same app: one person drives a digital stick figure without a green screen or visible camera footage. It currently has no ball/gesture/game interactions.

See GitHub issue #1 for the current MVP roadmap and implementation order.

## Product principles

- Keep camera processing local to the device by default.
- Do not upload, record, retain, or transmit camera footage unless a future feature explicitly requires it and the product direction is updated.
- The core experience should not require a backend or paid cloud service.
- Build for modern browsers first.
- Treat mobile as a primary target, not an afterthought.
- Prefer simple, inspectable systems over unnecessary ML or computer-vision dependencies.
- Keep the project approachable for eventual open-source use by other developer parents.

## Rendering and video architecture

These are current architectural invariants unless an issue explicitly changes them:

- Use WebGL2 for the Green-screen live video compositor and chroma-key pipeline. Pose has its own Canvas stage and worker; do not gate its camera acquisition on the main compositor's WebGL2 check.
- DOM and Canvas may be used for controls, diagnostics, debug overlays, and other UI where appropriate.
- Target a practical baseline of roughly 720p at 30 fps for the visible experience.
- Do not process the full-resolution camera image with a per-frame JavaScript pixel loop.
- Avoid full-frame CPU readback in the hot rendering path.
- Keep visual compositing separate from interaction sensing.
- Interaction/collision sensing should use a much smaller foreground mask, roughly 320×180 or lower as a starting point, subject to measurement.
- Game systems should work in stage-normalized coordinates rather than depending directly on camera pixel dimensions.
- Camera orientation, mirroring, cropping, and aspect handling should be explicit rather than accidental CSS behavior.

## Initial implementation sequence

The current planned sequence is:

1. #2 — Bootstrap the web app and live camera capture.
2. #3 — Build the WebGL2 compositor.
3. #4 — Add real-time chroma keying and calibration.
4. #5 — Add still and animated scene backgrounds.
5. #6 — Create the low-resolution foreground mask for interaction sensing.
6. #7 — Prototype a virtual ball that physical toys can hit.
7. #8 — Profile and harden for midrange mobile hardware.
8. #9 — Prepare parent-friendly open-source setup and privacy documentation.

Do not pull later-slice work into an earlier issue unless it is required to complete the current issue cleanly.

## Workflow

The initial repository bootstrap commit may land directly on `main`. After that:

- Do normal implementation work on feature branches rather than directly on `main`.
- Prefer branch names such as `feat/<short-description>`, `fix/<short-description>`, or an issue-number-based equivalent.
- Read the relevant GitHub issue before changing code.
- Keep changes scoped to the issue being worked.
- Open a pull request for review rather than merging implementation work directly.
- Do not merge a PR unless explicitly asked.
- Do not rewrite unrelated architecture while completing a scoped issue.
- If an implementation decision materially changes the architecture or workflow described here, update `AGENTS.md` in the same PR.

## Repository commands and structure

The app uses npm, Vite, and TypeScript.

- Install dependencies: `npm install`
- Start the development server: `npm run dev`
- Run unit tests: `npm test`
- Type-check and build: `npm run build`
- Preview a production build: `npm run preview`
- Production browser regression check: `npx playwright install chromium`, then `npm run test:browser` (synthetic input; see README for optional full-body fixture and browser path).

Application code lives in `src/`; `index.html` is the Vite entry point. Camera acquisition and capability checks live in `src/camera.ts`. Use a secure context (HTTPS, or localhost) for camera testing. The Pixel's manual camera check needs an HTTPS URL reachable from the phone.

Camera discovery and switching use `MediaDevices.enumerateDevices()` after permission is granted. The page retains one stream at a time: switching releases the old tracks, requests the selected device, and recreates the compositor with the new mirror state. Camera choices are session-only; labels may be absent or generic, so the UI gives those devices a stable order for that session. Key, scene, motion, and ball controls remain in page memory, while calibration and interaction history reset with renderer recreation. Do not infer camera hardware beyond browser-provided labels/settings or keep a second camera stream active.

`src/main.ts` remains the only `activeStream`/camera-session owner. Green-screen/Pose selection is page-memory state; switching modes disposes the old stage and reuses the exact stream. `src/pose/pose-controller.ts` owns the single 30 fps Pose render RAF and decoded-frame sampling (rVFC, or that same RAF fallback). `PoseTracker` offers one proportional ≤512-long-edge ImageBitmap at a time, capped at 18 Hz, including async capture in backpressure. A module `pose-worker.ts` runs pinned `@mediapipe/tasks-vision` 1.1.0 / Lite float16 v1 / CPU / one pose / segmentation off. Same-origin assets live in `public/pose/`; `scripts/verify-pose-assets.mjs` checks package agreement and checksums during build. Preserve package/WASM/model pins together. No pose module may request a camera, import games/balls, upload frames or run synchronous inference on the main thread.

Pose snapshots are deeply frozen: 33 ordered landmarks, raw unmirrored image coordinates/confidence, smoothed stage coordinates, derived per-joint reliability and pose usability, capture/completion/receive timestamps and stage-normalized velocities. Mapping uses `getCameraRect` with mirroring exactly once. Source timestamps are main `performance.now()` at bitmap capture start, not sensor exposure/media-time seconds; worker completion converts via time origins. Pose velocity units differ from ball shorter-edge units (see README). Missing confidence/occluded joints are inactive immediately; snapshots/history expire at 300 ms from capture. Resize, dimension change and visibility transitions invalidate history/results without freeing an outstanding frame slot early. A hidden Pose tab keeps its one worker loaded but stops all clocks/sampling and requires fresh input on resume. Stop/mode/device switch, worker failure and pagehide terminate the worker; late bitmap promises close locally. Unsupported/error states offer explicit retry, never main-thread inference fallback. `stick-figure-view.ts` draws only model-derived body geometry over a plain stage; actual camera pixels stay hidden.

The stage's visible output is `#stage-canvas`, owned by `src/compositor.ts`. The hidden video is only a local texture source. The compositor draws the selected built-in scene followed by an alpha-blended, aspect-contained keyed camera layer with a small inset. `src/chroma-key-shader.ts` owns brightness-normalized chromaticity keying, feathering, green despill, and the optional visual cutout check. `src/chroma-key.ts` owns defaults and calibration mapping; user-triggered calibration reads only one temporary 5×5 video patch and bypasses keying while choosing. Settings live only in memory. `src/compositor-layout.ts` owns stage-normalized fitting and the portrait/landscape 720p drawing-buffer budget. Browser-decoded video dimensions determine orientation; user-facing mirroring happens in the camera shader and is reversed for sampling. Rendering is capped at 30 fps and pauses when the document is hidden. `start()` allocates GPU resources/listeners, `stop()` releases them, and `dispose()` permanently ends that renderer instance. The visual cutout check is only a display mode and does not affect interaction occupancy.

Built-in backgrounds are defined in `src/scenes.ts`, with local optimized WebP stills in `public/scenes/` (1280×720 maximum). `src/scene-shader.ts` owns centered-cover still rendering and the lightweight Cosmic Cruise animation in the existing background pass. The compositor reuses one background texture on unit 1; camera texture stays on unit 0. Stills upload only when selected/recreated, never per frame. `SceneImages` lazily caches at most four built-in decoded stills; failed loads can retry. The picker in `src/main.ts` applies only the latest selection, keeps the old scene on loading/failure, and does not touch camera capture/key settings. Selected scene and motion toggle live in page memory across camera stop/start. Animation time pauses in hidden tabs and when Animate space is unchecked; motion defaults off for reduced-motion browsers. Keep new scene work simple and within the existing 30 fps/720p budget. Update README's scene workflow when changing assets or the catalog.

Interaction sensing lives in `src/foreground-sensor.ts` (a separate GPU mask pass) and `src/foreground-mask.ts` (CPU queries). The sensor reuses the uploaded camera texture, shared key-alpha/mapping GLSL, and exact visible camera rectangle. It reads only an aspect-matched mask bounded to 160×90 or 90×160, at up to 15 Hz on fresh video frames; no scene pixels enter this mask. `foregroundMask` on the compositor exposes occupancy, clipped region coverage, change, and approximate regional centroid velocity. Query coordinates cover the whole stage, with (0,0) at top-left and y increasing down; velocities use stage units/second. `timestamp` is null until fresh data and resets on stop, hidden tabs, calibration/key changes, resize, and video dimension changes. Consumers must check freshness before acting. Sensing can be disabled for baseline comparisons. The optional cyan overlay and tap probes are diagnostics only; enabling sensing does not require showing it. All data is transient and local. Stop/context loss releases the sensor program, texture and framebuffer. See README for API examples, limitations, and device checks.

Ball play lives in `src/ball.ts` (testable physics/contact), `src/ball-profiles.ts` (six built-in presets), and `src/ball-view.ts` (Canvas overlay and picker icons). The compositor's `onFrame` callback drives it in the existing 30 fps loop. Positions are stage-normalized; radius and velocities use the shorter stage edge for aspect-independent physics. The 8 Ball preserves the original no-gravity, all-sides bounds. Gravity profiles use the fitted camera's floor and side walls, with no ceiling: continue integrating above the stage. A top-stage-edge marker tracks x only while the entire ball is above the frame, and disappears when any part returns; it never changes physics. Ground support cancels gravity at rest and applies rolling drag; airborne drag allows the balloon's gentle terminal descent after strong upward hits. Preset sizes scale proportionally in narrow fitted cameras. Changing type clears velocity/contact and resets into reachable space. `ForegroundMask.contact` scans only ellipse-intersecting cells for coverage and centroid; regional `motion` estimates a hit vector. Consume each fresh sample once, seed initial occupancy after resets, and keep contact latched until two clear samples; sustained overlap must not repeatedly add impulses. The ball pauses on stale/disabled sensing, hidden tabs, placement and color picking. Turning off keying also pauses play. Layout changes and camera restart reset it, preserving the selected type. Placement takes precedence over diagnostic probes; calibration takes precedence over placement. Keep interaction estimates local and lightweight; this is not object tracking or rigid-body hand collision.

Production is served at `https://toystage.qcfailed.com` through GitHub Pages. `.github/workflows/pages.yml` deploys successful builds from `main`; see the README for the one-time Pages and DNS setup.

PR checks live in `.github/workflows/preview-build.yml`: Node 24, `npm ci`, tests, and a build of the immutable PR head, without deployment secrets. `.github/workflows/preview-publish.yml` uses `workflow_run` and trusted default-branch code to validate/repackage static artifacts, then publish same-repository PRs to the separate `toystage-previews` Cloudflare Direct Upload project. Never checkout PR code, run its scripts, or restore its cache in the publisher. The publisher's manual main trigger provisions only the empty project; the checks workflow's manual main trigger builds an existing open PR by number. See README for bootstrap steps, public preview links, and device acceptance. Run `node scripts/check-preview-workflows.mjs` when changing this pipeline. Production workflow/DNS and vanity preview domains are outside this pipeline's scope.

## Testing expectations

Testing strategy will evolve with the implementation, but every issue should verify the behavior it introduces.

For camera/rendering work, include real-browser manual verification where automation cannot prove the behavior. Early development hardware includes:

- a modern Android flagship phone
- a laptop with a discrete GPU

Do not treat those devices as the eventual minimum hardware requirement. Issue #8 exists to measure and improve midrange-device behavior after the core concept is proven.

When adding performance-sensitive code, measure before introducing complex optimization.

## Privacy and child-safety boundary

ToyStage is intended to be usable by families and may process live camera imagery of children.

Therefore:

- camera data stays local by default;
- do not add analytics that capture image/video content;
- do not add remote frame processing as a convenience shortcut;
- do not silently persist snapshots or recordings;
- make camera-permission behavior visible and understandable;
- treat any future feature that changes these assumptions as a product/privacy decision, not a routine implementation detail.

## Scope discipline

The Green-screen MVP does not require:

- ML toy recognition
- identifying specific dolls, hands, or body parts
- accounts
- multiplayer
- cloud video processing
- recording/upload features
- a scene marketplace
- a generalized creator platform

The green-screen foreground itself should provide enough information to prove the first interaction model. Pose Mode's body landmarks are an explicitly scoped exception to identifying body parts, isolated from foreground sensing and ball play.

## Keeping this file useful

Update this file when new work establishes durable facts future agents need to know. Do not turn it into a changelog, copy issue descriptions into it, or add speculative rules that the repository does not actually follow.
