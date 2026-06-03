# BlackBoxApproach Examples

## Root Box Generation

Human prompt:

```text
/blackboxapproach Create a root black-box architecture for a new app.
```

Result:

```yaml
id: root_capability
name: Root Capability
kind: black_box
box_type: logic
state: abstract
provenance: mixed
human_summary: |
  The human requested a new app.
ai_reasoning: |
  The AI chose a small root workflow and separated validation from result
  production so each responsibility can be refined independently.
intent: |
  Coordinates the top-level workflow.
algorithm: |
  CALL validate_request(request)
  CALL produce_result(request)
children:
  - validate_request
  - produce_result
```

## Child Box Refinement

Human prompt:

```text
/skill blackboxapproach Refine produce_result only so it handles failure states.
```

Boundary:

- `produce_result` is editable.
- descendants of `produce_result` are editable.
- ancestors such as `root_capability` are read-only.

Possible child creation:

```yaml
algorithm: |
  CALL prepare_result(request)

  IF result cannot be produced
      CALL record_failure(request)
      RETURN failure result
  END

  CALL finalize_result(request)
```

The new `CALL prepare_result(...)`, `CALL record_failure(...)`, and
`CALL finalize_result(...)` require matching child boxes unless they are marked
as external integrations.

## Data Structure Extraction

Avoid inline signatures like:

```yaml
inputs:
  - name: request
    fields:
      - name: id
        type: string
```

Use a data reference:

```yaml
inputs:
  - name: request
    data_ref: ../data/request.yaml
```

Then define `/blackboxes/data/request.yaml`.

## View Box Creation

```yaml
id: result_view
name: Result View
kind: black_box
box_type: view
state: partial
provenance: ai_defined
ai_reasoning: |
  A result screen was inferred because users need to inspect the workflow
  outcome.
intent: |
  Shows the current result clearly to the user.
visual_design: |
  Focused layout with status, relevant details, and clear next actions.
algorithm: |
  CALL format_result(result)
  CALL render_result_details(result)
children:
  - format_result
  - render_result_details
```

## Provenance Classification

- A box requested directly by the human is `human_defined` or `mixed`.
- A field inferred by the AI is `ai_defined` and must include `ai_reasoning`.
- A human-edited AI suggestion can move from `ai_defined` to `mixed` or
  `human_defined`.
- A `human_defined` decision does not move back to `ai_defined` or `mixed` by
  default.
- Exception: if a newer human-defined parent decision conflicts with an older
  human-defined child decision, the AI must warn the user and get explicit
  acceptance before changing the child to `ai_defined` or `mixed` for parent
  compliance.

## Focused Refinement Prompt

```text
/blackboxapproach

Task:
Refine this box so that it handles failure states.

Selected modification root:
produce_result

Allowed modification boundary:
You may modify produce_result and its descendants.
You may create new descendant boxes if needed.
You may modify referenced data structures only if the selected box or descendants require it.
You must not modify ancestor boxes.
```
