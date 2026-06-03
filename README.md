# BlackBoxApproach

BlackBoxApproach is a macOS visualizer and project workflow for designing apps
as recursive black-box trees.

The tooling is separate from generated apps. Each generated app or project gets
its own folder, its own `blackboxes/` directory, and its own `.git` directory.

## Layout

```text
apps/
  BlackBoxApproachMac/
    Package.swift
    Sources/BlackBoxApproachMac/
    scripts/package_app.sh
templates/
  blackbox-project/
    blackboxes/
      boxes/
      data/
      docs/
      history/
      prompts/
      schema/
      skill/
      visualizer/
      system.yaml
projects/
  README.md
```

Generated apps should use this shape:

```text
projects/
  my-app/
    .git/
    blackboxes/
      system.yaml
      boxes/
      data/
      docs/
      history/
      prompts/
      schema/
      skill/
    src/
    tests/
```

The `templates/.../visualizer/` files are bundled tooling files. They are shared
by the macOS app and are not copied into each generated project.

## macOS App

From this folder, run the app during development with:

```bash
cd /Users/hernanamiune/Documents/theblackboxapproach/apps/BlackBoxApproachMac
swift run BlackBoxApproachMac
```

The first launch opens the visualizer shell using the bundled blank template.
Use the macOS menu item **BlackBoxApproachMac > Settings...** to add your OpenAI
token and model. The default OpenAI request timeout is 300 seconds; increase it
in Settings if project generation takes longer. Use **Settings > Choose Projects
Folder** to choose the parent folder where generated apps should be created.
Use the macOS menu item **File > Open Project Folder...** to open an existing
app project in the visualizer.

For example, if you choose `/Users/you/BlackBoxProjects` and ChatGPT returns
`"project": { "path": "simple-notepad" }`, the app creates:

```text
/Users/you/BlackBoxProjects/simple-notepad/
```

The selected folder is already the projects parent. ChatGPT should not prefix
new app names with `projects/`; if it does, the app strips that prefix.
If a generated project folder already exists, the app creates a suffixed folder
such as `simple-notepad-2` instead of overwriting the existing one.

Use **Test OpenAI Connection** in Settings before sending a large prompt. It
sends a tiny Responses API request and prints the result or the exact connection
error. If this test does not appear in the OpenAI API logs, the app is not
reaching OpenAI from your Mac.

For a fresh project, switch to **Explorer**, type the app you want in
**Instruction**, and press **Send**. When no box is selected yet, the Prompt
Builder generates a project-creation prompt instead of a box-refinement prompt.
When ChatGPT creates a new app, the app seeds that app folder from the blank
template and initializes that app folder’s own `.git`. The generated files are
left as visible uncommitted changes so the visualizer can show the git diff.
Use **Commit** to save them or **Discard** to throw them away before asking for
another ChatGPT modification.

Build a double-clickable `.app` bundle with:

```bash
cd /Users/hernanamiune/Documents/theblackboxapproach/apps/BlackBoxApproachMac
./scripts/package_app.sh
```

Then launch it with:

```bash
open .build/BlackBoxApproach.app
```

The packaging script copies the reusable blackbox template into the app bundle,
so the packaged app can start even when no project is selected yet.

The main window is a native SwiftUI visualizer with the same primary views:

- Process Plot
- Data Structures Plot
- Explorer

The app includes native project capabilities:

- stores an OpenAI token and model in macOS Settings
- sends the Prompt Builder prompt to ChatGPT
- writes returned files automatically
- initializes `.git` for newly created projects
- reads Git status and diff from the selected project
- blocks new ChatGPT modifications while the selected project has uncommitted
  changes
- commits or discards project changes from the visualizer header

There is no manual UI for creating files or directories. ChatGPT creates them
through a structured response.

Use **File > Open Project Folder...** to open an existing app project.

## ChatGPT File Response

For a brand-new project, ChatGPT should return JSON like this:

```json
{
  "message": "Created the project.",
  "project": {
    "path": "my-app",
    "init_git": true
  },
  "files": [
    {
      "path": "blackboxes/system.yaml",
      "content": "complete file contents"
    },
    {
      "path": "blackboxes/boxes/root.yaml",
      "content": "complete file contents"
    },
    {
      "path": "src/index.js",
      "content": "complete file contents"
    }
  ]
}
```

When `project.path` is present, it is interpreted as the new app directory name
inside the selected Projects Folder. File paths are relative to that project
directory, so a project named `simple-notepad` is created as
`<Projects Folder>/simple-notepad`, not
`<Projects Folder>/simple-notepad/simple-notepad`. File responses should use
paths such as `blackboxes/system.yaml` and `index.html`, not paths prefixed with
the project name. If ChatGPT accidentally includes that redundant prefix, the
macOS app strips it before writing files.

The app copies the blank `blackboxes/` project scaffolding into the project when
needed, initializes `.git`, writes the files, switches to the new project, and
reloads the native visualizer.

For an existing selected project, ChatGPT must omit `project`; file paths are
relative to the selected project root. Selected-box modifications are always
written into the currently open project, even if ChatGPT accidentally returns a
`project.path`.

Absolute paths and `..` escapes are rejected.

## Project Rules

Each project owns its own `blackboxes/` tree:

- `blackboxes/system.yaml` identifies the project and root box.
- `blackboxes/boxes/*.yaml` defines boxes.
- `blackboxes/data/*.yaml` defines shared data structures.
- `blackboxes/history/provenance_log.yaml` records meaningful provenance
  changes.

`blackboxes/history/provenance_log.yaml` must not be empty. It should preserve
existing entries and append an entry for each project creation or modification,
including timestamp, actor, action, affected files, summary, and provenance
notes.

Data structure files must use `kind: data_structure` and a top-level `fields`
array. They should not be box-shaped YAML files and should not hide schema
fields inside `implementation.code` comments.

New projects do not need their own `blackboxes/visualizer/` directory. The
macOS app renders projects with native SwiftUI.

Leaf boxes must contain executable programming code in `implementation.code`.

Each project also owns its own Git repository. Git status and diff warnings in
the visualizer are based on the selected project’s `.git`, not on this tooling
folder.
