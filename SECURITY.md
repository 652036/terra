# Security

TERRA is a static browser app. It does not call a model, a map tile API, or a backend.

- State stays in `localStorage` unless the user exports Markdown.
- Tool inputs are validated against JSON Schema before they mutate the scene.
- User-authored pin notes and briefing text are treated as untrusted content in tool metadata.
- Publishing is a visible human control. No WebMCP tool can publish, commit, or finalize the scene.
- After publish, mutation tools are unregistered.
- A restrictive Content Security Policy forbids third-party scripts and network loads.
- The local development server sends `Origin-Agent-Cluster: ?1` and `Permissions-Policy: tools=(self)`.
