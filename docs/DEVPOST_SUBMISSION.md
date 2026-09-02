# Devpost submission draft

## Project title

TERRA — a shared planet for people and agents

## Tagline

Explore one live 3D globe together; let site tools stage the briefing, and reserve finalization for visible user review.

## Inspiration

Agents can read a page, but visual workspaces remain ambiguous. On a globe, camera orientation changes meaning, day and night change what is visible, labels overlap, and a screenshot cannot tell an agent whether a marker is a city or a saved pin. We wanted to test a more ambitious WebMCP pattern than exposing a form: a stateful visual instrument where a person and an agent can genuinely share attention.

## What it does

TERRA is a cinematic, interactive 3D Earth for lightweight geographic briefings. A person can orbit and zoom the globe, change the visualization hour, toggle layers, choose cities, and inspect pins, comparisons, and great-circle measurements. An agent receives 13 structured WebMCP tools that operate on those exact controls and state.

The site tools can search the bundled place catalog, fly the camera, compare up to five places (two places also yield the great-circle distance and initial bearing), move the day/night terminator in UTC or a place’s local time, toggle layers, drop or remove pins, undo work, and stage a briefing. Every mutation is immediately visible and returns a revisioned state receipt. No WebMCP site tool can publish or finalize the local briefing snapshot. The visible review dialog requires explicit user confirmation; completing it unregisters the nine mutation tools while leaving four read-only tools available. “Publish” is a local reviewed-state lock, not an upload or public share.

## How we used WebMCP

TERRA uses the imperative `document.modelContext.registerTool` API because canvas and scene operations cannot be represented by declarative forms alone. It awaits every registration, passes `AbortSignal` through execution, and uses signal abortion for clean dynamic unregistration. Handlers return one direct object rather than duplicate text and structured payloads. Tool schemas reject unknown properties and bound ids, enums, arrays, text, and numeric values. Scene reads default to a compact summary, records are revision-paged eight at a time with long text previewed and fetchable by id, and Markdown is exported in reconstructable chunks of at most 2,000 characters. The current WebMCP read-only and untrusted-content annotations describe the behavior for agents. Each tool has one job, so the surface has no overlapping lookups or geometry tools.

This is a WebMCP-native interaction, not a wrapper around an API: the tools are valuable only while the webpage and its human-visible globe are open. Tool calls and manual controls share one normalized scene object and one render path.

## How we built it

The app is dependency-free JavaScript, HTML, CSS, and native WebGL. A generated sphere mesh uses an offline equirectangular texture; shaders compute directional daylight, the night side, atmosphere, and an optional graticule. The HTML marker layer uses matching orthographic math and clips the far hemisphere. The app includes pointer/touch orbit, wheel and keyboard zoom, responsive/mobile layouts, persistent local drafts, bounded undo, CSP, and a CSS fallback.

No model key, map provider, analytics SDK, first-party backend, or runtime asset API is required. Drafts persist locally; requested read/export pages are provided to the invoking agent. Hardening headers are checked into `netlify.toml` and `public/_headers` for hosts that honor them, and an in-page frame guard keeps native tools top-level-only where headers cannot be set. A built-in Tool Lab invokes the same handlers for reviewers using a browser without experimental WebMCP.

## Challenges

The central challenge was keeping three things truthful at once: 3D projection, UI state, and the agent contract. A marker that remains visible on the back of the Earth or a tool response that reports stale camera state breaks the shared-workspace promise. We therefore use the same latitude/longitude camera model in both WebGL and HTML projection and return post-render receipts from every mutation.

The second challenge was tool lifecycle safety. `registerTool` is asynchronous, so a fire-and-forget loop can display a false native status and can race when permissions fail or the publish state changes. TERRA registers each group sequentially and awaits it, serializes installs, and on publish aborts only the mutation group’s controller while the read-only group stays registered.

## Accomplishments

- A real interactive globe rather than a static map or CSS-only mock.
- Thirteen non-trivial tools spanning camera, temporal, layer, annotation, analytic, staging, export, focus, and undo workflows.
- A demonstrable review gate: 13 tools before publishing and exactly 4 afterward, with no publish capability in the WebMCP surface.
- Local-first rendering and draft storage with no secrets, first-party backend, or telemetry; only requested bounded pages are returned to the invoking agent.
- 38 automated tests covering output bounds, state boundaries, tool contracts, geometry, validation, WebGL context loss, registration lifecycle, and geographic calculations, plus a static contract check that derives the tool count from source.
- Keyboard, mobile, reduced-motion, forced-colors, and WebGL-fallback support.

## What we learned

The strongest WebMCP tools do more than mirror buttons. Stable ids, bounded schemas, observable receipts, undo, and dynamic availability let an agent reason about a visual workspace without guessing. User-in-the-loop design is also clearer when the site-tool boundary is structural: TERRA does not ask a site tool to “please avoid publishing”; it never registers that capability.

## What’s next

TERRA’s local catalog proves the interaction model. Future versions could load user-selected GeoJSON, expose route and region overlays, support named briefing snapshots, and add collaborative links while preserving the same staging and human-publish boundary.

## Links to complete before submission

- Live WebMCP URL: https://terra-globe.st2p8g4tkf.chatgpt.site/
- Public repository: https://github.com/652036/terra
- Demo video (under 3 minutes): **TODO(video): paste the public YouTube/Vimeo URL here before submitting**

## Testing instructions for judges

1. Open the live URL in Chrome 150+ (or the ChatGPT in-app browser) with WebMCP enabled (`chrome://flags/#enable-webmcp-testing`), as a top-level tab.
2. Confirm the top-right badge reports **Native WebMCP · 13 tools**.
3. Use the demo prompt displayed in the app.
4. Compare the default `terra_read_scene` summary with the visible globe and panels, then request one named section and follow `nextOffset`.
5. Click **Review & publish**, confirm the snapshot, and verify the tool count becomes **4**.
6. In any ordinary browser, use Tool Lab as a functional fallback; it calls the same tool schemas and handlers.
