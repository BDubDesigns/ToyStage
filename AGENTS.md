# AGENTS.md

This file is the working guide for coding agents contributing to ToyStage. Read it before making changes. Keep it concise, factual, and updated when repository commands, structure, architecture, or workflow conventions change.

## Project

ToyStage is a web-first experiment that lets children use real toys inside digital scenes.

The initial setup uses a camera pointed at a green-screen play area. ToyStage removes the green background in real time, composites the physical toys into a chosen digital scene, and later uses the keyed foreground as game input so virtual objects can react to real toy movement.

The first defining interaction is a virtual ball that can be hit by a physical toy or hand without requiring sensors in the toy or ML object recognition.

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

- Use WebGL2 for the live video compositor and chroma-key pipeline.
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

This repository is new. Do not invent commands, package-manager choices, directory conventions, or test tooling before they exist.

When issue #2 establishes the application stack, update this section with:

- package manager
- install command
- development command
- test command
- build command
- lint/type-check commands
- important top-level directories
- any browser/device test workflow that future agents need

Future agents should prefer the documented commands here instead of guessing.

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

The MVP does not require:

- ML toy recognition
- identifying specific dolls, hands, or body parts
- accounts
- multiplayer
- cloud video processing
- recording/upload features
- a scene marketplace
- a generalized creator platform

The green-screen foreground itself should provide enough information to prove the first interaction model.

## Keeping this file useful

Update this file when new work establishes durable facts future agents need to know. Do not turn it into a changelog, copy issue descriptions into it, or add speculative rules that the repository does not actually follow.
