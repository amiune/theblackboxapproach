# BlackBoxApproach Method

BlackBoxApproach starts from intent and refines recursively.

## 1. Create Or Find The Root Box

The root box captures the system-level intent, signature, contracts, and first
layer of children. It is not implementation code. It is the top semantic
contract for the system.

## 2. Extract Data Structures

Inputs and outputs refer to shared files in `/blackboxes/data/`. Do not duplicate
shared structures inside signatures.

## 3. Decompose With CALL

Use `CALL child_box(...)` to express parent-child relationships. Each modeled
CALL should have a matching child YAML file and a matching item in `children`.

## 4. Refine One Boundary At A Time

Focused refinement treats the selected box as the root of the editable subtree.
Ancestors are read-only context. Descendants may be changed or created.

Terminal leaf boxes must contain actual executable programming code in
`implementation.code`. If a leaf cannot honestly contain executable code yet,
continue refining it into smaller child boxes until the leaves can be concrete.

## 5. Preserve Contracts

Refinement should preserve intent, preconditions, postconditions, signatures,
and provenance unless the human explicitly asks for a contract change.

## 6. Track Provenance

Human decisions are protected. AI assumptions are visible. Mixed decisions are
allowed when a human prompt and AI inference combine into one artifact.

A protected human-defined child decision can be changed by AI only under a narrow
parent-conflict exception: a newer human-defined parent decision must conflict
with the child, the user must be warned with the exact conflict, and the user
must explicitly accept the child transition before the child is modified. The
change must include `ai_reasoning` and a provenance log entry.

## 7. Validate Often

Validation is intentionally practical:

- parse YAML
- check duplicate IDs
- compare `CALL` references with `children`
- detect missing children
- detect circular references
- detect orphan boxes
- check data references
- require `visual_design` on view boxes
- flag human-defined child decisions that conflict with newer human-defined
  parent decisions and require acceptance
- flag leaf boxes that lack executable `implementation.code`
- show Git working-copy changes when `git_status.txt` and `git_diff.patch` are
  loaded into the visualizer

The goal is disciplined refinement, not perfect static analysis.
