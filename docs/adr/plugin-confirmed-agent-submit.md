# ADR: Plugin-confirmed prompt submission

## Status

Proposed.

## Context

A work-panel plugin can gather text for an existing conversation. Its user
needs the ordinary send behavior, including admission to the native queue while
the target is busy, without disturbing the Composer draft.

## Decision

Expose the plugin-only desktop-control operation `agent/submit`. Reuse the
existing native consent dialog for each call and the same Agent Host admission
used by the Desktop queue. The operation accepts a local session ID, text and a
retry key. The host retains ownership of all other prompt fields. The external
MCP catalog excludes it.

## Consequences

An idle target can start immediately and a busy target receives a normal
queued user prompt. The plugin owns its preview, while Desktop owns consent,
admission, persistence and delivery. The renderer's draft remains independent.
