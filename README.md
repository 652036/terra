# TERRA

**A shared 3D planet for human–agent exploration, built natively for WebMCP.**

[![CI](https://github.com/652036/terra/actions/workflows/ci.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/ci.yml)
[![Deploy](https://github.com/652036/terra/actions/workflows/pages.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-75d6cb.svg)](LICENSE)

TERRA turns a browser page into an inspectable geographic briefing room. A person and an agent orbit the same globe, move the same day/night terminator, select the same stable place ids, drop the same pins, and build the same comparison board. WebMCP site tools can explore and stage a draft; finalizing the local briefing snapshot is reserved for a visible review control and explicit user confirmation.

> Same globe. Shared state. Human publish gate.

## The problem

A visual workspace is hostile to DOM guessing. City labels overlap. A camera has orientation and zoom. A screenshot cannot identify whether a glowing dot is Tokyo or `pin-tokyo`. Time and layer changes alter what the person sees without necessarily changing page text.

WebMCP gives the open page a structured, state-aware interface. Instead of automating coordinates or scraping pixels, an agent can call one bounded action and then verify the exact scene revision the person is watching.

## What the experience includes

- A real native WebGL sphere with an offline Earth texture, shader-driven daylight, night shading, atmosphere, and graticule.
- Pointer/touch orbit, wheel zoom, arrow-key camera control, catalog navigation, time control, and five visual layers.
- Stable pins, pairwise great-circle distance and bearing, multi-place comparison, staged briefing review, Markdown export, and bounded undo.
- One normalized scene shared by manual controls, WebMCP tools, rendering, persistence, and state receipts.
- Fifteen tools while drafting; exactly five inspection/navigation tools after a human publishes.
- No backend, model key, map-tile provider, analytics, runtime dependency, or external network call.

## Why this is WebMCP-native

The useful capability exists inside the live page: move a canvas camera, update visual layers, annotate what the person sees, and keep the result inspectable. A remote MCP server cannot by itself guarantee that its idea of “Tokyo at 22:00” matches the currently open globe.

TERRA registers the imperative tools directly on `document.modelContext`:

```js
await document.modelContext.registerTool({
  name: 'terra_fly_to',
  description: 'Move the shared 3D globe camera to one catalog place.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['placeId'],
    properties: { placeId: { type: 'string', pattern: '^[a-z0-9-]+$' } },
  },
  annotations: { readOnlyHint: false },
  execute: async ({ placeId }, { signal }) => {
    // Validate, mutate the visible scene, render, and return a revisioned receipt.
  },
}, { signal: registrationController.signal });
```

Registrations are awaited. Every registration set shares an `AbortSignal`; publishing or reconnecting aborts the old set before the new set is installed. Invocation cancellation is forwarded to handlers. If native WebMCP is unavailable, the visible Tool Lab runs the same schemas and handler functions for inspection—it is a fallback, not a simulated second implementation.

## Tool surface

### Always available — 5 tools

| Tool | Visible job |
| --- | --- |
| `terra_read_scene` | Read a compact summary, then page complete pins, comparisons, measurements, or staged draft by stable revision |
| `terra_list_places` | Page through the trusted local catalog and stable ids |
| `terra_search_place` | Search by id, city, country, climate, or note |
| `terra_export_markdown` | Read bounded Markdown chunks with an export id and continuation offset |
| `terra_focus_view` | Bring one existing panel into the person’s viewport |

### Draft-only — 10 tools

| Tool | Visible job |
| --- | --- |
| `terra_fly_to` | Rotate the shared camera to a catalog place |
| `terra_drop_pin` | Add a labeled place pin |
| `terra_remove_pin` | Remove a pin by stable id; undo remains available |
| `terra_compare_places` | Compare 2–5 distinct places on the board |
| `terra_measure_distance` | Add a great-circle distance and initial bearing |
| `terra_set_time` | Move the 0–23 hour daylight and city-light state |
| `terra_toggle_layer` | Toggle labels, lights, atmosphere, grid, or pins |
| `terra_stage_brief` | Put untrusted draft text into the human review panel |
| `terra_clear_staged_brief` | Clear that draft without publishing |
| `terra_undo_last_change` | Undo the current agent-authored change with an exact expected revision; never cross a newer user edit |

Tool parameters use strict JSON Schema: unknown properties are rejected; text, ids, arrays, numeric ranges, enums, and uniqueness are bounded. Tools use the current WebMCP `readOnlyHint` and `untrustedContentHint` annotations as appropriate. Native handlers return one direct object—there is no duplicated text/structured payload. `terra_read_scene` defaults to a compact summary and pages at most one full record; Markdown export returns at most 2,000 characters per call. Continuations carry the same revision or export id so complete content remains retrievable without one oversized response.

## The local publish boundary

“Publish” in TERRA means freezing a reviewed local snapshot; it does not upload or share data. There is deliberately no `terra_publish`, commit, finalize, confirm-dialog, or reopen tool.

1. The agent stages content in the visible review panel.
2. The person clicks **Review & publish**.
3. A modal summarizes the camera, time, pins, comparisons, measurements, and draft headline.
4. The final action stays disabled until the person checks a review acknowledgment.
5. Publishing freezes manual mutation controls, aborts all ten mutation registrations, and leaves the five inspection tools.
6. Reopening also remains a visible UI control and is absent from the site-tool surface.

This is a capability boundary in the registered WebMCP interface, not a prompt asking the agent to behave. It does not claim to block a separate, general-purpose browser automation system from operating visible page controls.

## Try the full workflow

Use the copyable prompt shown in the app:

> Fly to Tokyo, compare it with Vancouver, measure their great-circle distance and initial bearing, set the visualization hour to 22:00, pin Tokyo as “Primary focus” and Vancouver as “Pacific counterpart,” and stage a concise briefing. Do not publish.

Finish with the default `terra_read_scene` summary and compare its revision, camera, time, layers, and counts with the visible interface. Request a named section and follow `nextOffset` when complete record content is needed. Then use the human review dialog and verify that the WebMCP badge changes from **15 tools** to **5 tools**.

## Run locally

Requirements: Node.js 22 or newer.

```bash
git clone https://github.com/652036/terra.git
cd terra
npm ci
npm run dev
```

Open `http://127.0.0.1:4175`. The local server explicitly sends the origin-isolation and permissions-policy headers used by the production deployment:

```text
Origin-Agent-Cluster: ?1
Permissions-Policy: tools=(self)
```

Use ChatGPT’s in-app browser or Chrome 149+ with WebMCP enabled. In a browser without native support, open Tool Lab or use the console:

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

Tests cover geographic calculations, far-hemisphere projection, sphere geometry, schema rejection, direct Site-tool results, bounded/paged output reconstruction, state normalization, collision-safe ids, user-aware undo, awaited native registration, failure cleanup, and AbortSignal-based reconnection. CI runs verification and builds the exact deployable artifact.

## Deployment

Production WebMCP URL: <https://terra-globe.st2p8g4tkf.chatgpt.site/>

The production configuration explicitly sends the two headers above. `netlify.toml` and `public/_headers` configure them for Netlify and compatible static hosts; `.openai/hosting.json` points ChatGPT Sites at `dist/`.

The included GitHub Pages workflow provides a convenient visual/PWA preview, but GitHub Pages does not honor a repository `_headers` file. Use the production URL above for judging, and verify the top-right badge says **Native WebMCP**, not **Tool Lab**.

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
