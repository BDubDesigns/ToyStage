# ToyStage

ToyStage is a browser-based play stage for bringing physical toys into digital scenes. The live camera is rendered through WebGL 2 over a chosen built-in scene. Camera frames stay in the browser: the app does not upload, save, or record them.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- A modern browser with camera access and WebGL 2

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

In **Diagnostics → Interaction check**, enable **Show ball contact & motion** to see the ball's exact circular contact region, camera bounds, and larger dashed motion-estimation box. The circle is cyan when clear, pink during contact and gray while paused. A cyan arrow shows approximate toy motion; a brief pink arrow and ring show the last impulse. The text identifies the active profile, velocity (short-stage-edge units/second), grounded/airborne/above-stage state, overlap/change, toy speed, last impulse strength and hit count. The cyan mask overlay can be enabled separately. Ordinary taps still probe that mask; placement and calibration take priority.

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
