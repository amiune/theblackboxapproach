# BlackBox Project · 0.2.0

Explore a project one click at a time. The initial view contains just its
name and **input → process → output**. The full source-based model stays
embedded offline; navigation reveals only the information you choose.

## Explore

- Click a **process** to enter its immediate children. Other branches stay hidden.
- Use **Back** or the breadcrumbs to return to a previous level.
- Click a **leaf process**, or **Details** for the current process, for a compact card.
- Click **input/output data** for field names and types. Open a field for its
  details or follow a nested type; the card has its own Back control.
- Open **Decisions & ownership**, **User approval**, **Sources**, or
  **Implementation** only when you need them. AI proposals retain AI origin
  after a user approves them; unsupported attribution stays Unknown.
- **More** holds search, ownership/evidence filters, project coverage, notes,
  and zoom/fit controls. Press `/` to search and Escape to close a card.

There are no permanent sidebars, populated inspectors, dashboard counts, or
view tabs. Data cards keep the process diagram in place. All actions work
without a server, account, or network connection once the snapshot is built.

## Requirements and installation

Authoring uses the active Codex session with local execution and Python 3.10+.
Reading local chats also needs a Codex CLI supporting `codex app-server` on
PATH. The runtime helpers use only Python's standard library.

From this product directory:

```sh
python3 tools/build_release.py
codex plugin marketplace add ./release/marketplace
```

Restart the desktop app, choose **BlackBoxApproach Local** in the Plugins
Directory, and install **BlackBox Project**. The local marketplace and ZIP
contain the same runtime source. Building does not change global plugin
settings or publish a plugin.

## Create or refresh a snapshot

In a chat attached to the project you want to inspect:

> Use $blackbox-project to visualize this whole project, including children,
> data structures, and evidence for user and AI decisions.

To refresh:

> Refresh the BlackBox visualization from the current source and project chats.

Codex reads the eligible source and available local chats, authors the
semantic model, validates it, and opens the viewer. The helper scripts are
deterministic I/O and validation tools, not a universal code parser.

Outputs default to `visualization/blackbox/index.html` and `model.json` in
its target project. Existing source, Git state, and project configuration
are unchanged. Model format version 1 and existing CLI commands are preserved.

Active and archived local chats are matched by canonical project/worktree
paths. Cloud-only, other-host, renamed-project, deleted, truncated, or
unsupported history may be unavailable. Missing history is disclosed in
project information; it cannot establish who chose a behavior. Raw history
stays in temporary analysis storage rather than the delivered viewer.

The inventory records exclusions for secrets, ignored files, dependencies,
generated output, symlinks, binaries, and files above the default 1 MiB limit.
Source is not executed. Counts, coverage, and warnings are available in
**More → About this project**.

## Build and verify

All development inputs are in this folder:

- `fixtures/` contains synthetic source, YAML, and the baseline demo model.
- `demos/` contains reviewable HTML and normalized models. Demo chat evidence
  is explicitly synthetic; YAML provenance is preserved as recorded.
- `skills/blackbox-project/` is the packaged runtime skill and viewer.
- `tools/` and `tests/` build and check the release without other repository products.

```sh
python3 -m unittest discover -s tests -v
python3 tools/build_demos.py
python3 tools/build_release.py
node tests/browser.cjs /absolute/path/to/node_modules /absolute/path/to/chrome
```

Playwright and the official skill validator's PyYAML dependency are for
development only. A combined check, including an isolated copy of this folder:

```sh
python3 tools/verify_release.py \
  --skill-validator /absolute/path/to/quick_validate.py \
  --node-modules /absolute/path/to/node_modules \
  --isolated
```

Use `--validator-deps` for a temporary Python packages directory and
`--live-history` for a read-only local history metadata smoke test.
`release/validation-report.json` records actual checks and their limitations.
Installation and public directory review are separate from local verification.

The [model reference](skills/blackbox-project/references/model-format.md)
documents the stable JSON contract, source validation, and attribution rules.
