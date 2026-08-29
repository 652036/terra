# TERRA

**A cinematic Earth globe for human–agent exploration, built for WebMCP.**

TERRA turns a browser page into a shared planet. A person and an agent look at the same night-side lights, fly to the same city, drop the same pins, compare the same places, and stage the same briefing. The agent can explore. Only the human can publish.

> Same globe. Shared tools. Human publish gate.

[![CI](https://github.com/652036/terra/actions/workflows/ci.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/ci.yml)
[![Deploy](https://github.com/652036/terra/actions/workflows/pages.yml/badge.svg)](https://github.com/652036/terra/actions/workflows/pages.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-9bb8d4.svg)](LICENSE)

## Why this is a WebMCP app

A globe is a terrible thing to scrape. City labels overlap, the camera is stateful, day/night is a slider, and a screenshot cannot tell an agent which pin is `pin-tokyo`. WebMCP lets the site publish the actual actions:

```js
document.modelContext.registerTool({
  name: 'terra_fly_to',
  description: 'Fly the shared globe camera to a catalog place so the human can watch the same destination.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['placeId'], properties: { placeId: { type: 'string' } } },
  execute: async (input) => { /* update the visible camera */ },
});
```

- The agent receives stable place ids instead of guessing at dots.
- Every mutation updates the same globe the person is watching.
- Time, layers, pins, comparisons, and measurements stay inspectable.
- The agent may stage a briefing. There is no `terra_publish` tool.
- After a human publishes, mutation tools unregister.

## WebMCP tools

Always available:

| Tool | Purpose |
| --- | --- |
| `terra_read_scene` | Read camera, time, layers, pins, comparisons, and publish state |
| `terra_list_places` | List the built-in geographic catalog |
| `terra_search_place` | Search by city, country, climate, or note |
| `terra_export_markdown` | Export the briefing without publishing it |
| `terra_focus_view` | Bring a panel into the human viewport |

Available while the scene is unpublished:

| Tool | Purpose |
| --- | --- |
| `terra_fly_to` | Move the shared camera to a catalog place |
| `terra_drop_pin` / `terra_remove_pin` | Annotate the globe |
| `terra_compare_places` | Compare two or more cities on the board |
| `terra_measure_distance` | Great-circle distance and bearing |
| `terra_set_time` | Set the 0–23 visualization hour |
| `terra_toggle_layer` | Labels, city lights, atmosphere, grid, pins |
| `terra_stage_brief` / `terra_clear_staged_brief` | Prepare a human-reviewed briefing |
| `terra_undo_last_change` | Undo the latest reversible mutation |

There is deliberately no publish, commit, or finalize tool.

## Run locally

```bash
git clone https://github.com/652036/terra.git
cd terra
npm ci
npm run dev
```

Open `http://127.0.0.1:4175`.

The local server sends `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`. In Chrome, enable `chrome://flags/#enable-webmcp-testing`. In an ordinary browser, TERRA falls back to the built-in Tool Lab:

```js
window.__terraWebMCP.listTools();
await window.__terraWebMCP.executeTool('terra_read_scene', {});
window.__terraWebMCP.status();
```

## Verify and build

```bash
npm run verify
npm run build
```

## Challenge materials

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md)
- [`docs/DEVPOST_SUBMISSION.md`](docs/DEVPOST_SUBMISSION.md)
- [`SECURITY.md`](SECURITY.md)

## Deployment

Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** once.

Expected URL: `https://652036.github.io/terra/`

## License

MIT
