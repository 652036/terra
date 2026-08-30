# Security policy

TERRA is a static, local-first browser app. It does not call a model, map provider, analytics service, backend, or third-party runtime.

## Trust model

- Draft persistence stays in `localStorage`; TERRA has no first-party backend or telemetry. When a read/export site tool is invoked, the requested bounded scene page is returned to the invoking agent.
- Persisted data is treated as untrusted and normalized before rendering. Invalid ids and object shapes are dropped; numeric values and collection lengths are bounded.
- Every WebMCP input uses a strict JSON Schema with `additionalProperties: false` and is validated inside the app before execution.
- Pin labels, notes, and staged briefing text are untrusted content. Relevant tools carry `untrustedContentHint`; UI insertion uses escaping or `textContent`.
- Tool descriptions and output sizes are intentionally bounded. Scene reads default to a summary and page one record; Markdown export is chunked to at most 2,000 characters. Collection caps prevent unbounded scene or agent-context growth.

## Human-controlled publishing

TERRA exposes no WebMCP site tool that publishes, commits, finalizes, confirms the review dialog, or reopens a scene. Site tools may only stage draft content. Finalizing the local snapshot requires the visible summary dialog, review acknowledgment, and explicit user confirmation. This local status change does not upload or share scene data.

After publication, the app aborts the WebMCP registration controller that owns all 15 draft tools and installs only five inspection/navigation tools. Manual mutation controls are disabled. Reopening is also manual.

This is a boundary on the WebMCP/site-tool capability surface. It is not an authentication mechanism and does not claim to prevent a separate general-purpose computer-use system from operating visible browser controls.

## Browser and deployment controls

- The Content Security Policy disallows third-party scripts, objects, remote connections, and form exfiltration.
- Production configuration sends `Origin-Agent-Cluster: ?1`, `Permissions-Policy: tools=(self)`, `X-Content-Type-Options: nosniff`, a no-referrer policy, and same-origin resource policy.
- Tools are not exposed to any cross-origin frame through `exposedTo`.
- Native registration is awaited. Partial registration failures abort the complete set and fall back to the local Tool Lab.
- Registration replacement uses `AbortSignal`; invocation cancellation is forwarded to the handler.

## Reporting a vulnerability

Please open a private GitHub security advisory for the repository. Include reproduction steps, the affected browser and build, impact, and any suggested mitigation. Do not include sensitive personal scene content in a public issue.
