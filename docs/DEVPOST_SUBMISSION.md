# Devpost submission draft

## Project title

TERRA — a shared planet for people and agents

## Tagline

Explore one live 3D globe together; let site tools stage the briefing, and reserve finalization for visible user review.

## Inspiration

Agents can read a page, but visual workspaces remain ambiguous. On a globe, camera orientation changes meaning, day and night change what is visible, labels overlap, and a screenshot cannot tell an agent whether a marker is a city or a saved pin. We wanted to test a more ambitious WebMCP pattern than exposing a form: a stateful visual instrument where a person and an agent can genuinely share attention.

## What it does

TERRA is a cinematic, interactive 3D Earth for lightweight geographic briefings. A person can orbit and zoom the globe, change the visualization hour, toggle layers, choose cities, and inspect pins, comparisons, and great-circle measurements. An agent receives 15 structured WebMCP tools that operate on those exact controls and state.

The site tools can search the bundled place catalog, fly the camera, compare up to five places, calculate great-circle distance and initial bearing, move the day/night terminator, toggle layers, drop or remove pins, undo work, and stage a briefing. Every mutation is immediately visible and returns a revisioned state receipt. No WebMCP site tool can publish or finalize the local briefing snapshot. The visible review dialog requires explicit user confirmation; completing it unregisters all ten mutation tools while leaving five inspection/export tools available. “Publish” is a local reviewed-state lock, not an upload or public share.

## How we used WebMCP

TERRA uses the imperative `document.modelContext.registerTool` API because canvas and scene operations cannot be represented by declarative forms alone. It awaits every registration, passes `AbortSignal` through execution, and uses signal abortion for clean dynamic unregistration. Handlers return one direct object rather than duplicate text and structured payloads. Tool schemas reject unknown properties and bound ids, enums, arrays, text, and numeric values. Scene reads default to a compact summary, full records are revision-paged one at a time, and Markdown is exported in reconstructable chunks of at most 2,000 characters. The current WebMCP read-only and untrusted-content annotations describe the behavior for agents.

This is a WebMCP-native interaction, not a wrapper around an API: the tools are valuable only while the webpage and its human-visible globe are open. Tool calls and manual controls share one normalized scene object and one render path.

## How we built it

The app is dependency-free JavaScript, HTML, CSS, and native WebGL. A generated sphere mesh uses an offline equirectangular texture; shaders compute directional daylight, the night side, atmosphere, and an optional graticule. The HTML marker layer uses matching orthographic math and clips the far hemisphere. The app includes pointer/touch orbit, wheel and keyboard zoom, responsive/mobile layouts, persistent local drafts, bounded undo, CSP, and a CSS fallback.

No model key, map provider, analytics SDK, first-party backend, or runtime asset API is required. Drafts persist locally; requested read/export pages are provided to the invoking agent. Native WebMCP production headers are checked into the deployment configuration. A built-in Tool Lab invokes the same handlers for reviewers using a browser without experimental WebMCP.

## Challenges

The central challenge was keeping three things truthful at once: 3D projection, UI state, and the agent contract. A marker that remains visible on the back of the Earth or a tool response that reports stale camera state breaks the shared-workspace promise. We therefore use the same latitude/longitude camera model in both WebGL and HTML projection and return post-render receipts from every mutation.

The second challenge was tool lifecycle safety. `registerTool` is asynchronous, so a fire-and-forget loop can display a false native status and can race when permissions fail or the publish state changes. TERRA registers a set sequentially, awaits it, and aborts the entire set before installing the next one.

## Accomplishments

- A real interactive globe rather than a static map or CSS-only mock.
- Fifteen non-trivial tools spanning camera, temporal, layer, annotation, analytic, staging, export, focus, and undo workflows.
- A demonstrable review gate: 15 tools before publishing and exactly 5 afterward, with no publish capability in the WebMCP surface.
- Local-first rendering and draft storage with no secrets, first-party backend, or telemetry; only requested bounded pages are returned to the invoking agent.
- Automated output-bound, state-boundary, contract, geometry, validation, lifecycle, and calculation tests.
- Keyboard, mobile, reduced-motion, forced-colors, and WebGL-fallback support.

## What we learned

The strongest WebMCP tools do more than mirror buttons. Stable ids, bounded schemas, observable receipts, undo, and dynamic availability let an agent reason about a visual workspace without guessing. User-in-the-loop design is also clearer when the site-tool boundary is structural: TERRA does not ask a site tool to “please avoid publishing”; it never registers that capability.

## What’s next

TERRA’s local catalog proves the interaction model. Future versions could load user-selected GeoJSON, expose route and region overlays, support named briefing snapshots, and add collaborative links while preserving the same staging and human-publish boundary.

## Links to complete before submission

- Live WebMCP URL: https://terra-globe.st2p8g4tkf.chatgpt.site/
- Public repository: https://github.com/652036/terra
- Demo video (under 3 minutes): **ADD PUBLIC VIDEO URL**

## Testing instructions for judges

1. Open the live URL in ChatGPT’s in-app browser or Chrome 149+ with WebMCP enabled.
2. Confirm the top-right badge reports **Native WebMCP · 15 tools**.
3. Use the demo prompt displayed in the app.
4. Compare the default `terra_read_scene` summary with the visible globe and panels, then request one named section and follow `nextOffset`.
5. Click **Review & publish**, confirm the snapshot, and verify the tool count becomes **5**.
6. In any ordinary browser, use Tool Lab as a functional fallback; it calls the same tool schemas and handlers.
