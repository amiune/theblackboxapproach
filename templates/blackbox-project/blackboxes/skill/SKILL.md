# BlackBoxApproach Skill

Use this skill only when the developer explicitly invokes BlackBoxApproach,
for example:

```text
/blackboxapproach
/skill blackboxapproach
@blackboxapproach
Use the blackboxapproach skill on this prompt: ...
```

A prompt that does not explicitly invoke the skill is not assumed to be governed
by these rules. This keeps the method portable across LLM environments and does
not depend on passive root-level instruction files.

## Mission

BlackBoxApproach helps developers design, refine, validate, and maintain
software systems through recursive black-box abstractions.

BlackBoxApproach is:

- recursive semantic refinement
- black-box-first development
- multi-layer abstraction engineering
- intent-driven architecture
- contract-aware decomposition
- provenance-aware system design

BlackBoxApproach is not natural-language programming, low-code, a diagramming
tool, or code generation only.

## Source Of Truth

Maintain `/blackboxes/` as the source of truth for the black-box architecture.
All required artifacts live inside that folder:

```text
/blackboxes/
    system.yaml
    /skill/
        SKILL.md
        examples.md
        prompt_templates.md
        rules.yaml
    /boxes/
    /data/
    /schema/
    /docs/
    /visualizer/
    /prompts/
    /history/
```

Do not require root-level `AGENTS.md` or `CLAUDE.md`. Those files may exist in a
consuming project, but they are not part of the required BlackBoxApproach
execution mechanism.

## Operating Loop

When invoked:

1. Read `/blackboxes/system.yaml` if it exists.
2. Read relevant files in `/blackboxes/boxes/`, `/blackboxes/data/`,
   `/blackboxes/history/`, and `/blackboxes/docs/`.
3. Identify whether the request creates a system, refines a selected box,
   validates the graph, updates provenance, generates stubs, generates tests,
   or updates prompt output.
4. Respect the focused refinement boundary if a selected box is named.
5. Preserve signatures, contracts, graph relationships, and provenance unless
   the human explicitly instructs otherwise.
6. Validate YAML and graph consistency before finishing.
7. Update docs, history, generated prompts, or visualizer expectations only
   when relevant to the task.

Prefer recursive refinement over monolithic implementation.

## Box YAML Format

Each black box is a YAML file in `/blackboxes/boxes/`.

Required fields:

```yaml
id: root_capability
name: Root Capability
kind: black_box
box_type: logic
state: abstract
provenance: mixed

human_summary: |
  Human-provided context or confirmed behavior.

ai_reasoning: |
  AI-added decomposition, assumptions, and rationale.

signature:
  inputs:
    - name: request
      data_ref: ../data/request.yaml
      provenance: human_defined
  outputs:
    - name: result
      data_ref: ../data/result.yaml
      provenance: ai_defined
      ai_reasoning: |
        Result was inferred as the natural output of the root capability.

intent: |
  Coordinates the top-level workflow.

algorithm: |
  CALL validate_request(request)
  CALL produce_result(request)

children:
  - validate_request
  - produce_result

contracts:
  preconditions:
    - request is not null
  postconditions:
    - result exists when processing succeeds
```

Recommended `box_type` values:

- `logic`
- `view`
- `data_flow`
- `integration`
- `service`

Allowed `state` values:

- `abstract`
- `partial`
- `concrete`

Allowed `provenance` values:

- `human_defined`
- `ai_defined`
- `mixed`

## View Boxes

Every UI screen or view must be represented as a black box with:

```yaml
box_type: view
visual_design: |
  Description of layout, visual hierarchy, styling, and interaction model.
```

View boxes still use `intent`, `algorithm`, `children`, `contracts`, and
provenance. Missing `visual_design` is a validation issue.

## Data Structure Format

Shared input and output structures live in `/blackboxes/data/`. Do not duplicate
shared data structures inline inside box signatures.

Every file in `/blackboxes/data/` must be a `kind: data_structure` YAML with a
top-level `fields` array. Do not create box-shaped data files with `kind:
black_box`, `children`, `contracts`, or `implementation.code`. Do not describe
schema fields inside `implementation.code` comments.

```yaml
id: Order
kind: data_structure
provenance: mixed

fields:
  - name: items
    type: OrderItem[]
    provenance: human_defined
    human_summary: Items included in the order.
  - name: currency
    type: string
    provenance: ai_defined
    human_summary: Currency used for monetary values.
    ai_reasoning: |
      Currency is needed for financial values and reporting.
```

Data fields, nested structures, and implementation assumptions must carry
provenance when they represent a meaningful decision.

## Provenance Rules

Track whether boxes, data structures, fields, inputs, outputs, view definitions,
contracts, and implementation assumptions are:

- `human_defined`
- `ai_defined`
- `mixed`

Allowed transitions:

- `ai_defined` -> `human_defined`
- `ai_defined` -> `mixed`
- `mixed` -> `human_defined`
- `human_defined` -> `ai_defined`, only under the parent-conflict exception
- `human_defined` -> `mixed`, only under the parent-conflict exception

Forbidden by default:

- `human_defined` -> `ai_defined`
- `human_defined` -> `mixed`

Human-confirmed decisions are protected by default. A child-node human-defined
decision may be changed to `ai_defined` or `mixed` only when all of the following
are true:

1. A parent node has received a newer human-defined modification.
2. A descendant child node contains a human-defined decision that directly
   contradicts or conflicts with that parent decision.
3. The LLM warns the user with the exact parent decision, child decision,
   affected file paths, and proposed provenance transition.
4. The human explicitly accepts the child transition before the child file is
   modified.
5. The changed child decision includes `ai_reasoning` explaining that the AI
   modified it only to comply with the newer human-defined parent decision.
6. The provenance log records the conflict, warning, acceptance, and changed
   files.

Without explicit human acceptance, treat the conflicting child decision as a
blocking validation issue and do not modify it. New AI assumptions must include
`ai_reasoning`.

## Pseudocode Rules

Use the hybrid pseudocode language consistently.

Allowed structural keywords:

- `CALL`
- `IF`
- `ELSE`
- `FOR`
- `WHILE`
- `RETURN`
- `SET`
- `TRY`
- `CATCH`
- `END`

Natural language is allowed inside conditions and expressions.

Only `CALL child_box(...)` is required to be machine parsed. Use this regex when
extracting graph edges:

```regex
CALL\s+([a-zA-Z0-9_]+)
```

When a `CALL child_box(...)` appears, ensure a matching child box exists or add a
missing-box validation issue. If the call is part of the modeled system, create
or update the child YAML and include it in `children`.

## Refinement Rules

Refinement may:

- expand a box into sub-boxes
- refine pseudocode
- refine contracts
- reduce ambiguity
- add implementation hints
- generate stubs or tests when appropriate
- add executable implementation code to leaf boxes

Refinement must preserve:

- intent
- contract compatibility
- signature compatibility
- graph consistency
- human-readable abstraction layers
- provenance history

Prefer small recursive refinements over large rewrites.

Leaf boxes are terminal boxes with no modeled child boxes or `CALL` references.
Every leaf box must contain actual executable programming code in
`implementation.code`. Descriptive placeholders are not enough for leaf boxes.
If a box is abstract or partial, refine it into children until the terminal
leaves can carry executable code. Mark AI-authored executable code with
`provenance` and `ai_reasoning`.

## Focused Refinement Boundary

When a selected box is named, that box is the root of the allowed modification
subtree.

Ancestors are read-only context. The selected box and its descendants are the
editable target.

Allowed changes:

- modify the selected box
- modify descendant boxes
- create new descendant boxes
- modify referenced data structures only if required by the selected subtree
- update documentation related to the selected subtree
- update generated prompts related to the selected subtree

Forbidden changes:

- modify ancestor boxes
- change parent signatures without explicit human instruction
- remove ancestor-child relationships above the selected box
- delete boxes without checking all references
- downgrade human-defined provenance, except through the approved
  parent-conflict exception
- silently introduce AI assumptions without `ai_reasoning`

If a requested change requires ancestor edits, stop and explain the exact
ancestor contract that needs human approval.

If a newer human-defined selected or parent box conflicts with a human-defined
descendant decision, warn the user and request explicit acceptance before
changing that child decision to `ai_defined` or `mixed`.

## Validation Rules

Detect and report:

- invalid YAML
- duplicate IDs
- missing child boxes
- orphan boxes
- circular references
- broken data references
- missing data references
- inline data structures duplicated inside box signatures
- view boxes without `visual_design`
- `CALL` references missing from `children`
- children missing from `CALL` references unless intentionally external
- forbidden provenance transitions when history is available
- human-defined child decisions that conflict with newer human-defined parent
  decisions and need explicit acceptance before transition

Before finalizing changes, ensure generated YAML remains schema-valid where a
schema is available.

## Prompt Generation Rules

When asked to generate a refinement prompt, include:

1. Skill invocation reminder.
2. User instruction.
3. Selected box YAML.
4. Descendant box YAML files.
5. Referenced data structures.
6. Ancestor summary.
7. Modification boundary.
8. Explicit rule that ancestors are read-only.
9. Explicit rule that descendants are editable.
10. Explicit rule that contracts and provenance must be preserved.

The visualizer should output a copyable prompt and must not call an LLM API.

## Stub And Test Rules

Generated stubs must:

- preserve signature
- preserve contracts
- preserve output structure
- mark implementation assumptions with provenance
- remain temporary until the human requests concrete implementation

Final leaf implementations must be executable code, not pseudocode. They may be
small reference implementations, adapter functions, or framework-specific view
renderers, but they must be runnable in the declared `implementation.language`.

Generated tests should derive from contracts and state whether each expectation
is human-defined, AI-defined, or mixed.

## History Rules

Use `/blackboxes/history/provenance_log.yaml` to record meaningful changes:

- timestamp
- actor
- action
- affected files
- summary
- provenance notes

`provenance_log.yaml` must not be empty. It must contain an `entries` array.
When modifying a project, preserve existing entries and append new entries.

```yaml
entries:
  - timestamp: "2026-06-02T00:00:00Z"
    actor: ai_assistant
    action: modified_selected_box
    affected_files:
      - blackboxes/boxes/render_page.yaml
      - index.html
    summary: Updated the selected box and corresponding source file.
    provenance_notes: The requested change came from the human instruction; implementation details were completed by AI.
```

Keep entries short and auditable.
