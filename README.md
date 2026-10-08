# ToyStage

ToyStage is a browser-based play stage with two modes: **Green-screen** brings physical toys into digital scenes; **Pose** turns one person's movements into a digital stick figure without displaying their camera image. Camera frames stay in the browser: the app does not upload, save, or record them.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A modern browser with camera access. Green-screen needs WebGL 2; Pose needs module workers, ImageBitmap, worker OffscreenCanvas and WebAssembly SIMD.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access works on `localhost` and on HTTPS origins; browsers block camera access from ordinary HTTP sites. To test on a phone, use an HTTPS URL that the phone can reach.

## Checks

```sh
npm test
npm run build
npm run preview
```

The diagnostics panel reports the camera's decoded size, reported frame rate and device label, browser version, and WebGL 2 availability. It also shows measured rendered FPS, average frame interval, average CPU upload/draw submission time, drawing-buffer size, and mirror state. CPU submission time does **not** measure GPU execution time. Measurements update about once per second and reset when rendering resumes after switching tabs.

The rear camera is preferred where the browser supports facing-mode selection. User-facing previews are mirrored in the shader; environment-facing and unknown-facing previews are not. Video orientation comes from the browser's decoded `videoWidth`/`videoHeight`, including changes on rotation. The whole frame fits without cropping or stretching, inset over the selected scene. The green screen becomes transparent to reveal the scene.

After camera permission is granted, **Switch camera** cycles through available cameras and the **Camera** menu can select a particular device or lens. Browser-provided names are shown when available; otherwise devices use a simple session order. Switching releases the current stream before requesting its replacement, then rebuilds the renderer so mirroring, sizing, sensing, and diagnostics match the new camera. Scene, animation, ball-play, and chroma-key choices remain in page memory. Camera exposure and color can differ, so check the key and pick the blanket color again if needed; switching never changes that color automatically. If the new camera cannot start, ToyStage tries to reconnect to the previous camera and reports the failure.

The compositor targets 30 rendered frames per second, with a drawing buffer bounded to 1280×720 or 720×1280 depending on stage shape. It uploads from the hidden video directly into a GPU texture, without full-frame CPU readback. Rendering pauses in hidden tabs. Stop, camera failure, graphics-context loss, and page navigation release the stream and renderer resources; graphics-context loss displays a retry message.

## Pose Mode

Select **Pose**, then **Start camera**, or switch while the camera is live. Mode switching reuses the existing stream without another permission request. A mode switch resets interaction history; selected world, animation, key settings, sensing preferences and ball type stay in page memory. Green-screen controls are hidden and inactive during Pose Mode. The initial mode remains Green-screen.

Prop the phone securely at a height/angle that sees your head through your feet, leave space around your hands, and use even light. Start with one person facing the camera. Raise each arm, bend an elbow, crouch, lean and lift a knee. The figure follows measured body proportions, with cyan/coral limbs and a light torso/head. Missing or low-visibility segments disappear instead of pretending to be tracked. No usable body shows a friendly step-back message. Hands, feet and head can hit the virtual ball. There are no fist gestures, grabs, throws, scoring, face mesh, identity matching or multiplayer.

Pose uses the **same hidden decoded video** owned by the existing camera controller. The stage shows a minimal background, Canvas stick figure and shared ball overlay. It uses the same `getCameraRect` aspect-containment mapping and drawing-buffer budget as Green-screen. Front cameras mirror x once; anatomical left/right indices remain unchanged. Browser-decoded dimensions supply orientation. Portrait mobile Pose stages are taller to make full-body framing practical. Mode choice and settings reset on reload.

### Punch, kick and head the ball

The shared **Play ball**, six-type picker, **Reset ball** and **Place ball** controls work in Pose. Try 8 Ball first to practice directing hits without gravity; then Basketball for kicks and headers or Balloon for slower returns. Place a ball near a visible wrist, foot or head. Swing into it, pull away, and try again. Quicker incoming movement generally hits harder until the selected ball's speed limit. A held overlap produces no repeated acceleration. A moving ball can bounce off a still limb on a new approach. Contact is an impulse approximation: the ball does not rest on a hand or attach to your body.

**Ball check → Show ball contact & motion** draws circles at active wrists, ankle/toe centers and the head, plus the existing ball hit flash/arrows. Text reports the last body part, limb speed, applied strength and hit count. Missing/offscreen joints have no circles or contacts; the head matches the visible figure's shoulder-scaled nose circle. Feet fall back to the ankle when the toe is unreliable; changing that source seeds fresh history.

`src/pose-ball.ts` owns contact semantics independently of the tracker. Pose uses `Ball.advance(now)` and `Ball.applyImpulse(now, delta)` instead of Green-screen's mask `tick`; disabled keying/sensing does not disable Pose play. Positions and landmark velocities are converted by dividing x/y by `Ball.scaleX/scaleY`. Radii, displacement, speed and impulses then use **shorter-stage-edge units**, consistently across orientations and fitted camera rectangles. Five relative swept circles catch fast limb/ball crossings and use the first-entry normal for outward hits. Incoming relative normal speed determines strength (`0.16 + speed × 1.55`, capped at 3.2 before material scaling); the ball applies its profile hit scale, a delta cap of twice its maximum speed, and its final speed limit. The six integrator/material/boundary rules are unchanged, including no gravity ceiling and the above-stage indicator.

Tunable safety/feel constants are `POSE_CONTACT`:

| Setting | Value / units |
| --- | --- |
| Wrist / foot radius | 0.026 / 0.035 shorter edge |
| Head radius | Shoulder span × 0.23, clamped to 0.02–0.07 shorter edge; shared with drawing |
| Minimum incoming speed | 0.12 shorter edges/s |
| Rearm | Two samples beyond combined radii + 0.012 shorter edge |
| Per-limb cooldown | 140 ms; other limbs remain independent |
| Hit eligibility / comparable interval | ≤170 ms from capture / 16–260 ms between captures |
| Stored contact history | Up to 420 ms across render frames; only valid new captures can hit |
| Discontinuity guards | ≤0.4 shorter-edge displacement, ≤8 shorter edges/s, velocity agreement with snapshot |
| Gravity grace | Up to 300 ms since the last usable capture, then pause |

Capture timestamps, never drawing cadence, determine limb velocity; the smoother retains bounded velocities for ordinary 5–12 Hz (up to 260 ms) samples. Render-cadence ball position/velocity snapshots are interpolated at each pose capture timestamp, rather than comparing delayed limb positions with the present ball. Repeated/replayed samples do not hit again. Initial overlap and reacquisition seed contact; low-confidence joints, teleports, long sample intervals, hidden tabs and layout/camera/mode changes clear continuity. Gravity continues during brief inference misses while contact history is retained but stale frames cannot strike; genuinely absent/stale input pauses safely and resumes without a time jump. Reset, type change and placement clear history. Five small circle tests run per new capture in the existing 30 fps loop, with no camera readback, extra stream, physics dependency or additional render loop. Depth-only motion toward the camera is not a 2D strike unless its projected head/limb moves into the ball. The stick figure uses a render-only, bounded (≤110 ms / ≤0.08 stage-unit per axis) velocity projection with ~35 ms visual easing to soften 8 Hz stepping at 30 fps. The raw capture-timestamped positions remain the **only** collision source; missing/old joints are never extrapolated into hits. These changes have deterministic 5–12 Hz/70–120 ms regression fixtures, not real on-device proof. Physical-device feel and latency still require the checks below.

### Local model, browser support and cost

Inference uses pinned **`@mediapipe/tasks-vision` 1.1.0**, its matching native module WASM loader/binary and **Pose Landmarker Lite float16 v1**. All runtime assets are deployed under `public/pose/` on this site's origin; there are no CDN/model-server frame requests. Assets total **19,110,449 bytes (~18.23 MiB raw)**, including the 5,777,746-byte (~5.51 MiB) model bundle. Only starting Pose with a camera loads them; first use can take a moment, and normal HTTP caching can reuse the downloads. Model and runtime are Apache 2.0. Sources, license and SHA-256 hashes are documented in [public/pose/README.md](public/pose/README.md) / `assets.json`; builds verify checksums and agreement with the installed package.

`detectForVideo` is synchronous **inside a module worker**, with CPU delegate, one pose, and segmentation disabled. At most one frame is being captured or inferred. New decoded frames are offered through `requestVideoFrameCallback`, capped at 18 samples/s; fallback sampling checks changing `video.currentTime` in the single 30 fps Pose render loop. Busy/throttled frames are skipped rather than queued. `createImageBitmap` downsizes proportionally to a 512-pixel long edge without a JavaScript pixel loop. The worker closes transferred bitmaps in `finally`; late captures close locally after cancellation. No sampled frames, poses or camera settings are uploaded, recorded or persisted.

Modern Chrome/Edge is the initial baseline. Chromium 153 with software graphics was checked against the actual worker/model. Other browsers and the Pixel still need device verification. CPU inference still uses the upstream runtime's worker OffscreenCanvas/WebGL image preprocessing, so disabling GPU/browser features may prevent initialization. Pose camera acquisition is independent of the main stage's WebGL2 availability. Unsupported worker/WASM/model initialization shows **Retry Pose Mode** and keeps the camera available for Green-screen; there is no synchronous UI-thread fallback. A hidden tab stops sampling/rendering and clears pose history; its one current model worker stays loaded until stop or mode/device change. Stop, camera end/switch, mode switch, failure and pagehide terminate old workers and invalidate late work. Resize/decoded-dimension changes invalidate mapping/history while preserving the worker.

Lighting, occlusion, motion blur, side/back views and leaving the frame can reduce quality. Model confidence is an estimate, not proof of correct joints. Lite favors responsiveness over accuracy. If processing falls behind the 300 ms freshness threshold, the figure disappears until fresh input arrives. The 18 Hz sampling target is a cap, not a performance promise; inspect actual numbers on your device.

### Pose snapshot contract

`PoseTracker.snapshot(performance.now())` returns a deeply frozen `PoseFrame`, or `null` after **300 ms measured from capture start**. Empty inference returns `poses: []`; unreliable joints remain in the stable 33-index array with a reason and zero velocity. Consumers must check snapshot freshness before using any previously retained frame.

| Field | Semantics |
| --- | --- |
| `capturedAt` | Main `performance.now()` when bitmap capture starts on a new decoded frame. Sampling time, not sensor exposure time. |
| `mediaTime` | Original video's media timestamp in seconds; deduplication only, not a velocity clock. |
| `completedAt` | Worker inference-completion timestamp converted by worker `timeOrigin + now − main timeOrigin`. Same milliseconds clock as capture/receive. |
| `receivedAt` | Main `performance.now()` when the result arrives. |
| `inferenceMs`, `captureMs`, `roundTripMs` | Actual worker inference; async capture/downscale; send→receive wall time including inference, scheduling and transport. |
| `pose.state` | Derived `tracked` when all 12 primary body joints are reliable; `partial` with at least 2 torso anchors and 4 primary body joints; otherwise `unusable`. No fabricated model-level confidence. |
| `landmark.x/y` | Smoothed stage-normalized position: top-left `(0,0)`, y downward, mapping/mirror already applied; may fall outside `[0,1]`. |
| `landmark.raw` | Unmirrored image-space model x/y, optional model-relative z, visibility and presence where supplied; no world landmarks required. |
| `reliable`, `reliability` | Finite x/y, supplied finite visibility ≥0.5, and presence ≥0.5 when supplied. Reasons: invalid, missing-confidence, low-visibility, low-presence, reliable. |
| `vx/vy` | Recent **stage widths/heights per second** from capture timestamps. These differ from ball shorter-edge units; conversion is `vx * stageWidth / min(width,height)` and similarly for y. |

`JOINT` names all 33 MediaPipe indices; `BODY_CONNECTIONS` documents body-only drawing topology. Modest EMA smoothing uses a 45 ms time constant (75 ms for weaker reliable confidence). Velocity uses intervals 16–150 ms, suppresses >6 stage-units/s spikes and >0.25-stage displacement jumps, and seeds at zero after gaps, missing/occluded joints, mapping changes or reacquisition. Positions can still be smoothed through intervals up to 300 ms. There are no ball/game imports or camera requests inside the pose subsystem.

### Browser regression check

```sh
npx playwright install chromium
npm run test:browser
```

This builds and serves the production app on localhost with synthetic blank/toy Canvas streams. It verifies real worker initialization/inference, stream reuse, six-ball controls/settings, mirror/resize, no-person/staleness, hidden/resume, camera failure/recovery, model failure/retry, rapid toggles, stop/start, device end/pagehide, and starting Pose when main-canvas WebGL2 is unavailable. It also asserts one in-flight worker frame and same-origin GET-only traffic. A separate scripted-landmark page replaces only inference output while exercising the production tracker/smoother/UI/physics: all five body-part strikes, mask-independent play, stationary initial overlap, occlusion/reacquisition, stale/absent input, hidden/resume, portrait/front mirror, landscape/rear camera, placement/reset/type/off controls and mode/stream cleanup. This does not establish real-camera movement quality. For a person-detection check, pass `POSE_FIXTURE=/absolute/path/to/a/full-body-test.jpg`; Google's public test image is available at `https://storage.googleapis.com/mediapipe-assets/pose.jpg`. The fixture is read only for this local test and is not part of deployment. Optional `CHROMIUM_PATH` selects an existing browser, `POSE_MEASURE_SECONDS=30` lengthens each benchmark, and `POSE_SCREENSHOT=/absolute/path/pose.png` saves a synthetic mobile-stage screenshot. Unit tests cover contacts/sweeps, thresholds, cooldown/rearm, strength/material caps, coordinate/mirror scaling, tracking loss, exact physics parity, no-ceiling return/indicator, and existing mask behavior. `POSE_BALL_SCREENSHOT=/absolute/path/pose-ball.png` saves the scripted interaction stage.

### Pixel 10 Pro XL acceptance check

Use a production-like **HTTPS** preview reachable from the phone. This remains a real-device check; browser automation does not prove movement feel, thermals or phone performance.

1. Rear camera, full-body view: raise arms separately/together, bend elbows, walk side to side, squat, lean, lift each knee and slowly extend a leg. Check responsiveness, proportions and jitter.
2. Front camera: check horizontal mirror and arm identity. Switch rear/front, rotate portrait↔landscape, and check hands/feet alignment and fit.
3. Leave view, obscure a limb, then return. Expect missing segments/no-person feedback and clean reacquisition. Hide the tab for several seconds and return; no frozen figure or velocity jump.
4. Toggle Pose↔Green-screen while live; check scene/key choices, six ball types, toy hits and the above-frame arrow. Repeat stop/start; switch camera during inference and try a camera failure/recovery when practical.
5. Open **Diagnostics → Pose check**. Log at least 30 seconds each of Pose with a figure and Green-screen baseline, optionally no-person Pose: rendered fps/frame interval, actual sample Hz, inference average, capture/round-trip cost, pose age, perceived lag and thermal/battery observations. Aim for a smooth stage near 30 fps and 15–20 Hz inference if achievable. Report actual rates/tradeoffs; logging metrics does not mean recording footage.
6. Place 8 Ball near each hand: compare gentle and fast punches, hold an overlap, withdraw/re-strike, then alternate hands. Place near both feet for lifted-foot kicks, and beside the head for a lean/header. Enable **Ball check** if alignment is unclear. Repeat portrait/landscape and front/rear mirror, partially occlude limbs, leave/return, switch cameras and hide/resume. Expect clean rearming, no stale launches and stronger quick strikes within each material's limits.
7. Repeat with all six balls. Kick Basketball/Balloon upward, watch the top-edge arrow until they return, and verify floor/side-wall response. Check reset/place/off, then switch to Green-screen and verify toy/mask contact still works. Log observed play feel and motion-to-hit latency separately from synthetic browser results.

## Built-in scenes

Choose **Enchanted Forest**, **Lunar Outpost**, **Underwater Reef**, or **Starry Toyroom** with the thumbnail buttons below the stage. The supplied artwork is bundled locally; no remote scene service is required. **Cosmic Cruise** is an animated space world with a gently drifting nebula, twinkling stars, shooting stars, and a small visiting saucer. The saucer first appears about four seconds after selection and returns every 32 seconds. Shooting stars appear at staggered intervals. **Animate space** pauses all background motion while the live camera keeps running; motion defaults off when the browser requests reduced motion.

Selections and the motion preference survive camera stop/start within the current page, and reset on reload. Choosing a scene never requests camera permission again, restarts the stream, or changes key settings. While an image loads, the previous background remains visible. Rapid selections apply only the latest request; a failed asset keeps the previous world and offers a retry. Before the first image is available, Cosmic Cruise provides an asset-free fallback. Backgrounds use centered cover fitting: they fill any stage without stretching, cropping the sides on narrower stages. Camera fitting and calibration mapping remain unchanged.

### Scene asset workflow

The four stills in `public/scenes/` are optimized WebP conversions of Brandon's supplied images, at no more than 1280×720, about 710 KB total. `src/scenes.ts` is the small built-in catalog; asset URLs honor Vite's base path. For a replacement still, export an opaque WebP at this resolution, preserve the filename or update the catalog, and check both desktop and phone crops. Keep the main play area near the center so toys have room on narrow screens. The picker reuses these files as thumbnails. There are no uploads or editing tools.

`src/scene-shader.ts` renders either one sampled still or Cosmic Cruise in the existing background draw pass, before the keyed foreground. The still uploads only on selection (or renderer recreation), into one reused background texture. Image loads are cached lazily and bounded to the four stills, roughly 14 MiB of decoded RGBA pixels maximum, excluding browser thumbnail/GPU overhead. The animated world needs no video decoder, JavaScript pixel loops, CPU readback, or additional render loop. Its clock pauses in hidden tabs and when motion is disabled. The existing 30 fps and 720p drawing-buffer limits still apply. Stop/context loss/navigation release both GPU textures and programs.

## Green-screen setup

1. Light the blanket evenly and keep toys a little away from it to reduce reflected green.
2. Start the camera, select **Pick blanket color**, and tap a clear patch of blanket in the preview. The original camera image appears while picking, even if that area was already transparent. Tap inside the image rather than the surrounding scene border. Select **Cancel color pick** or press Escape to cancel. **Screen color** also allows manual, keyboard-accessible color selection.
3. Increase **Remove more blanket** for shadows and wrinkles; decrease it if parts of toys or hands disappear.
4. Adjust **Soften edges** to smooth the outline and **Reduce green fringe** to reduce green reflections.
5. **Check cutout** shows white foreground, black removed areas, and gray feathered edges. Uncheck **Remove screen** to compare with the original camera. **Reset settings** restores the key color, all sliders, and both checkboxes.

Color comparison uses brightness-normalized RGB chromaticity in the GPU shader, rather than exact RGB matching. Calibration samples a temporary 5×5 patch from the source video only when you tap; it follows the same fit, orientation, and mirror mapping as the preview. There is no full-frame CPU keying or continuous pixel readback. Neither sampled pixels nor settings are persisted. Settings survive camera stop/start in the current page and reset on reload. The visual cutout check is independent of the low-resolution interaction mask below.

Known limitations: green toys or green clothing close to the blanket hue will also disappear. Near-black shadows, mixed-color lighting, motion blur, and glossy or transparent objects can produce noise, holes, or halos. Despill only reduces excess green near the key hue and cannot recover hidden object detail. Higher tolerance/softness can erode foreground edges. Better lighting and distance from the blanket help; this slice does not attempt professional matting or object recognition.

## Foreground interaction sensing

In **Diagnostics → Interaction check**, **Sense foreground** runs by default. Enable **Show interaction mask** to overlay cyan cells on solid toys/hands; keyed blanket and the surrounding scene stay clear. Tap the stage to query a point and nearby region. **Check cutout** remains a separate visual keying aid. Turning off **Remove screen** intentionally makes the entire fitted camera region solid. Color picking temporarily suspends sensing; it resumes with the selected key settings.

The separate sensing pass uses the existing GPU camera texture and shares the visible shader's key-alpha and camera mapping. It never sees background scenes. A binary cutoff at 0.5 alpha excludes faint feathered edges. An aspect-matched render target is bounded to 160×90 (90×160 in portrait, 120×90 for a 4:3 stage), at most 14,400 pixels / 57,600 RGBA readback bytes per sample. Only this small buffer is read back, at up to 15 Hz on fresh video frames. The visible compositor still targets 30 fps; there is no second animation loop. `getMaskSize` accepts a smaller long-edge budget for future measured tuning.

This deliberately starts with synchronous limited readback. **Mask size / rate** and **Sensing / readback average** show measured sample frequency and time per sample, including CPU conversion. Readback time includes waiting for queued GPU work; CPU submission time now includes sensing on sampled frames. These are wall-clock timings, not a GPU timer query. Disable sensing to compare with the visual-only baseline. No PBO/fence pipeline or optical-flow dependency is warranted before measurements on actual devices.

### Game API

`WebGLCompositor.foregroundMask` exposes a `ForegroundMask`. Coordinates use the **whole stage**, including the empty border: x increases right, y increases down, `(0, 0)` is top-left and `(1, 1)` bottom-right. GPU row order is converted inside the tiny mask. Mirroring, camera orientation, letterboxing, inset and stage aspect match the visible camera. Region queries clip to the stage and return the fraction of intersecting mask cells that are occupied. `occupied` with a radius tests a square neighborhood in stage units.

```ts
const mask = compositor.foregroundMask;
// Avoid acting on uninitialized, paused or stale camera input.
if (mask.timestamp !== null && performance.now() - mask.timestamp < 250) {
  const hit = mask.occupied(0.5, 0.5, 0.02);
  const coverage = mask.coverage({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
  const motion = mask.motion({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 });
  // motion.changed: fraction of cells whose occupancy changed.
  // motion.velocity: approximate occupied-centroid displacement per second,
  //                 in stage units; null when either frame has <2 solid cells.
  // motion.intervalMs: 0 when no comparable recent frame exists.
}
```

`timestamp` is null until data arrives. Stop, hidden tabs, sensing off, calibration, key changes, stage resize and decoded video dimension changes clear occupancy/history. Motion comparison also drops gaps above 250 ms; restarting never creates a phantom hit. `pixels()` provides a caller-owned top-to-bottom binary copy only for debugging. Gameplay should use queries. The overlay copies cells only when shown; no frames or masks are stored, recorded, uploaded, or persisted.

Motion is intentionally approximate: centroid displacement can be biased by entry/exit, shape changes or multiple toys in a region. It is not optical flow or recognition. Static foreground has zero change; a wholly entering/exiting region has change but no usable velocity. Small/fast objects, thin edges, shadows and keying noise may be missed or fluctuate at this resolution/rate. Physical-device checks remain necessary.

## Toy-hit ball play

**Play ball** is on by default. Start the camera, key out the blanket, pick a ball, and move a toy or hand into it. The ball is drawn above the keyed foreground so it stays visible during overlap. Each picker card has its own recognizable design and a short hint. Selection resets position, velocity and contact history; the selected type stays in page memory across camera switching and stop/start.

| Type | What to expect |
| --- | --- |
| 8 Ball | The original no-gravity drift/roll, gradual stop and four-sided bounce. Best with a top-down camera. |
| Basketball | Strong floor bounces that get lower until it rests; lively side-wall bounce. |
| Bowling Ball | Heavy hit response, almost no floor bounce, dull walls and strong rolling resistance. |
| Super Ball | Small, quick and very springy; retains much more bounce energy. |
| Dodgeball | Bigger and softer, with moderate/high bounce and gentler hits. |
| Air-filled Balloon | Strong upward hits, air drag and a slow, gentle fall. Ordinary air, not helium. |

Gravity types collide with the fitted camera's floor and side walls, **never a ceiling**. They keep moving above the stage and return under gravity while camera input remains fresh. When the entire object leaves above the visible stage, an upward arrow with its miniature appears at the top stage edge, follows its horizontal position and stays inside the corners. It disappears as soon as part of the object returns. The arrow does not alter motion. Reset/Place can always bring an off-screen ball back. No recognition, scoring, recording or server dependency is added.

**Reset ball** returns it to the middle and clears velocity/hit count. **Place ball** lets you tap a reachable point inside the camera; the center is clamped away from the edges. Taps outside the camera are ignored. Tap **Cancel placement** or press Escape to cancel. Reset is also the keyboard-accessible way to reposition. Color picking cancels placement and temporarily hides/pauses the ball. Turning off **Play ball** hides it without stopping the camera or sensing; re-enabling starts fresh.

In **Ball check**, enable **Show ball contact & motion** to see the ball's exact circular contact region, camera bounds, and larger dashed motion-estimation box. The circle is cyan when clear, pink during contact and gray while paused. A cyan arrow shows approximate toy motion; a brief pink arrow and ring show the last impulse. The text identifies the active profile, velocity (short-stage-edge units/second), grounded/airborne/above-stage state, overlap/change, toy speed, last impulse strength and hit count. The cyan mask overlay can be enabled separately. Ordinary taps still probe that mask; placement and calibration take priority.

The game uses the existing 15 Hz low-resolution foreground mask. `ForegroundMask.contact(x, y, radiusX, radiusY)` scans only the ellipse's intersecting cells and returns occupied coverage and centroid. It excludes square-corner false positives and makes no mask copy. A larger local `motion` region estimates incoming movement, allowing faster swipes to produce stronger impulses up to a safe cap. If no comparable centroid exists, new occupancy gets a gentle push away from the contact centroid. A moving ball can also bounce against a stationary toy. This is an approximate impulse demo, not solid-body surface collision: it does not make a ball rest on a hand or track a particular toy.

Contact is processed once per new mask, with coverage thresholds, two clear samples before rearming, a short cooldown and bounded speed. Holding foreground over the ball does not repeatedly pump it. Initial overlap after placement/reset, calibration, resize or resume is seeded rather than counted as a strike. Physics pauses when input is uninitialized or older than 250 ms, when sensing or screen removal is disabled, during placement/calibration and in hidden tabs. Rotation resets the ball into the new fitted-camera bounds. A camera restart also resets it; changing scenes preserves play.

`src/ball-profiles.ts` defines the small data-driven preset catalog consumed by `src/ball.ts` and `src/ball-view.ts`'s Canvas overlay/picker icons. One shared integrator handles contained and gravity bounds, airborne drag, supported rolling, restitution, hit scaling, speed caps and settling. Resting floor support cancels gravity so settled objects do not jitter; an upward hit wakes them. Linear airborne drag gives the balloon a low terminal descent speed while permitting strong upward launches. The compositor calls `onFrame` after rendering/sensing, using its existing capped loop; no additional animation loop, GPU pass, camera readback, ML or dependency is added. The overlay shares the compositor's 720p drawing-buffer cap. Ball positions use stage coordinates, while radius and velocity are relative to the shorter stage edge so balls stay proportioned on portrait/landscape stages. Narrow fitted cameras scale all preset sizes together. Physics time steps are bounded and substepped for edge bounces.

### Ball device check

On the Pixel 10 Pro XL and laptop, after setting up the actual green screen:

- Nudge the ball with a doll/toy or hand, then swipe faster from each side and above/below. Expect repeatable motion in the swipe direction and generally stronger fast hits. If a toy crosses entirely between mask samples, it may be missed; use a larger toy or reposition the ball for the first play test.
- Hold a toy over the ball for several seconds, then withdraw and strike again. It should not continuously accelerate or jitter during the hold, and should rearm after separation. Reset/place inside a stationary toy: it should wait for separation instead of launching immediately.
- Compare all six types with gentle and hard hits. Basketball bounces should shrink until it rests; Bowling Ball should land almost dead and stop rolling quickly; Super Ball should keep bouncing far higher; Dodgeball should be larger and gentler. Settled objects should wake on another hit.
- Hit Basketball and Balloon hard upward and at an angle. Expect them to leave above the stage without a roof ricochet, keep moving horizontally, show the top-edge arrow while fully out of view and return naturally. Balloon should slow upward and float softly down. The arrow must vanish as soon as the object re-enters. Reset/Place should also retrieve an off-screen object.
- Watch the 8 Ball slow and bounce on every camera boundary. Gravity types have only floor/side-wall collisions. Try placement near the floor/edges, phone portrait/landscape, decoded-camera rotation and a mirrored front camera. Sizes should remain distinct and appropriately proportioned; placement stays within reach of the visible foreground.
- Turn on ball debug and the mask to diagnose wrong directions/noisy keying. Empty green blanket should not create hits. Shadows or leftover blanket may cause false positives; tune keying first. Regional centroids can be misleading with several objects, silhouette deformation or partial entry/exit; note these limitations during real play.
- Try reset/placement, calibration while placing, key/sensing off/on, hide/return, stop/start and context loss. Expect paused play or clean resets, no stale-input launch, and no lingering overlay after camera stop/failure. Switch worlds during a moving ball: camera capture and play should continue.
- Compare 30-second runs with **Play ball** off/on (debug off), then with debug on, in a still world and Cosmic Cruise. Record rendered FPS, submission time and sensing/readback cost. Target remains roughly 30 fps. Synthetic Chromium/SwiftShader camera tests establish behavior, alignment and cleanup, but do not prove physical-play feel or Pixel/laptop performance; those checks remain necessary before claiming device acceptance.

### Sensing device check

On the Pixel 10 Pro XL and laptop:

- Show the mask and move a toy/hand through the center and camera corners. Cyan should follow solid foreground; the empty blanket and scene border should stay clear. Tap both occupied and empty spots to check the query result.
- Try phone portrait/landscape, camera rotation and a mirrored front camera. Check that the overlay follows the visible foreground and that switching scenes does not change occupancy.
- Move a toy, then hold it still; changed coverage should rise during motion and settle near zero. Recalibrate, adjust tolerance/softness, toggle the cutout check, stop/start, hide/return, and simulate context loss. Expect no lingering overlay or false motion on resume.
- Compare **Sense foreground** off/on for 30 seconds each, with the overlay off, in both a still scene and Cosmic Cruise. Record rendered FPS, submission time, mask Hz and sensing/readback times. Repeat with the overlay on. The target is still about 30 rendered fps with no material drop when sensing runs. Software-browser measurements establish behavior and bound the readback, but do not establish actual phone/laptop performance.

## Deployment

Production site: [https://toystage.qcfailed.com](https://toystage.qcfailed.com)

The `.github/workflows/pages.yml` workflow runs tests and builds the app on every push to `main`, then deploys the `dist/` artifact to GitHub Pages. A failed test or build stops the workflow before deployment.

### One-time GitHub Pages setup

Before merging the deployment workflow, open **Settings → Pages** in `BDubDesigns/ToyStage` and:

1. Set **Build and deployment → Source** to **GitHub Actions**.
2. Enter `toystage.qcfailed.com` under **Custom domain** and save.
3. After GitHub verifies DNS and provisions the certificate, enable **Enforce HTTPS**.

### DNS record

At the DNS provider for `qcfailed.com`, create this record:

| Type | Host/name | Target |
| --- | --- | --- |
| CNAME | `toystage` | `bdubdesigns.github.io` |

The custom domain is configured in GitHub Pages settings. A repository-root `CNAME` file is not used for this Actions deployment.

### Cloudflare PR previews

PR previews use a **separate Cloudflare Pages Direct Upload project**, `toystage-previews`. They require no Cloudflare↔GitHub integration. Production continues to use the unchanged `pages.yml` GitHub Pages workflow and existing DNS above. The preview workflows do not deploy on pushes to `main`, change DNS, or publish to `toystage.qcfailed.com`.

The repository Actions secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are already configured by the owner. The token must have **Account → Cloudflare Pages → Edit** for the intended account. Their values belong only in Actions secrets; do not paste them into code, commands, PRs, or logs.

#### One-time provisioning and the existing PR #27

These steps become available **after this infrastructure PR is reviewed and merged**. The privileged `workflow_run` publisher and manual dispatches need their workflow files on the default branch. No preview project or live URL is established merely by adding the files.

1. Open the repository's **Actions → Publish Cloudflare PR preview → Run workflow**. Select **main** and run it once. This trigger checks the named project, creates it through the Pages API only if absent, and sets `main` as its production branch. It creates an **empty project** with no production deployment. Repeating this trigger reuses it. The job summary reports Cloudflare's actual assigned hostname; the proposed name/hostname has not been confirmed until this succeeds.
2. Open **Actions → ToyStage PR checks → Run workflow**. Select **main**, enter **27** for `pr_number`, and run. This resolves PR #27's current head SHA through GitHub, refuses closed/fork PRs or a non-main workflow, then checks out that exact commit. It needs no changes or pushes to #27's branch.
3. Watch **Test and build PR head** complete. A successful build automatically starts **Publish Cloudflare PR preview**. Check that its validation, publication, and HTTPS verification all succeed. The publisher updates one bot comment on #27 with the **actual returned stable branch alias and versioned deployment URL**; both are also in its summary. Do not infer readiness from a green build alone.

With GitHub CLI, the same post-merge steps are:

```sh
gh workflow run preview-publish.yml --repo BDubDesigns/ToyStage --ref main
# Wait for the provisioning run to succeed before starting the build.
gh workflow run preview-build.yml --repo BDubDesigns/ToyStage --ref main -f pr_number=27
```

Project creation checks availability in the configured account. Permission/name conflicts fail with an actionable error and do not create an alternative project or change existing configuration. An existing project must be Direct Upload, named `toystage-previews`, have production branch `main`, and have no custom domains. If the preview project is missing, automatic PR runs fail and direct you to the one-time provisioning trigger; they never create duplicate projects. No Cloudflare dashboard access is needed for the normal setup path.

Cloudflare may include the project's own assigned `pages.dev` hostname in `domains`; that exact hostname is allowed, while any other domain (including another `pages.dev` hostname) is rejected. Direct Upload's `source` may be omitted or `null`; source objects still fail validation. After successful creation the workflow refetches the named project and validates the canonical GET response. Logs distinguish creation from reuse and show each validation comparison plus domain counts, without credentials, account IDs, headers, or raw API fields. The summary says **Created** or **Reused** and prints the validated public hostname. A dashboard's empty project listing alone does not establish what the API returned.

If provisioning failed, **after the workflow fix is reviewed and merged, start a new Run workflow from main**. Re-running the old failed run uses its old commit/workflow. Check the new validation diagnostics and green summary before building #27. Existing projects are looked up and safely reused without deletion, recreation, or configuration changes; a failed post-creation refetch stops and directs you to a new lookup run. If a named validation check still fails, use its booleans/counts to investigate; do not paste credentials or the full Cloudflare response.

#### Subsequent PRs, security, and links

`preview-build.yml` runs on PR opened/synchronized/reopened events, including forks for checks. It uses Node 24, `npm ci`, `npm test`, and `npm run build`; failure blocks artifact publication. The checkout is the **PR head**, rather than GitHub's synthetic merge commit. Tests/builds use read permissions, no Cloudflare secrets, no persisted git credentials, and no dependency cache shared with publishing.

`preview-publish.yml` is a separate `workflow_run` workflow loaded from `main`. It authenticates the successful run, exact artifact, still-open same-repository PR, and current commit through GitHub APIs. Forks never receive privileged previews. A job without Cloudflare credentials downloads and validates the artifact, replaces `_headers` with trusted Pose MIME rules, and repackages it with a trusted uploader. The separate publisher consumes that artifact without checking out code, executing PR scripts, loading PR config/packages, or restoring PR caches. Its pinned Wrangler install runs in a new empty directory outside the static content. Only project verification/provisioning and the official pinned Wrangler action receive Cloudflare credentials. There is no `pull_request_target` execution path.

Publication uses `--branch pr-<number>`, which keeps each PR isolated. Cloudflare returns a stable alias like `pr-27.<actual-project-hostname>.pages.dev` and a versioned deployment URL. Subsequent pushes update that PR's alias; independent PRs use distinct concurrency groups. Build/publish concurrency cancels superseded work per PR, and the publisher rechecks the PR head before accessing Cloudflare. If GitHub supplies no PR association for an automatic run, publishing fails closed; rerun the checks manually from `main` for that PR.

**Preview URLs are public** and versioned deployments persist after another push or PR closure. Closing a PR prevents new publication but does not delete its existing previews or comment. Raw Actions artifacts expire after 7 days; validated handoff artifacts after 1 day. To recover a failed publication or expired artifact, rerun **ToyStage PR checks** from `main` for the PR's current head. There is no automatic Cloudflare cleanup in this slice. Camera frames remain local to the device; only built app files are uploaded by CI.

The static validator rejects links, executable Pages Functions (`functions/`, `_worker.js`), Wrangler/package config, redirects, hidden files, files over **25 MiB**, more than **20,000 files**, or previews exceeding the pipeline's **100 MiB** budget. Vite still uses `base: "/"`. PR #27's build reconstructs its checksum-verified WASM and includes the local model/worker assets in `dist/`: WASM is 12,997,272 bytes and the model is 5,777,746 bytes, below Pages' per-file limit. Preview-only `_headers` sets `.wasm` to `application/wasm` and `.task` to `application/octet-stream` at their existing `/pose/` paths. The final HTTPS check requests the canonical homepage at `/` (Cloudflare Pages redirects `/index.html` to `/`) and compares its bytes against built `index.html`. WASM/model assets are requested at their exact paths without redirects. All checks still require HTTP 200, the expected MIME type, and matching SHA-256 bytes on **both returned URLs**, so fallback HTML does not count as a working model. Failures report only safe categories (HTTP status, MIME mismatch, byte mismatch, or request/redirect error). A failed check leaves the deployment unannounced and fails the publisher.

Exact `pr-N.toystage.qcfailed.com` vanity domains and preview cleanup belong to a later issue, after `pages.dev` delivery is proven. This slice adds no custom domains, production routes, DNS records, or nameserver changes.

#### Workflow validation and Pixel acceptance

Local pipeline checks, with Node 24 and [actionlint](https://github.com/rhysd/actionlint) installed:

```sh
npm ci
npm test
npm run build
node scripts/check-preview-workflows.mjs
actionlint .github/workflows/preview-build.yml .github/workflows/preview-publish.yml
git diff --check
```

The dependency-free workflow checks exercise the actual inline scripts against fake API/filesystem data: malformed manual input, non-main dispatches, forks, stale/closed PRs, mismatched run/artifact identities, executable/config artifacts, links/size limits, provision/reuse/failure, and HTTPS MIME/byte failures. They never use real credentials. Local validation cannot prove Actions artifact transfer, account permissions, project availability, or a live Pages deployment; verify those from a real publisher run after merge.

For **Chrome on Pixel 10 Pro XL**, use the verified #27 preview and:

1. Grant camera permission on the HTTPS origin, select Pose, then raise/bend arms, squat, lean, step, and move knees/legs. Check alignment, responsiveness, and jitter; confirm in remote DevTools that `/pose/` model/WASM requests are same-origin, return real assets with the MIME types above, and no camera frames are transmitted.
2. Try front/rear cameras, portrait/landscape, device switching, leaving view/occluding a limb, and hiding/returning to the tab. Confirm mirroring and clean reacquisition.
3. Toggle Pose/Green-screen live and stop/start. Check green-screen key settings, scene changes, six-ball play, and continuous capture with one camera stream.
4. Run at least 30 seconds each of Pose and Green-screen; record render FPS, inference Hz/ms, perceived lag, and thermal/battery observations. Only physical-device testing establishes Pixel acceptance.

Official references: [CI Direct Upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [project setup](https://developers.cloudflare.com/pages/get-started/direct-upload/), [preview aliases](https://developers.cloudflare.com/pages/configuration/preview-deployments/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/), and [GitHub workflow_run](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

## Manual camera check

On desktop and Android, start the camera, grant permission, confirm that the live preview and diagnostics populate, then stop and start it again. When multiple cameras are available, switch between front and rear cameras and try the device menu, including distinct rear lenses where exposed. Confirm the user-facing preview mirrors, while the scene, key settings, ball-play toggle, and diagnostics remain correct. If practical, deny a selected-device request or disconnect a camera; verify that the previous camera is restored or that a clear **Try again** path appears. Rotate and resize the viewport while the preview is active. Also verify that a denied permission can be recovered after allowing camera access in browser settings, and check the visible messages with no camera available and with another app holding the camera.

For the compositor slice, also check:

- The scene stays visible around the camera; a round object stays round and all four camera edges remain visible in portrait and landscape.
- Text in the rear-camera image reads normally, the image stays upright after rotation, and a user-facing camera mirrors horizontally when the browser reports that facing mode.
- On the laptop and Pixel 10 Pro XL, leave the stage running for 30 seconds and record rendered FPS, frame interval, CPU submission time, camera size, and render size. The practical target is about 30 fps / 33 ms between rendered frames; slower cameras or device/browser load can reduce this. Synthetic browser checks cannot establish real-device performance.
- Stop/start several times, switch away and return, then navigate away and back. Camera-off state should hide the canvas and reset diagnostics; returning from a hidden tab should resume without stale timing spikes.
- To simulate context loss in desktop DevTools, run `document.querySelector('#stage-canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`. Expect a visible graphics error and camera release. To retry this deliberately forced loss, call the extension's `restoreContext()` first, then **Try again**.

For chroma keying, try a bright green center, shadowed/wrinkled green, a fast-moving toy, a hand near the screen, and a glossy toy reflecting green. Pick the blanket color, adjust each slider live, compare against the original camera, and inspect the cutout check. Verify soft edges and reduced fringing without making hands transparent. Pick colors near each camera corner in portrait/landscape and on a mirrored user-facing camera; the surrounding scene border must not be sampled. Reset during picking, stop/start, and stop during picking. Record visible limitations and device diagnostics after 30 seconds. Synthetic WebGL pixel checks establish shader behavior, but actual blanket/toy quality and mobile performance require these physical-device checks.

For scene backgrounds, also verify on the Pixel 10 Pro XL and laptop:

- Switch through every world while moving a toy. Capture must stay continuous, with the same key settings and correct foreground edges. Try rapid taps and revisit scenes.
- Inspect phone portrait, landscape, and desktop crops; artwork and the saucer should keep their proportions. Check that all scene buttons are easy to tap and the selected button has a visible border. Keyboard Tab/Enter/Space also work.
- Watch Cosmic Cruise for at least 40 seconds to see meteors and the saucer. Pause **Animate space**, adjust all key controls and pick a color, then resume. Check the reduced-motion default.
- Compare diagnostics after 30 seconds in a still and in Cosmic Cruise. Record FPS, frame interval, CPU submission time, and render size. Synthetic/software-browser tests cannot establish Pixel performance.
- Hide/return, stop/start, and simulate context loss. Confirm the selected world survives renderer recreation, animation pauses while hidden, and no stale camera/background remains after stopping.
