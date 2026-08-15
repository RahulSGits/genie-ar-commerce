# AR architecture

## The honest position

**AR does not work identically on every phone.** The product must never claim it
does. What a device can actually do is discovered at runtime, and the UI is
worded to match — this is a correctness requirement, not a nicety, because a
customer who taps "View in AR" and gets nothing blames the restaurant.

## The stack

`@google/model-viewer` is the primary 3D and AR surface. It is a web component
that resolves to the best real-AR path the device has:

| Path | Platform | Tracking | Needs |
| --- | --- | --- | --- |
| WebXR | Android Chrome/Edge | 6DoF, real planes | GLB + ARCore |
| Scene Viewer | Android | 6DoF, real planes | GLB at an absolute https URL + ARCore |
| AR Quick Look | iOS Safari | 6DoF, real planes | **USDZ** |
| 3D viewer | everything else | none — turntable | GLB |

Declared as `ar-modes="webxr scene-viewer quick-look"`. The first supported mode
wins.

**Why not hand-rolled Three.js for AR?** It cannot reach Quick Look. Quick Look
is an OS handoff triggered by an `<a rel="ar">` pointing at a USDZ — there is no
web API to drive ARKit from Safari. A custom renderer on iOS can only composite
over a `getUserMedia` feed with `deviceorientation`, which is 3DoF: the object
holds its bearing but cannot stay anchored as the user walks. That is a
materially worse experience being presented as the same thing.

Three.js is still used, but for what it is good at: generating the demo GLB
assets (`scripts/generate-demo-models.mjs`) and measuring geometry.

## `canActivateAR` is the authority

Not user-agent sniffing. `model-viewer` exposes `canActivateAR`, which accounts
for things the web cannot otherwise detect — whether ARCore is actually
installed, whether Quick Look will really launch. `ProductArExperience` reads it
on load and, when false, the info panel says plainly that AR is unavailable on
this device and the 3D viewer remains fully usable.

`lib/ar/capabilities.ts` still exists, but only for **analytics labelling** and
copy — never for deciding whether to offer AR.

## Real-world scale

glTF units are **metres by specification**. A correctly exported GLB is already
at true size, so the viewer runs `ar-scale="fixed"` and the object lands on the
table at its real dimensions.

The demo models are authored at true size — the pizza is 30.4 cm across, the
lounge chair 69 × 93.5 × 61.4 cm. The public page reads `getDimensions()` back
after load and displays it ("15 cm across"), which doubles as a check that a
newly uploaded asset was exported at a sane scale.

Products also store `dimWidth/Height/Depth + dimUnit`. These are authoritative
for the dashboard and for `lib/ar/loadModel.ts`, which normalises any GLB to
unit radius and rebuilds its scale from the declared dimensions — used where we
control the renderer directly.

## Placement modes

`config/terminology.ts` defines `tabletop | floor | wall | handheld`, defaulted
per business category. `model-viewer` only understands `floor` and `wall`, so
tabletop and handheld map onto `floor` — correct, since both rest on a detected
horizontal plane.

## The permission flow

Deliberately: **product + 3D on screen → user interacts → "View in your space"
→ camera permission**.

The camera is never requested on page load. A cold permission prompt before the
customer has seen anything gets denied, and a denied camera permission is sticky
in most browsers — you get one good ask.

## Marker AR (AR.js)

`@ar-js-org/ar.js` is installed and seamed at `lib/ar/markerAr.ts`, behind the
`marker_ar` feature flag, **deliberately not primary**.

Surface placement — "put this dish on my table" — is what model-viewer does
natively with real world tracking. AR.js solves a different problem: anchoring
content to a *specific printed image*, which unlocks campaigns model-viewer
cannot do (point at the printed menu and the dish rises off the page).

What is missing is the asset pipeline: each campaign needs a `.patt` marker or
NFT descriptor set generated from the printed artwork, which is a per-customer
onboarding step. `startMarkerArSession()` throws with that explanation rather
than pretending to work.

## Testing on real hardware

AR needs **HTTPS**. `npm run dev` over a LAN IP will correctly report AR as
unsupported, because browsers block the camera and WebXR on insecure origins.

Use `npm run dev:https` with a self-signed cert (see README) — this works on
Android Chrome after accepting the warning. **iOS Safari frequently still
refuses the camera behind a certificate warning**, so a trusted certificate is
required for a real iPhone test: deploy, or use `cloudflared tunnel --url
http://localhost:3000`.

For iPhone AR specifically you also need a **USDZ** on the product. Without one
the iPhone correctly falls back to the 3D viewer.

## Performance

- Device pixel ratio capped at 2 — full retina costs ~4× fill rate for no gain
  over a camera composite.
- Upload ceiling 25 MB, recommended under 5 MB; the uploader warns above it.
- Draco and Meshopt decoders are served from `/public/draco` — never a CDN, so
  the AR page has no third-party dependency and works under a strict CSP.
- `loading="eager"` on the product page (the model IS the content), lazy
  elsewhere.
