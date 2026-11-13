# BlackBox model version 1

The plugin uses `format: "codex-blackbox"`, `version: 1`. Version 0.2 of the
plugin preserves this contract and existing model IDs. Navigation and open
detail cards are viewer state; they do not alter the embedded project model.

```json
{
  "format": "codex-blackbox",
  "version": 1,
  "project": {"name": "Example", "summary": "What the system does.", "rootBox": "system"},
  "boxes": [{
    "id": "system", "label": "Example system", "kind": "system",
    "description": "Accepts a request and returns a result.",
    "process": "Validate the request and compute the result.",
    "children": ["validate"], "evidence": "observed",
    "provenance": "unknown", "decisionIds": [],
    "sources": [{"kind": "file", "path": "src/main.js", "line": 1}],
    "inputs": [{"name": "request", "type": "Request", "dataStructure": "request_type", "provenance": "unknown"}],
    "outputs": [{"name": "result", "type": "number", "provenance": "unknown"}]
  }, {
    "id": "validate", "label": "Validate request", "kind": "function",
    "description": "Rejects missing input.", "process": "Check required fields.",
    "children": [], "inputs": [], "outputs": [], "evidence": "observed",
    "provenance": "unknown", "sources": [{"kind": "file", "path": "src/main.js", "line": 2}],
    "implementation": {"path": "src/main.js", "symbol": "validate"}
  }],
  "dataStructures": [{
    "id": "request_type", "label": "Request", "description": "Submission payload.",
    "evidence": "documented", "provenance": "unknown", "sources": [],
    "fields": [{"name": "value", "type": "number", "provenance": "unknown", "decisionIds": []}]
  }],
  "edges": [], "decisions": [],
  "coverage": {"files": [{"path": "src/main.js", "status": "inspected"}]},
  "warnings": []
}
```

## Identities, behavior, and data

Entity IDs are nonempty strings unique across boxes and data structures. Use
existing BlackBox IDs, otherwise stable relative module paths plus symbols.
Decision IDs are unique within decisions. Do not renumber unchanged entities
when refreshing. `project.rootBox` points to a box.

Every box supplies `inputs`, `process`, `outputs`, and `children`. Ports have a
`name` and optional `type`, `dataStructure` (a structure ID), `description`,
`sources`, `evidence`, `provenance`, and `decisionIds`. An empty signature means
none documented, not that the function is proven to have no inputs or outputs.

Data structures have `fields` with `name`, `type`, and optional `description`,
`dataStructure` (an explicitly referenced structure), `sources`, `evidence`,
`provenance`, and `decisionIds`. Structure and box metadata use the same
`sources`, `evidence`, `provenance`, `decisionIds`, and optional recorded `state`.
Leaf `implementation` may contain `path`, `symbol`, `language`, and a short
escaped `code` excerpt; it is never executed.

Explicit edges use `source`, `target`, `type`, optional `label`, `evidence`,
and `sources`. Types include `calls`, `depends_on`, and `references`.
Containment comes from `children`; `consumes` and `produces` are derived from
signature references. Do not add calls just because one box contains another.
The viewer preserves unknown edge types and warns about missing endpoints.

Evidence values are `observed` (read directly in code), `documented`, `inferred`,
`proposed`, or `unknown`. Provenance values are `human_defined`, `ai_defined`,
`mixed`, and `unknown`. These two dimensions are independent.

## Sources and decision validation

File source paths must be relative to the inspected project, exist inside it,
and avoid private files. `line` is an optional verified 1-based integer, `symbol`
is optional, and `excerpt` must match the file exactly. To preserve explicit
BlackBox metadata, cite its actual declaration line, for example:

```json
{"kind":"file","path":"blackboxes/boxes/root.yaml","line":7,"recordedProvenance":"ai_defined"}
```

The line must literally declare the corresponding `provenance` value. A source
path pointing at ordinary code is not sufficient decision attribution.

Decisions use the following shape (references shown here must match actual
history imported with `--history`):

```json
{
  "id": "decision-storage",
  "summary": "Use an in-memory store for the prototype.",
  "origin": "ai_defined",
  "sources": [{"kind":"chat","threadId":"thread-1","turnId":"turn-1","itemId":"assistant-1","excerpt":"I propose an in-memory store for the prototype."}],
  "approval": {
    "status": "approved",
    "sources": [{"kind":"chat","threadId":"thread-1","turnId":"turn-2","itemId":"user-2","excerpt":"Yes, use the in-memory store."}]
  }
}
```

The helper verifies message IDs, roles, and exact excerpts; the authoring Codex
session must verify that their meaning supports the attribution. It cannot
automatically decide whether a historical sentence is a requirement, an unused
proposal, a rejection, or a superseded choice. User claims need user messages,
AI claims need assistant messages, mixed claims need both, or a matching
recorded provenance declaration. Approval statuses are `approved`, `rejected`,
and `unknown`, with verified user-message evidence required for the first two.
File-change items cannot support decision origin or approval.

Attach `decisionIds` to the box, port, structure, or field the choice actually
affects. Generated provenance is reconciled with those decisions. Explicit
recorded metadata stays intact. Children do not inherit a parent's provenance.
The renderer never converts approval into user origin. Raw transcripts stay in
scratch storage; only short necessary excerpts enter the final artifact.

## Coverage and rendering

Inventory is a separate helper-produced manifest of paths and SHA-256 hashes.
`coverage.files` records each eligible file as `inspected`, `unresolved`, or
`pending`, with an optional `note`. Missing records remain pending. Rendering
derives counts and completion against the manifest and current files. New,
changed, or missing files prevent a complete-coverage claim. No supplied
inventory means unverified coverage regardless of claimed input counts.

The helper adds normalized `history`, `coverage.counts`, `coverage.complete`,
`coverage.excluded`, `project.generatedAt`, and readable `warnings`. The
generated `model.json` and embedded HTML model agree exactly. Unknown ownership
is useful output; fabricated ownership is not.
