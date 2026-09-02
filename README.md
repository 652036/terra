# TERRA

**A shared 3D planet for human–agent exploration, built natively for WebMCP.**

[![CI](https://github.com/652036/terra/actions/workflows/ci.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/ci.yml)
[![Deploy](https://github.com/652036/terra/actions/workflows/pages.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-75d6cb.svg)](LICENSE)

TERRA turns a browser page into an inspectable geographic briefing room. A person and an agent orbit the same globe, move the same day/night terminator, select the same stable place ids, drop the same pins, and build the same comparison board. WebMCP site tools can explore and stage a draft; finalizing the local briefing snapshot is reserved for a visible review control and explicit user confirmation.

> Same globe. Shared state. Human publish gate.

## How judges can verify native WebMCP (60 seconds)

1. **Browser.** Open <https://terra-globe.st2p8g4tkf.chatgpt.site/> in the ChatGPT in-app browser, or in Chrome 150+ with `chrome://flags/#enable-webmcp-testing` set to *Enabled* (relaunch). The page must be the top-level tab—TERRA disables native tools inside iframes.
2. **Badge.** The top-right pill should read **Native WebMCP · 13 tools**. (**Tool Lab** means the browser has no `modelContext`; see the fallback below.)
3. **Paste these prompts** into the agent, one at a time:
   - > Fly to Tokyo, compare it with Vancouver, measure their great-circle distance and initial bearing, set the visualization hour to 13:00 UTC, pin Tokyo as “Primary focus” and Vancouver as “Pacific counterpart,” and stage a concise briefing. Do not publish.
   - > Read the scene summary and tell me the revision, camera place, visualization hour, and how many pins, comparisons, and measurements exist. Then read the pins section and quote the first pin’s label.
   - > Undo your last change using the current revision, then confirm what was undone.
4. **Publish gate.** Click **Review & publish**, tick the acknowledgment, confirm. The badge drops to **4 tools** (read-only only); **Reopen scene** brings it back to **13 tools**. No tool can publish or reopen.
5. **Fallback path.** Without native WebMCP the **Tool Lab** panel runs the identical schemas and handlers: pick `terra_read_scene`, leave the input `{}`, press **Execute**—or run `await window.__terraWebMCP.executeTool('terra_read_scene', {})` in DevTools. The badge shows **Tool Lab · 13 tools** in that mode.

## The problem

A visual workspace is hostile to DOM guessing. City labels overlap. A camera has orientation and zoom. A screenshot cannot identify whether a glowing dot is Tokyo or `pin-tokyo`. Time and layer changes alter what the person sees without necessarily changing page text.

WebMCP gives the open page a structured, state-aware interface. Instead of automating coordinates or scraping pixels, an agent can call one bounded action and then verify the exact scene revision the person is watching.

## What the experience includes

- A real native WebGL sphere with an offline Earth texture, shader-driven daylight, night shading, atmosphere, and graticule.
- Pointer/touch orbit, wheel and two-finger pinch zoom, on-screen zoom and reset buttons, arrow-key and +/− camera control, catalog navigation, time control, and five visual layers.
- Stable pins, pairwise great-circle distance and bearing, multi-place comparison, staged briefing review, Markdown export, and bounded undo.
- One normalized scene shared by manual controls, WebMCP tools, rendering, persistence, and state receipts.
- Thirteen tools while drafting; exactly four read-only tools after a human publishes.
- No backend, model key, map-tile provider, analytics, runtime dependency, or external network call.

## Why this is WebMCP-native

The useful capability exists inside the live page: move a canvas camera, update visual layers, annotate what the person sees, and keep the result inspectable. A remote MCP server cannot by itself guarantee that its idea of “Tokyo at 13:00 UTC” matches the currently open globe.

TERRA registers the imperative tools directly on `document.modelContext`:

```js
await document.modelContext.registerTool({
  name: 'terra_fly_to',
  description: 'Move the shared 3D globe camera to one catalog place.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['placeId'],
    properties: {
      placeId: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[A-Za-z0-9][A-Za-z0-9 -]*$' },
      altitude: { type: 'number', minimum: 0.72, maximum: 1.55 },
    },
  },
  annotations: { readOnlyHint: false },
  execute: async ({ placeId, altitude }, { signal }) => {
    // Resolve id or city name, mutate the visible scene, render, and return a revisioned receipt.
  },
}, { signal: mutationController.signal });
```

Registrations are awaited and split into two groups, each owned by its own `AbortController`. The four read-only tools are registered once and stay registered for the life of the page; publishing aborts only the mutation controller, and reopening registers the nine mutation tools again. Installs are serialized so groups never interleave. Invocation cancellation is forwarded to handlers. If native WebMCP is unavailable, the visible Tool Lab runs the same schemas and handler functions for inspection—it is a fallback, not a simulated second implementation.

## Tool surface

Each tool has exactly one job, so there is no overlap for an agent to disambiguate: one catalog lookup, one comparison tool that also records a two-place distance, one reader, one exporter.

### Always available — 4 tools

| Tool | Visible job |
| --- | --- |
| `terra_read_scene` | Read a compact summary, page up to 8 records of pins, comparisons, measurements, or the staged draft, or fetch one complete record by id |
| `terra_find_places` | Return the whole trusted 12-place catalog, or filter it by id, city, country, climate, or note |
| `terra_export_markdown` | Read bounded Markdown chunks with an export id and continuation offset |
| `terra_focus_view` | Scroll one existing panel into the person’s viewport |

### Draft-only — 9 tools

| Tool | Visible job |
| --- | --- |
| `terra_fly_to` | Rotate the shared camera to a catalog place |
| `terra_drop_pin` | Add a labeled place pin |
| `terra_remove_pin` | Remove a pin by stable id; undo remains available |
| `terra_compare_places` | Compare 2–5 distinct places on the board; with exactly two, the great-circle distance and initial bearing also land in Measurements |
| `terra_set_time` | Move the 0–23 UTC hour (or a place’s local hour via `localTo`) that drives daylight and city lights |
| `terra_toggle_layer` | Toggle labels, lights, atmosphere, grid, or pins |
| `terra_stage_brief` | Put untrusted draft text into the human review panel |
| `terra_clear_staged_brief` | Clear that draft without publishing |
| `terra_undo_last_change` | Undo the current agent-authored change with an exact expected revision; never cross a newer user edit |

Tool parameters use strict JSON Schema: unknown properties are rejected; text, ids, arrays, numeric ranges, enums, and uniqueness are bounded. Place parameters validate loosely in the schema (letters, digits, spaces, hyphens) and strictly in code: `tokyo`, `Tokyo`, and `New York` all resolve, and an unknown value fails with the full list of valid ids. Every expected failure—unknown place or pin, pin limit, published lock, revision conflict—names the valid values or the next call to make. Tools use the current WebMCP `readOnlyHint` and `untrustedContentHint` annotations as appropriate. Native handlers return one direct object—there is no duplicated text/structured payload. `terra_read_scene` defaults to a compact summary; section pages carry up to 8 records with long notes previewed at 600 characters, and `{ section, id }` returns one complete record. Markdown export returns at most 2,000 characters per call. Continuations carry the same revision or export id so complete content remains retrievable without one oversized response.

## The local publish boundary

“Publish” in TERRA means freezing a reviewed local snapshot; it does not upload or share data. There is deliberately no publish, commit, finalize, confirm-dialog, or reopen tool.

1. The agent stages content in the visible review panel.
2. The person clicks **Review & publish**.
3. A modal summarizes the camera, time, pins, comparisons, measurements, and draft headline.
4. The final action stays disabled until the person checks a review acknowledgment.
5. Publishing freezes manual mutation controls, aborts the nine mutation registrations, and leaves the four read-only tools.
6. Reopening also remains a visible UI control and is absent from the site-tool surface.

This is a capability boundary in the registered WebMCP interface, not a prompt asking the agent to behave. It does not claim to block a separate, general-purpose browser automation system from operating visible page controls.

## Try the full workflow

Use the copyable prompt shown in the app:

> Fly to Tokyo, compare it with Vancouver, measure their great-circle distance and initial bearing, set the visualization hour to 13:00 UTC, pin Tokyo as “Primary focus” and Vancouver as “Pacific counterpart,” and stage a concise briefing. Do not publish.

The visualization hour is UTC: the sun is overhead at longitude (12 − hour) × 15°, so 13:00 UTC is 22:00 in Tokyo and the Pacific rim is dark. `terra_set_time` also accepts `localTo: "tokyo"` to convert a local hour for you.

Finish with the default `terra_read_scene` summary and compare its revision, camera, time, layers, and counts with the visible interface. Request a named section and follow `nextOffset` when complete record content is needed. Then use the human review dialog and verify that the WebMCP badge changes from **13 tools** to **4 tools**.

## Run locally

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/652036/terra.git
cd terra
npm ci
npm run dev
```

Open `http://127.0.0.1:4175`. The local dev server adds the same hardening headers that `netlify.toml` and `public/_headers` configure for Netlify-style hosts:

```text
Origin-Agent-Cluster: ?1
Permissions-Policy: tools=(self)
Content-Security-Policy: frame-ancestors 'none'
X-Frame-Options: DENY
```

None of these headers is required for WebMCP itself: in a top-level document the `tools` permissions-policy defaults to `self`, and TERRA additionally refuses to register native tools when it is embedded in a frame.

Use Chrome 150+ (or the ChatGPT in-app browser) with WebMCP enabled. TERRA reads `document.modelContext` and falls back to `navigator.modelContext`; when the browser fires `toolchange`, the badge follows `getTools().length`. In a browser without native support, open Tool Lab or use the console:

```js
window.__terraWebMCP.listTools();
await window.__terraWebMCP.executeTool('terra_read_scene', {});
window.__terraWebMCP.status();
```

## Verify and build

```bash
npm run verify   # static contract checks + automated test suite
npm run build    # dependency-free static output in dist/
```

`scripts/verify.mjs` derives the tool count and the always-on/mutation split from `src/app.js`, then checks that every doc mentions only real tool names and consistent counts. The 38 tests cover geographic calculations, UTC hour semantics and local-time conversion, place resolution and self-correcting error messages, far-hemisphere projection, sphere geometry and WebGL context loss/restore, schema rejection, direct Site-tool results, paged/previewed output with id lookup, Markdown export sections, state normalization, ISO timestamps, collision-safe ids, edit sessions, user-aware undo, awaited two-group native registration, iframe refusal, `navigator.modelContext` fallback, `toolchange` badge refresh, failure cleanup, and serialized reconnection. CI runs verification and builds the exact deployable artifact.

## Deployment

Production WebMCP URL: <https://terra-globe.st2p8g4tkf.chatgpt.site/>

`.openai/hosting.json` points ChatGPT Sites at `dist/`. ChatGPT Sites does not currently support custom response headers, so the production origin serves the static files as-is; WebMCP still works there because a top-level document gets `tools=self` by default, and the anti-embedding guard runs in the page itself. `netlify.toml` and `public/_headers` send the full header set on Netlify and compatible static hosts.

The included GitHub Pages workflow provides a convenient visual/PWA preview, but GitHub Pages does not honor a repository `_headers` file either. Use the production URL above for judging, and verify the top-right badge says **Native WebMCP**, not **Tool Lab**.

## Safety, privacy, and accessibility

- User-authored pin and briefing text is marked untrusted and rendered with escaping or `textContent`.
- `localStorage` input is normalized before use; invalid shapes, ids, ranges, and collection sizes are discarded or clamped.
- A restrictive CSP allows only local scripts, styles, images, connections, and workers.
- TERRA has no first-party backend, tracking, or telemetry. Draft persistence remains in `localStorage`; when a person or agent invokes a read/export site tool, the requested scene page is returned to that invoking agent.
- The responsive interface supports phone layouts, touch, keyboard camera controls, visible focus, live status, skip navigation, reduced motion, forced colors, and a WebGL fallback.

See [SECURITY.md](SECURITY.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full trust and lifecycle design.

## Challenge materials

- [Architecture and WebMCP lifecycle](docs/ARCHITECTURE.md)
- [Under-three-minute demo script](docs/DEMO_SCRIPT.md)
- [Devpost submission draft](docs/DEVPOST_SUBMISSION.md)
- [Security model](SECURITY.md)

TERRA is released under the [MIT License](LICENSE).
