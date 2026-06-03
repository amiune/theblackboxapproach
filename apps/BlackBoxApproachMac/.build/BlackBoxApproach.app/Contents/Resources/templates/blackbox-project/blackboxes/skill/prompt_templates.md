# BlackBoxApproach Prompt Templates

## Create A New System

```text
/blackboxapproach

Task:
Create a root black-box architecture for:
{{developer_prompt}}

Requirements:
- Store all artifacts under /blackboxes/.
- Create or update system.yaml.
- Create root and first-level child boxes in /blackboxes/boxes/.
- Extract shared data structures into /blackboxes/data/.
- Track human_defined, ai_defined, and mixed provenance.
- Add ai_reasoning for AI assumptions.
- Preserve YAML schema validity.
- Validate graph consistency.
```

## Refine A Selected Box

```text
/blackboxapproach

Task:
{{instruction}}

Selected modification root:
{{selected_box_id}}

Allowed modification boundary:
You may modify {{selected_box_id}} and its descendants.
You may create new descendant boxes if needed.
You may modify referenced data structures only if required by this subtree.
You must not modify ancestor boxes.

Ancestor context, read-only:
{{ancestor_summary}}

Selected box YAML:
{{selected_box_yaml}}

Descendant box YAML:
{{descendant_box_yaml}}

Referenced data structures:
{{referenced_data_yaml}}

Rules:
- Preserve signature compatibility unless the human instruction explicitly requires changing it.
- Preserve existing contracts unless the human instruction explicitly changes them.
- Preserve graph consistency.
- Add missing child boxes for new CALL references.
- Track human_defined, ai_defined, and mixed provenance.
- AI assumptions must include ai_reasoning.
- Human-specified changes must be marked human_defined or mixed as appropriate.
- If a newer human-defined parent decision conflicts with a human-defined child decision, warn the user and ask for explicit acceptance before changing the child from human_defined to ai_defined or mixed.
- Without that acceptance, report the conflict as blocked and do not modify the child decision.
```

## Validate Consistency

```text
/blackboxapproach

Task:
Validate the current /blackboxes/ architecture.

Checks:
- YAML validity.
- Schema validity.
- Duplicate IDs.
- Missing child boxes.
- Orphan boxes.
- Circular references.
- Broken data references.
- Inline data structures in signatures.
- View boxes without visual_design.
- CALL references missing from children.
- Children missing from CALL references unless intentionally external.
- Forbidden provenance transitions if history is available.
- Human-defined child decisions that conflict with newer human-defined parent decisions and require explicit acceptance before transition.

Output:
- Findings ordered by severity.
- File paths for each issue.
- Minimal recommended fixes.
- Any required human acceptance prompts for parent-child provenance conflicts.
```

## Resolve Parent-Child Provenance Conflict

```text
/blackboxapproach

Task:
Resolve this parent-child definition conflict:
{{conflict_summary}}

Rules:
- The parent decision is newer and human_defined.
- The child decision is human_defined and conflicts with the parent.
- Warn the user with parent file, child file, parent decision, child decision, and proposed child provenance transition.
- Ask for explicit acceptance before modifying the child.
- If accepted, change only the conflicting child decision needed for compliance.
- The child may move from human_defined to ai_defined or mixed only for this accepted conflict.
- Add ai_reasoning explaining that the child was changed by AI to comply with the newer human-defined parent decision.
- Record the warning, acceptance, and changed files in provenance_log.yaml.
- If not accepted, leave the child unchanged and report the conflict as blocked.
```

## Convert AI Decisions To Human Decisions

```text
/blackboxapproach

Task:
Mark the following AI-defined decisions as human-confirmed:
{{decision_list}}

Rules:
- Allowed transition: ai_defined -> human_defined.
- Allowed transition: mixed -> human_defined.
- Do not change unrelated provenance.
- Preserve ai_reasoning as history when useful, but the active decision becomes human_defined.
- Add a provenance log entry.
```

## Generate Implementation Stubs

```text
/blackboxapproach

Task:
Generate implementation stubs for:
{{box_ids}}

Rules:
- Preserve signatures.
- Preserve contracts.
- Preserve output structure.
- Mark implementation assumptions with provenance.
- Do not replace abstract boxes with concrete implementations unless requested.
- Keep generated stubs traceable to their source box IDs.
```

## Generate Tests From Contracts

```text
/blackboxapproach

Task:
Generate tests from contracts for:
{{box_ids}}

Rules:
- Derive tests from preconditions, postconditions, invariants, and error contracts.
- Keep test names aligned with box IDs.
- Mark AI-inferred edge cases with ai_reasoning.
- Do not invent contract changes while generating tests.
```
