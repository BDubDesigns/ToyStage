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

Color comparison uses brightness-normalized RGB chromaticity in the GPU shader, rather than exact RGB matching. Calibration samples a temporary 5×5 patch from the source video only when you tap; it follows the same fit, orientation, and mirror mapping as the preview. There is no full-frame CPU keying or continuous pixel readback. Neither sampled pixels nor settings are persisted. Settings survive camera stop/start in the current page and reset on reload. The visual cutout check is not the future low-resolution interaction mask.

Known limitations: green toys or green clothing close to the blanket hue will also disappear. Near-black shadows, mixed-color lighting, motion blur, and glossy or transparent objects can produce noise, holes, or halos. Despill only reduces excess green near the key hue and cannot recover hidden object detail. Higher tolerance/softness can erode foreground edges. Better lighting and distance from the blanket help; this slice does not attempt professional matting or object recognition.

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

On desktop and Android, start the camera, grant permission, confirm that the live preview and diagnostics populate, then stop and start it again. Rotate and resize the viewport while the preview is active. Also verify that a denied permission can be recovered after allowing camera access in browser settings, and check the visible messages with no camera available and with another app holding the camera.

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
