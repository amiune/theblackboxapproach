# BlackBoxApproach

A desktop plugin for exploring a project as **input → process → output**.
Start with one simple diagram. Click a process to see its immediate children,
or click data for its fields. Decisions, user approval, source evidence, and
implementation details stay closed until you ask to see them.

The plugin reads source and available local project chats through the active
Codex session. It generates an offline HTML snapshot with evidence for User,
AI, Mixed, and Unknown decisions. User approval is recorded separately from
the origin of an AI proposal.

The plugin is the only product in this repository. Its source, fixtures,
demos, tests, and release tools are self-contained in
[`products/codex-blackbox-plugin/`](products/codex-blackbox-plugin/).

## Install and use

From the repository root:

```sh
cd products/codex-blackbox-plugin
python3 tools/build_release.py
codex plugin marketplace add ./release/marketplace
```

Restart the desktop app, choose **BlackBoxApproach Local** in the Plugins
Directory, and install **BlackBox Project**. Then, in your project chat:

> Use $blackbox-project to visualize this whole project and its user and AI decisions.

Authoring requires local execution, Python 3.10+, and the Codex CLI for local
history. Viewing the generated HTML needs only a modern browser. Refresh is
on request; no background service or model API key is required.

## Develop and verify

```sh
cd products/codex-blackbox-plugin
python3 -m unittest discover -s tests -v
python3 tools/build_demos.py
python3 tools/build_release.py
node tests/browser.cjs /absolute/path/to/node_modules /absolute/path/to/chrome
```

See the [plugin guide](products/codex-blackbox-plugin/README.md) for installation
details, isolated verification, the model contract, and history coverage limits.
Try the [Orderflow demo](products/codex-blackbox-plugin/demos/orderflow/index.html)
or the [BlackBox YAML demo](products/codex-blackbox-plugin/demos/quote-engine/index.html).
