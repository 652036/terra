# TERRA demo script

Target length: **2 minutes 40 seconds**. Record at 1080p with the browser at roughly 1440 × 900 in Chrome 150+ (or the ChatGPT in-app browser) with WebMCP enabled. Keep the WebMCP tool-call panel or ChatGPT in-app browser visible beside TERRA when possible.

## 0:00–0:18 — The problem

Show the live globe and orbit it once.

> “Maps and canvases are hard for agents to scrape: the camera is stateful, points overlap, and a screenshot cannot identify a pin. TERRA turns the visible planet into structured WebMCP actions, so a person and an agent work on exactly the same scene.”

Briefly point to the **Native WebMCP · 13 tools** status. Do not show Tool Lab as the primary integration if native WebMCP is available.

## 0:18–1:25 — One agent workflow

Give the agent this prompt:

> Fly to Tokyo, compare it with Vancouver, measure their great-circle distance and initial bearing, set the visualization hour to 13:00 UTC, pin Tokyo as “Primary focus” and Vancouver as “Pacific counterpart,” and stage a concise briefing. Do not publish.

As calls execute, keep the globe visible and narrate what changes:

1. `terra_fly_to` rotates the same 3D camera the person can drag.
2. `terra_compare_places` with two ids adds a comparison card and the great-circle measurement in one call.
3. `terra_set_time` moves the terminator and lights (hours are UTC; 13:00 UTC puts Tokyo at 22:00 local, on the night side).
4. Two `terra_drop_pin` calls add stable pin ids and visible rings.
5. `terra_stage_brief` displays untrusted draft text in the review panel.

## 1:25–1:45 — Verify shared state

Call `terra_read_scene` with its default summary and show its revision, camera, visualization hour, active layers, and collection counts beside the matching visible globe and panels. Briefly show that a section call returns a bounded page of records with `nextOffset` for continuation, and that `{ section: "pins", id }` returns one complete record.

> “Every mutation returns a visible-state receipt. There is no hidden agent state and no remote service.”

## 1:45–2:15 — Visible review gate

Open the available site-tool list and point out that it contains no publish, finalize, confirmation, or reopen capability. Then use the visible **Review & publish** control, but initially leave the review checkbox empty so the final button remains disabled. Check the box and publish.

Point to both changes:

- the status now says **4 tools**;
- manual scene mutations are disabled while inspection/export tools remain available.

> “Finalization is deliberately absent from the WebMCP surface. The exact snapshot stays in a visible review flow, explicit user confirmation completes it, and mutation registrations are aborted immediately.”

## 2:15–2:32 — Why WebMCP

Show a short code view of awaited `document.modelContext.registerTool` and the shared handler, then return to the app.

> “This is not DOM guessing over buttons. Thirteen strict, annotated tools expose camera, time, layers, pins, comparisons, measurements, undo, and review staging. TERRA is static, private by default, dependency-free, keyboard-accessible, and runnable offline.”

## 2:32–2:40 — Close

Return to the published globe and its **4 tools** badge.

> “WebMCP makes this visual workspace reliable for an agent while local finalization remains in an explicit, visible user review.”

## Recording checklist

- Native status is visible and reports 13 tools before publishing, 4 after.
- The browser console has no errors.
- At least one globe orbit or zoom is shown.
- Tool calls and corresponding visual mutations are both on screen.
- The human confirmation checkbox and disabled/enabled publish button are visible.
- Audio clearly explains what WebMCP enables.
- Final video is under three minutes and linked publicly from Devpost.
