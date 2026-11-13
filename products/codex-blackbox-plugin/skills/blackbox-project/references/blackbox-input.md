# Existing BlackBoxApproach projects

Read existing YAML as project evidence. The Codex session maps it to the JSON
model; runtime helpers do not install or depend on a YAML parser.

- `blackboxes/system.yaml` supplies identity and `root_box`.
- `blackboxes/boxes/*.yaml` supplies stable IDs, names, `box_type`, intent,
  algorithm/process, signatures, children, contracts, and recorded state.
- Resolve signature `data_ref` paths relative to the referring YAML file.
- Preserve each declared `provenance`, including `implementation.provenance`,
  as recorded information; cite its actual declaration line with
  `recordedProvenance` in the source. Keep implementation authorship separate
  from design decision origin.
- Extract modeled `CALL` references as documented calls. They are not measured
  runtime traces. Missing calls/children and mismatches become warnings.
- `blackboxes/data/*.yaml` uses `kind: data_structure` with top-level `fields`.
  Map field types and explicit references, preserving per-field provenance.
- Read `blackboxes/history/provenance_log.yaml` and relevant docs to clarify
  intent or changes. Compare with available project chats and implementation.
  Show unresolved disagreements; do not silently overwrite recorded metadata.
- Preserve human summaries and supplied concise rationale where relevant.
  Do not invent private reasoning or fill in missing implementations.

Cycles, shared children, duplicate IDs, missing roots, malformed records, and
unresolved data references must be reported without changing the project.
Do not create blackbox YAML, append a provenance log, execute leaf code,
generate refinement prompts, commit, discard, or add LLM editing controls.
