# Goa Together presentation and animation

The owner specified the Goa Together wordmark/sun, coastal illustration language and palette on 21 October 2026. Preserve #173F35, #245B49, #F7F4EB, #FFFEFA, #DE6C4E, #91AAA0, #E8D9B4 and #687C75. Existing DM Serif Display/DM Sans typography has local fallbacks. New destination artwork is original SVG; there are no remote photo URLs or paid image assets.

## Tubes reference and implementation choice

The supplied [Kevin Levron creator page](https://www.framer.com/@kevin-levron/) was read as the visual reference. The Framer component is a paid marketplace item and has not been purchased/copied. The official npm `threejs-components` archive version **0.0.30** (ISC metadata) was downloaded for source/API inspection only into ignored `.data/`. Its bundled `build/cursors/tubes1.min.js` exposes `{three,options,tubes,bloomPass,dispose}`. Source inspection found a renderer wrapper that registers resize/visibility handlers using `.bind(this)` and attempts removal using another `.bind(this)`, so those references differ. Its cursor initializer also forces minimum/maximum pixel ratio 2. These findings make direct adoption a poor fit for the owner's cleanup/performance requirements.

Instead the app uses an original module built on the installed **Three.js 0.186.1** API, with matching TypeScript definitions. No threejs-components code is copied or shipped, and no browser CDN loader is involved. Three.js is MIT licensed. The [renderer reference](https://threejs.org/docs/pages/WebGLRenderer.html) confirms `setPixelRatio`, `setSize`, `dispose`, `forceContextLoss` and animation lifecycle methods. Installed Next 16.4.2 lazy-loading/client-component guidance was read before implementation.

`TubesBackground` lazily imports the engine after visibility, motion, coarse-pointer, data-saver and hardware checks. Four original tapered mesh tubes use preallocated geometry buffers and capped 30fps rendering/DPR1.5. Pointer interpolation supplies momentum; background clicks rotate within the approved palette, while foreground links/buttons are ignored. The canvas cannot receive pointer events. A permanent original SVG fallback remains available without WebGL or while loading.

The wrapper owns matched listener references, media queries, IntersectionObserver, ResizeObserver and async generation cancellation for Strict Mode. The engine cancels RAF, disposes buffers/materials/renderer and releases its WebGL context. Offscreen/hidden scenes pause. Reduced motion, coarse pointers, low-powered hardware and data-saver connections keep the static composition. Context loss returns to the fallback. It is isolated to the marketing hero, away from authentication forms and dense planning controls.

## Stacking story

Five meaningful travel-story cards use CSS sticky positioning, controlled z-index and a small scale recession driven by one passive-scroll/RAF update. The last card exits with its containing section. Narrow screens and reduced motion use ordinary vertical cards. These are navigational story cards, not interactive itinerary controls or fake saved trips.

## Verification limits

TypeScript/build/source checks verify supported module signatures and inspect lifecycle ownership. They do not prove visual appearance, scroll smoothness, GPU compatibility or absence of runtime browser errors. The existing browser security-policy rejection must not be bypassed; rendered desktop/mobile/reduced-motion/context-loss/leak checks remain Not tested until an authorised browser surface is available or the owner supplies manual results.
