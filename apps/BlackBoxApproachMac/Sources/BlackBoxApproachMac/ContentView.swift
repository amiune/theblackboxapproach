import AppKit
import SwiftUI

enum MainViewMode: String, CaseIterable, Identifiable {
    case process = "Process Plot"
    case data = "Data Structures Plot"
    case explorer = "Explorer"

    var id: String { rawValue }
}

enum DetailMode: String, CaseIterable, Identifiable {
    case basic = "Basic"
    case advanced = "Advanced"

    var id: String { rawValue }
}

enum PlotScope: String, CaseIterable, Identifiable {
    case all = "All"
    case selected = "Selected"

    var id: String { rawValue }
}

struct ContentView: View {
    @EnvironmentObject private var state: AppState
    @State private var document = NativeProjectDocument()
    @State private var selectedId: String?
    @State private var selectedDataId: String?
    @State private var collapsedIds: Set<String> = []
    @State private var mainView: MainViewMode = .process
    @State private var detailMode: DetailMode = .basic
    @State private var plotScope: PlotScope = .all
    @State private var instruction = ""
    @State private var isLoading = false
    @State private var isSending = false
    @State private var modal: AppModal?

    var body: some View {
        VStack(spacing: 0) {
            HeaderView(
                status: document.status,
                mainView: $mainView,
                hasPendingChanges: document.hasPendingGitChanges,
                isBusy: isLoading || isSending,
                commit: commitChanges,
                discard: { modal = .discardConfirmation }
            )

            HStack(spacing: 0) {
                Group {
                    switch mainView {
                    case .process:
                        ProcessPlotView(
                            document: document,
                            selectedId: $selectedId,
                            selectedDataId: $selectedDataId,
                            scope: $plotScope,
                            showGitDiff: showGitDiff
                        )
                    case .data:
                        DataStructuresPlotView(
                            document: document,
                            selectedDataId: $selectedDataId,
                            selectedBoxId: $selectedId,
                            showData: showDataStructure,
                            showGitDiff: showGitDiff
                        )
                    case .explorer:
                        ExplorerView(
                            document: document,
                            selectedId: $selectedId,
                            selectedDataId: $selectedDataId,
                            collapsedIds: $collapsedIds,
                            detailMode: $detailMode,
                            showData: showDataStructure,
                            showGitDiff: showGitDiff
                        )
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                Divider()

                PromptBuilderPanel(
                    instruction: $instruction,
                    generatedPrompt: generatedPrompt,
                    placeholder: promptPlaceholder,
                    isSending: isSending,
                    send: sendPrompt
                )
                .frame(minWidth: 340, idealWidth: 420, maxWidth: 460)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .task {
            await refreshProject()
        }
        .onReceive(state.$projectURL) { _ in
            Task { await refreshProject() }
        }
        .sheet(item: $modal) { modal in
            ModalContent(
                modal: modal,
                confirmDiscard: discardChanges,
                close: { self.modal = nil }
            )
        }
    }

    private var isProjectCreationPrompt: Bool {
        let text = instruction.lowercased()
        let verbs = ["create", "start", "build", "make", "generate", "scaffold", "new"]
        let nouns = ["app", "application", "project", "site", "website", "web app", "static web app", "tool"]
        return verbs.contains(where: { text.contains($0) }) && nouns.contains(where: { text.contains($0) })
    }

    private var activeSelectedId: String? {
        guard !isProjectCreationPrompt else { return nil }
        if let selectedDataId, document.dataStructures[selectedDataId] != nil {
            return "data:\(selectedDataId)"
        }
        return selectedId
    }

    private var generatedPrompt: String {
        if !isProjectCreationPrompt,
           let selectedDataId,
           let data = document.dataStructures[selectedDataId] {
            return buildDataModificationPrompt(for: data)
        }
        if let selected = activeSelectedId, let box = document.box(for: selected) {
            return buildModificationPrompt(for: box)
        }
        return buildProjectPrompt()
    }

    private var promptPlaceholder: String {
        document.boxes.isEmpty
            ? "Write what you want to create."
            : "Write what you want to modify in the selected part of the project."
    }

    @MainActor
    private func refreshProject() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let payload = try await state.projectSnapshotPayload()
            let next = NativeProjectDocument.from(payload: payload)
            document = next
            if selectedId == nil || next.box(for: selectedId) == nil {
                selectedId = next.rootIds.first
            }
            if let selectedDataId, next.dataStructures[selectedDataId] == nil {
                self.selectedDataId = nil
            }
            if collapsedIds.isEmpty {
                collapsedIds = Set(next.boxes.keys)
            }
        } catch {
            document.status = "Mac app error: \(error.localizedDescription)"
        }
    }

    private func sendPrompt() {
        if activeSelectedId != nil && document.hasPendingGitChanges {
            modal = .message(title: "Uncommitted Changes", message: "Commit or discard project changes before asking ChatGPT for another modification.")
            return
        }

        isSending = true
        Task {
            do {
                let result = try await state.sendPromptAndApplyFiles(generatedPrompt, selectedId: activeSelectedId)
                await MainActor.run {
                    isSending = false
                    let message = result["message"] as? String ?? "ChatGPT completed the request."
                    let files = result["writtenFiles"] as? [String] ?? []
                    modal = .chatResult(message: message, files: files)
                }
                try? await Task.sleep(nanoseconds: 250_000_000)
                await refreshProject()
            } catch {
                await MainActor.run {
                    isSending = false
                    modal = .message(title: "ChatGPT Error", message: error.localizedDescription)
                }
            }
        }
    }

    private func commitChanges() {
        guard document.hasPendingGitChanges else { return }
        isLoading = true
        Task {
            do {
                let result = try await state.commitCurrentProject(message: "Save BlackBoxApproach changes")
                await MainActor.run {
                    modal = .message(title: "Git Result", message: result["message"] as? String ?? "Changes committed.")
                }
                await refreshProject()
            } catch {
                await MainActor.run {
                    isLoading = false
                    modal = .message(title: "Git Error", message: error.localizedDescription)
                }
            }
        }
    }

    private func discardChanges() {
        modal = nil
        isLoading = true
        Task {
            do {
                let result = try await state.discardCurrentProjectChanges()
                await MainActor.run {
                    modal = .message(title: "Git Result", message: result["message"] as? String ?? "Changes discarded.")
                }
                await refreshProject()
            } catch {
                await MainActor.run {
                    isLoading = false
                    modal = .message(title: "Git Error", message: error.localizedDescription)
                }
            }
        }
    }

    private func showDataStructure(_ data: DataNode) {
        selectedDataId = data.id.lowercased()
        selectedId = nil
        modal = .data(data)
    }

    private func showGitDiff(path: String) {
        modal = .git(path: path, change: document.gitChange(for: path), diff: document.diff(for: path))
    }

    private func buildProjectPrompt() -> String {
        let text = instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Create a new app with BlackBoxApproach." : instruction
        return [
            "/blackboxapproach",
            "",
            "Task:",
            text,
            "",
            "Project mode:",
            "Create a new project using project.path as the app directory name only, for example simple-notepad.",
            "Do not prefix project.path with projects/ and do not prefix returned file paths with the project name.",
            "Every file path must be relative to the new project root.",
            "",
            "Rules:",
            "- Return JSON with message, project, and files.",
            "- Create blackboxes/system.yaml with root_box set to the root box id.",
            "- Every box YAML must include id, name, kind, box_type, state, provenance, human_summary, ai_reasoning, signature, intent, algorithm, children, contracts, referenced_data, and implementation.",
            "- The root box must be abstract. Its name must match the app/project name in readable title case.",
            "- Box names and intents must be easy for non-technical people to read.",
            "- Leaf boxes must include executable programming code in implementation.code.",
            "- Also create the real code files needed by the app.",
            dataStructurePromptRules,
            provenanceLogPromptRules
        ].joined(separator: "\n")
    }

    private func buildModificationPrompt(for box: BoxNode) -> String {
        let taskText = instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Modify the selected part of the project."
            : instruction
        let descendants = collectDescendants(from: box.id)
        let descendantText = descendants.compactMap { document.box(for: $0) }.map { "# \($0.path)\n```yaml\n\($0.rawText)\n```" }.joined(separator: "\n\n")
        let implementationContext = implementationFileContext(for: box, descendantIds: descendants)
        return [
            "/blackboxapproach",
            "",
            "Task:",
            taskText,
            "",
            "Selected modification root:",
            box.id,
            "",
            "Allowed modification boundary:",
            "You may modify \(box.id) and its descendants.",
            "You may create new descendant boxes if needed.",
            "You must not modify ancestor boxes.",
            "This is an edit to the currently open project. Do not include project.path and do not create a new project directory.",
            "Return file paths relative to the current project root.",
            "If the selected box or descendants contain executable implementation.code, update the real source files that implement that code as well as the YAML box files.",
            "For UI changes such as HTML/CSS styling, write the changed index.html, style.css, app.js, or equivalent real app files. Do not only change the YAML.",
            "",
            "Selected box YAML:",
            "# \(box.path)\n```yaml\n\(box.rawText)\n```",
            "",
            "Descendant box YAML:",
            descendantText.isEmpty ? "No descendants currently exist." : descendantText,
            "",
            "Current implementation/source files:",
            implementationContext,
            "",
            "Rules:",
            "- Preserve graph consistency.",
            "- Every returned implementation.code change must correspond to the real code file content returned in files.",
            "- If you create or modify data structures, follow the canonical data_structure YAML shape below.",
            "- Add missing child boxes for new CALL references.",
            "- Track human_defined, ai_defined, and mixed provenance.",
            "- AI assumptions must include ai_reasoning.",
            "- Descendants are editable.",
            dataStructurePromptRules,
            provenanceLogPromptRules
        ].joined(separator: "\n")
    }

    private func buildDataModificationPrompt(for data: DataNode) -> String {
        let taskText = instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Modify the selected data structure."
            : instruction
        let sourceContext = document.files
            .filter { isCodeContextFile($0.path) }
            .prefix(12)
            .map { file in
                "# \(file.path)\n```\n\(file.text)\n```"
            }
            .joined(separator: "\n\n")
            .ifEmpty("No implementation/source files are loaded.")

        return [
            "/blackboxapproach",
            "",
            "Task:",
            taskText,
            "",
            "Selected data structure:",
            data.id,
            "",
            "Allowed modification boundary:",
            "You may modify \(data.path) and any boxes or source files that directly depend on this data structure.",
            "Do not create a new project directory. Do not include project.path.",
            "Return file paths relative to the current project root.",
            "",
            "Selected data structure YAML:",
            "# \(data.path)\n```yaml\n\(data.rawText)\n```",
            "",
            "Current implementation/source files:",
            sourceContext,
            "",
            "Rules:",
            "- Preserve graph consistency.",
            "- If the data shape changes, update referenced boxes and real source files that use it.",
            "- Track human_defined, ai_defined, and mixed provenance.",
            "- AI assumptions must include ai_reasoning.",
            dataStructurePromptRules,
            provenanceLogPromptRules
        ].joined(separator: "\n")
    }

    private var dataStructurePromptRules: String {
        """
        Data structure rules:
        - Every file in blackboxes/data/ MUST be a valid data_structure YAML, not a black_box YAML.
        - Data structure YAML MUST use kind: data_structure and MUST include a top-level fields array.
        - Do NOT describe data schema fields inside implementation.code comments. Data structures do not use implementation.code.
        - Each data field must include name, type, provenance, human_summary, and ai_reasoning.
        - Nested structures must use nested fields arrays.

        Canonical data structure YAML shape:
        id: note_schema
        name: Note Schema
        kind: data_structure
        provenance: ai_defined
        human_summary: Plain-language summary.
        ai_reasoning: Why this structure exists.
        fields:
          - name: storage_key
            type: string
            provenance: ai_defined
            human_summary: The localStorage key used to store the note.
            ai_reasoning: A stable key lets the app find the saved note.
          - name: value
            type: string
            provenance: ai_defined
            human_summary: The note text.
            ai_reasoning: The app stores one plain-text note.
        """
    }

    private var provenanceLogPromptRules: String {
        """
        Provenance log rules:
        - Always create or update blackboxes/history/provenance_log.yaml.
        - provenance_log.yaml MUST NOT be empty.
        - It must contain an entries array with at least one entry describing this response.
        - For modifications, preserve existing entries and append new entries.
        - Each entry must include timestamp, actor, action, affected_files, summary, and provenance_notes.

        Canonical provenance log YAML shape:
        entries:
          - timestamp: "2026-06-02T00:00:00Z"
            actor: ai_assistant
            action: modified_selected_box
            affected_files:
              - blackboxes/boxes/render_page.yaml
              - index.html
            summary: Updated the selected box and corresponding source file.
            provenance_notes: The requested change came from the human instruction; implementation details were completed by AI.
        """
    }

    private func implementationFileContext(for box: BoxNode, descendantIds: [String]) -> String {
        let implementationNames = ([box] + descendantIds.compactMap { document.box(for: $0) })
            .flatMap { implementationFileCandidates(from: $0) }
        let candidates = Set(implementationNames)
        let files = document.files.filter { file in
            isCodeContextFile(file.path) && (candidates.isEmpty || candidates.contains(file.path) || candidates.contains(URL(fileURLWithPath: file.path).lastPathComponent))
        }
        let fallbackFiles = files.isEmpty ? document.files.filter { isCodeContextFile($0.path) } : files
        let limited = fallbackFiles.prefix(12)
        return limited.map { file in
            "# \(file.path)\n```\n\(file.text)\n```"
        }.joined(separator: "\n\n").ifEmpty("No implementation/source files are loaded.")
    }

    private func implementationFileCandidates(from box: BoxNode) -> [String] {
        let implementation = box.data["implementation"]?.mapValue ?? [:]
        let keys = ["file", "path", "source_file", "source_path", "code_file", "target_file"]
        return keys.compactMap { implementation[$0]?.stringValue }
    }

    private func isCodeContextFile(_ path: String) -> Bool {
        guard !path.hasPrefix("blackboxes/") else { return false }
        let ext = URL(fileURLWithPath: path).pathExtension.lowercased()
        return ["html", "css", "js", "mjs", "ts", "tsx", "jsx", "swift", "py", "json", "md"].contains(ext)
    }

    private func collectDescendants(from id: String) -> [String] {
        var result: [String] = []
        var visited: Set<String> = []
        func walk(_ current: String) {
            guard let box = document.box(for: current) else { return }
            for child in box.children where !visited.contains(child) {
                visited.insert(child)
                result.append(child)
                walk(child)
            }
        }
        walk(id)
        return result
    }
}

struct HeaderView: View {
    let status: String
    @Binding var mainView: MainViewMode
    let hasPendingChanges: Bool
    let isBusy: Bool
    let commit: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("BlackBoxApproach Visualizer")
                    .font(.title3.weight(.semibold))
                Text(status)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Picker("View", selection: $mainView) {
                ForEach(MainViewMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 420)
            Button("Commit", action: commit)
                .disabled(!hasPendingChanges || isBusy)
            Button("Discard", action: discard)
                .disabled(!hasPendingChanges || isBusy)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color(nsColor: .separatorColor)).frame(height: 1)
        }
    }
}

struct ExplorerView: View {
    let document: NativeProjectDocument
    @Binding var selectedId: String?
    @Binding var selectedDataId: String?
    @Binding var collapsedIds: Set<String>
    @Binding var detailMode: DetailMode
    let showData: (DataNode) -> Void
    let showGitDiff: (String) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Panel(title: "Tree") {
                HStack {
                    Button("Collapse All") { collapsedIds = Set(document.boxes.keys) }
                    Button("Expand All") { collapsedIds.removeAll() }
                    Spacer()
                    Text("\(document.boxes.count)")
                        .badgeStyle()
                }
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(document.rootIds, id: \.self) { id in
                            TreeNodeView(document: document, id: id, selectedId: $selectedId, selectedDataId: $selectedDataId, collapsedIds: $collapsedIds)
                        }
                    }
                    .padding(.vertical, 8)
                }
                WarningList(issues: document.validation)
            }
            .frame(minWidth: 280, idealWidth: 330)

            Divider()

            Panel(title: "Selected Box") {
                HStack {
                    Picker("Detail", selection: $detailMode) {
                        ForEach(DetailMode.allCases) { mode in Text(mode.rawValue).tag(mode) }
                    }
                    .pickerStyle(.segmented)
                    Spacer()
                    Text(selectedId ?? "None").badgeStyle()
                }
                ScrollView {
                    if let box = document.box(for: selectedId) {
                        BoxDetailView(document: document, box: box, mode: detailMode, showData: showData, showGitDiff: showGitDiff)
                    } else {
                        EmptyState("Select a box from the tree.")
                    }
                }
            }
            .frame(minWidth: 390, idealWidth: 500)

        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct PromptBuilderPanel: View {
    @Binding var instruction: String
    let generatedPrompt: String
    let placeholder: String
    let isSending: Bool
    let send: () -> Void

    var body: some View {
        Panel(title: "Prompt Builder") {
            Text("Instruction").font(.caption.weight(.semibold))
            ZStack(alignment: .topLeading) {
                TextEditor(text: $instruction)
                    .font(.body)
                    .frame(minHeight: 130)
                    .scrollContentBackground(.hidden)
                    .background(Color(nsColor: .textBackgroundColor))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                if instruction.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(placeholder)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 10)
                        .allowsHitTesting(false)
                }
            }
            HStack {
                Text("Generated prompt").font(.caption.weight(.semibold))
                Spacer()
                Button(isSending ? "Sending..." : "Send", action: send)
                    .disabled(isSending)
            }
            TextEditor(text: .constant(generatedPrompt))
                .font(.system(.caption, design: .monospaced))
                .frame(minHeight: 330)
                .scrollContentBackground(.hidden)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }
}

struct TreeNodeView: View {
    let document: NativeProjectDocument
    let id: String
    @Binding var selectedId: String?
    @Binding var selectedDataId: String?
    @Binding var collapsedIds: Set<String>

    var body: some View {
        if let box = document.box(for: id) {
            let children = box.children
            let isCollapsed = collapsedIds.contains(id)
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    selectedId = id
                    selectedDataId = nil
                } label: {
                    HStack(spacing: 6) {
                        Button {
                            if isCollapsed { collapsedIds.remove(id) } else { collapsedIds.insert(id) }
                        } label: {
                            Text(children.isEmpty ? " " : (isCollapsed ? "+" : "-"))
                                .frame(width: 18)
                        }
                        .buttonStyle(.plain)
                        Text(box.name)
                            .lineLimit(1)
                        Spacer()
                        Text(box.boxType.isEmpty ? "box" : box.boxType).badgeStyle()
                        if let change = document.gitChange(for: box.path) {
                            GitPill(change: change)
                        }
                    }
                    .padding(8)
                    .background(selectedId == id ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.22) : Color(nsColor: .controlBackgroundColor))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(gitColor(document.gitChange(for: box.path)?.status) ?? Color(nsColor: .separatorColor), lineWidth: document.gitChange(for: box.path) == nil ? 1 : 2))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)

                if !isCollapsed {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(children, id: \.self) { child in
                            TreeNodeView(document: document, id: child, selectedId: $selectedId, selectedDataId: $selectedDataId, collapsedIds: $collapsedIds)
                        }
                    }
                    .padding(.leading, 18)
                }
            }
        } else {
            Text("\(id) missing")
                .font(.caption)
                .foregroundStyle(.red)
                .padding(6)
        }
    }
}

struct BoxDetailView: View {
    let document: NativeProjectDocument
    let box: BoxNode
    let mode: DetailMode
    let showData: (DataNode) -> Void
    let showGitDiff: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let change = document.gitChange(for: box.path) {
                Button {
                    showGitDiff(box.path)
                } label: {
                    HStack {
                        GitPill(change: change)
                        Text(box.path)
                        Spacer()
                        Text("View Git Changes")
                    }
                }
            }

            if mode == .advanced {
                DetailSection("ID", box.id)
                DetailSection("Path", box.path)
                ReferencedDataSection(document: document, box: box, showData: showData)
            }
            DetailSection("Human Summary", box.humanSummary)
            DetailSection("AI Reasoning", box.aiReasoning)
            DetailSection("Intent", box.intent)
            DetailSection("Algorithm", box.algorithm, monospaced: true)
            if mode == .advanced {
                DetailSection("Signature", renderYaml(box.signature), monospaced: true)
                DetailSection("Contracts", renderYaml(box.contracts), monospaced: true)
                DetailSection("Children", box.children.isEmpty ? "None" : box.children.joined(separator: "\n"), monospaced: true)
                if !box.implementationCode.isEmpty {
                    DetailSection("Implementation Code", box.implementationCode, monospaced: true)
                }
            }
        }
        .padding(.vertical, 10)
    }
}

struct ReferencedDataSection: View {
    let document: NativeProjectDocument
    let box: BoxNode
    let showData: (DataNode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Referenced Data").font(.caption.weight(.bold))
            DataRefs(label: "Input", refs: refs(for: "inputs"), document: document, showData: showData)
            DataRefs(label: "Output", refs: refs(for: "outputs"), document: document, showData: showData)
        }
        .detailCard()
    }

    private func refs(for key: String) -> [String] {
        guard let signature = box.signature?.mapValue else { return [] }
        return (signature[key]?.arrayValue ?? []).compactMap { item in
            item.mapValue?["data_ref"]?.stringValue ?? item.stringValue
        }
    }
}

struct DataRefs: View {
    let label: String
    let refs: [String]
    let document: NativeProjectDocument
    let showData: (DataNode) -> Void

    var body: some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 48, alignment: .leading)
            if refs.isEmpty {
                Text("None").font(.caption).foregroundStyle(.secondary)
            } else {
                FlowLayout(items: refs) { ref -> AnyView in
                    if let data = document.dataNode(for: ref) {
                        return AnyView(Button(data.name) { showData(data) })
                    } else {
                        return AnyView(Text(ref).badgeStyle())
                    }
                }
            }
        }
    }
}

struct ProcessPlotView: View {
    let document: NativeProjectDocument
    @Binding var selectedId: String?
    @Binding var selectedDataId: String?
    @Binding var scope: PlotScope
    let showGitDiff: (String) -> Void
    @State private var panOffset: CGSize = .zero
    @State private var zoom: CGFloat = 1
    @GestureState private var dragOffset: CGSize = .zero

    var graphLayout: ProcessGraphLayout {
        buildProcessGraphLayout(document: document, selectedId: selectedId, scope: scope)
    }

    var body: some View {
        Panel(title: "Interactive Plot") {
            HStack {
                Picker("Scope", selection: $scope) {
                    ForEach(PlotScope.allCases) { scope in Text(scope.rawValue).tag(scope) }
                }
                .pickerStyle(.segmented)
                .frame(width: 180)
                Button("−") { zoom = max(0.35, zoom - 0.15) }
                    .help("Zoom out")
                Button("+") { zoom = min(2.2, zoom + 0.15) }
                    .help("Zoom in")
                Button("Reset") {
                    zoom = 1
                    panOffset = .zero
                }
                Spacer()
                Text("\(graphLayout.nodes.count) nodes").badgeStyle()
            }
            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Rectangle()
                        .fill(Color(nsColor: .windowBackgroundColor).opacity(0.001))
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .contentShape(Rectangle())

                    ZStack(alignment: .topLeading) {
                        Canvas { context, _ in
                            var path = Path()
                            for edge in graphLayout.edges {
                                guard let from = graphLayout.nodeMap[edge.from],
                                      let to = graphLayout.nodeMap[edge.to] else {
                                    continue
                                }
                                let start = CGPoint(x: from.position.x, y: from.position.y + graphLayout.nodeHeight / 2)
                                let end = CGPoint(x: to.position.x, y: to.position.y - graphLayout.nodeHeight / 2)
                                let controlOffset = max(36, (end.y - start.y) / 2)
                                path.move(to: start)
                                path.addCurve(
                                    to: end,
                                    control1: CGPoint(x: start.x, y: start.y + controlOffset),
                                    control2: CGPoint(x: end.x, y: end.y - controlOffset)
                                )
                            }
                            context.stroke(path, with: .color(Color(nsColor: .separatorColor)), lineWidth: 2)
                        }
                        .frame(width: graphLayout.size.width, height: graphLayout.size.height)

                        ForEach(graphLayout.nodes) { graphNode in
                            if let box = document.box(for: graphNode.id) {
                                PlotBoxCard(
                                    box: box,
                                    change: document.gitChange(for: box.path),
                                    selected: selectedId == graphNode.id,
                                    width: graphLayout.nodeWidth
                                ) {
                                    selectedId = graphNode.id
                                    selectedDataId = nil
                                } showGit: {
                                    showGitDiff(box.path)
                                }
                                .position(graphNode.position)
                            }
                        }
                    }
                    .frame(width: graphLayout.size.width, height: graphLayout.size.height)
                    .scaleEffect(zoom, anchor: .topLeading)
                    .offset(x: panOffset.width + dragOffset.width, y: panOffset.height + dragOffset.height)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                .clipped()
                .simultaneousGesture(
                    DragGesture(minimumDistance: 4)
                        .updating($dragOffset) { value, state, _ in
                            state = value.translation
                        }
                        .onEnded { value in
                            panOffset.width += value.translation.width
                            panOffset.height += value.translation.height
                        }
                )
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct PlotBoxCard: View {
    let box: BoxNode
    let change: GitChange?
    let selected: Bool
    var width: CGFloat = 320
    let select: () -> Void
    let showGit: () -> Void

    var body: some View {
        Button(action: select) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(box.name).font(.headline)
                    Spacer()
                    Text(box.boxType.isEmpty ? "box" : box.boxType).badgeStyle()
                    if let change {
                        GitPill(change: change)
                    }
                }
                Text(box.intent.isEmpty ? "No intent recorded." : box.intent)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                if change != nil {
                    Button("View Git Changes", action: showGit)
                        .font(.caption)
                }
            }
            .padding(14)
            .frame(width: width, alignment: .leading)
            .background(selected ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.22) : Color(nsColor: .controlBackgroundColor))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(gitColor(change?.status) ?? Color(nsColor: .separatorColor), lineWidth: change == nil ? 1 : 3))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

struct ProcessGraphNode: Identifiable {
    let id: String
    let position: CGPoint
}

struct ProcessGraphEdge: Identifiable {
    let from: String
    let to: String

    var id: String { "\(from)->\(to)" }
}

struct ProcessGraphLayout {
    let nodes: [ProcessGraphNode]
    let edges: [ProcessGraphEdge]
    let size: CGSize
    let nodeWidth: CGFloat
    let nodeHeight: CGFloat

    var nodeMap: [String: ProcessGraphNode] {
        Dictionary(uniqueKeysWithValues: nodes.map { ($0.id, $0) })
    }
}

func buildProcessGraphLayout(document: NativeProjectDocument, selectedId: String?, scope: PlotScope) -> ProcessGraphLayout {
    let nodeWidth: CGFloat = 320
    let nodeHeight: CGFloat = 128
    let xGap: CGFloat = 70
    let yGap: CGFloat = 88
    let padding: CGFloat = 48

    let levels = buildProcessGraphLevels(document: document, selectedId: selectedId, scope: scope)
    let maxLevelCount = max(levels.map(\.count).max() ?? 1, 1)
    let contentWidth = CGFloat(maxLevelCount) * nodeWidth + CGFloat(max(maxLevelCount - 1, 0)) * xGap
    let width = max(contentWidth + padding * 2, 760)
    let height = max(CGFloat(max(levels.count, 1)) * nodeHeight + CGFloat(max(levels.count - 1, 0)) * yGap + padding * 2, 520)

    var nodes: [ProcessGraphNode] = []
    for (levelIndex, level) in levels.enumerated() {
        let levelWidth = CGFloat(level.count) * nodeWidth + CGFloat(max(level.count - 1, 0)) * xGap
        let startX = padding + (contentWidth - levelWidth) / 2 + nodeWidth / 2
        let y = padding + nodeHeight / 2 + CGFloat(levelIndex) * (nodeHeight + yGap)
        for (index, id) in level.enumerated() {
            let x = startX + CGFloat(index) * (nodeWidth + xGap)
            nodes.append(ProcessGraphNode(id: id, position: CGPoint(x: x, y: y)))
        }
    }

    let visible = Set(nodes.map(\.id))
    let edges = document.boxes.values.flatMap { box in
        box.children.compactMap { child in
            visible.contains(box.id) && visible.contains(child) ? ProcessGraphEdge(from: box.id, to: child) : nil
        }
    }

    return ProcessGraphLayout(nodes: nodes, edges: edges, size: CGSize(width: width, height: height), nodeWidth: nodeWidth, nodeHeight: nodeHeight)
}

func buildProcessGraphLevels(document: NativeProjectDocument, selectedId: String?, scope: PlotScope) -> [[String]] {
    if scope == .selected, let selectedId, let selectedBox = document.box(for: selectedId) {
        let parents = document.boxes.values
            .filter { $0.children.contains(selectedId) }
            .map(\.id)
            .sorted()
        return [
            parents,
            [selectedId],
            selectedBox.children.sorted()
        ].filter { !$0.isEmpty }
    }

    var levels: [[String]] = []
    var visited: Set<String> = []
    var queue = document.rootIds.map { ($0, 0) }
    if queue.isEmpty {
        queue = document.sortedBoxes.map { ($0.id, 0) }
    }

    while !queue.isEmpty {
        let (id, depth) = queue.removeFirst()
        guard !visited.contains(id), let box = document.box(for: id) else {
            continue
        }
        visited.insert(id)
        while levels.count <= depth {
            levels.append([])
        }
        levels[depth].append(id)
        for child in box.children.sorted() {
            queue.append((child, depth + 1))
        }
    }

    return levels.isEmpty ? [[]] : levels
}

struct DataStructuresPlotView: View {
    let document: NativeProjectDocument
    @Binding var selectedDataId: String?
    @Binding var selectedBoxId: String?
    let showData: (DataNode) -> Void
    let showGitDiff: (String) -> Void
    @State private var panOffset: CGSize = .zero
    @State private var zoom: CGFloat = 1
    @GestureState private var dragOffset: CGSize = .zero

    var body: some View {
        Panel(title: "Data Structures Plot") {
            HStack {
                Button("−") { zoom = max(0.35, zoom - 0.15) }
                    .help("Zoom out")
                Button("+") { zoom = min(2.2, zoom + 0.15) }
                    .help("Zoom in")
                Button("Reset") {
                    zoom = 1
                    panOffset = .zero
                }
                Spacer()
                Text("\(document.sortedDataStructures.count) structures").badgeStyle()
            }
            GeometryReader { proxy in
                ZStack(alignment: .topLeading) {
                    Color.clear
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 4)
                                .updating($dragOffset) { value, state, _ in
                                    state = value.translation
                                }
                                .onEnded { value in
                                    panOffset.width += value.translation.width
                                    panOffset.height += value.translation.height
                                }
                        )

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 14)], spacing: 14) {
                        ForEach(document.sortedDataStructures) { data in
                            let change = document.gitChange(for: data.path)
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(data.name).font(.headline)
                                    Spacer()
                                    if let change { GitPill(change: change) }
                                }
                                if data.fields.isEmpty {
                                    Text("No fields detected")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .padding(.vertical, 3)
                                } else {
                                    ForEach(data.fields.prefix(8), id: \.self) { field in
                                        Text(field)
                                            .font(.caption)
                                            .padding(.vertical, 3)
                                    }
                                }
                                HStack {
                                    Button("Open") { showData(data) }
                                    if change != nil {
                                        Button("Git Changes") { showGitDiff(data.path) }
                                    }
                                }
                                .font(.caption)
                            }
                            .padding(14)
                            .frame(width: 280, alignment: .leading)
                            .background(selectedDataId == data.id.lowercased() ? Color(nsColor: .selectedContentBackgroundColor).opacity(0.22) : Color(nsColor: .controlBackgroundColor))
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(gitColor(change?.status) ?? Color(nsColor: .separatorColor), lineWidth: change == nil ? 1 : 3))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .contentShape(RoundedRectangle(cornerRadius: 8))
                            .onTapGesture {
                                selectedDataId = data.id.lowercased()
                                selectedBoxId = nil
                            }
                        }
                    }
                    .padding(18)
                    .frame(width: max(proxy.size.width, 760), alignment: .topLeading)
                    .scaleEffect(zoom, anchor: .topLeading)
                    .offset(x: panOffset.width + dragOffset.width, y: panOffset.height + dragOffset.height)
                }
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                .clipped()
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct DetailSection: View {
    let title: String
    let text: String
    let monospaced: Bool

    init(_ title: String, _ text: String, monospaced: Bool = false) {
        self.title = title
        self.text = text
        self.monospaced = monospaced
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption.weight(.bold))
            Text(text.isEmpty ? "None" : text)
                .font(monospaced ? .system(.caption, design: .monospaced) : .body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .detailCard()
    }
}

struct WarningList: View {
    let issues: [ValidationIssue]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if issues.isEmpty {
                Text("No validation warnings.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(issues) { issue in
                    Text(issue.message)
                        .font(.caption)
                        .foregroundStyle(issue.severity == "error" ? .red : .orange)
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(issue.severity == "error" ? Color.red.opacity(0.12) : Color.orange.opacity(0.14))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
        }
    }
}

struct EmptyState: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(20)
    }
}

enum AppModal: Identifiable {
    case data(DataNode)
    case git(path: String, change: GitChange?, diff: String)
    case chatResult(message: String, files: [String])
    case message(title: String, message: String)
    case discardConfirmation

    var id: String {
        switch self {
        case .data(let data): return "data-\(data.id)"
        case .git(let path, _, _): return "git-\(path)"
        case .chatResult: return "chat"
        case .message(let title, _): return "message-\(title)"
        case .discardConfirmation: return "discard"
        }
    }
}

struct ModalContent: View {
    let modal: AppModal
    let confirmDiscard: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(title).font(.headline)
                Spacer()
                Button("Close", action: close)
            }
            Divider()
            ScrollView {
                content
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(18)
        .frame(width: 760, height: 560)
    }

    private var title: String {
        switch modal {
        case .data(let data): return data.name
        case .git(let path, _, _): return "Git Changes: \(NativeProjectDocument.basenameWithoutExtension(path))"
        case .chatResult: return "ChatGPT Result"
        case .message(let title, _): return title
        case .discardConfirmation: return "Discard Changes"
        }
    }

    @ViewBuilder private var content: some View {
        switch modal {
        case .data(let data):
            Text(data.path).font(.caption).foregroundStyle(.secondary)
            DetailSection("Data Structure", data.rawText, monospaced: true)
        case .git(let path, let change, let diff):
            Text(path).font(.caption).foregroundStyle(.secondary)
            if let change { GitPill(change: change) }
            DiffView(diff: diff)
        case .chatResult(let message, let files):
            Text(message)
            DetailSection("Files Written", files.isEmpty ? "No files were written." : files.joined(separator: "\n"), monospaced: true)
        case .message(_, let message):
            Text(message).textSelection(.enabled)
        case .discardConfirmation:
            Text("Discard all uncommitted project changes? This cannot be undone.")
                .foregroundStyle(.red)
            HStack {
                Spacer()
                Button("Discard Changes", role: .destructive, action: confirmDiscard)
            }
        }
    }
}

struct DiffView: View {
    let diff: String

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(diff.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                Text(String(line).isEmpty ? " " : String(line))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(color(for: String(line)))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(background(for: String(line)))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
    }

    private func color(for line: String) -> Color {
        if line.hasPrefix("+"), !line.hasPrefix("+++") { return .green }
        if line.hasPrefix("-"), !line.hasPrefix("---") { return .red }
        if line.hasPrefix("@@") { return .blue }
        return .primary
    }

    private func background(for line: String) -> Color {
        if line.hasPrefix("+"), !line.hasPrefix("+++") { return Color.green.opacity(0.12) }
        if line.hasPrefix("-"), !line.hasPrefix("---") { return Color.red.opacity(0.12) }
        if line.hasPrefix("@@") { return Color.blue.opacity(0.08) }
        if line.hasPrefix("diff --git") || line.hasPrefix("index ") { return Color.gray.opacity(0.15) }
        return Color(nsColor: .textBackgroundColor)
    }
}

struct FlowLayout<Item: Hashable, Content: View>: View {
    let items: [Item]
    let content: (Item) -> Content

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { item in content(item) }
        }
    }
}

struct GitPill: View {
    let change: GitChange

    var body: some View {
        Text(change.label)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background((gitColor(change.status) ?? .orange).opacity(0.18))
            .foregroundStyle(gitColor(change.status) ?? .orange)
            .clipShape(Capsule())
    }
}

extension View {
    func badgeStyle() -> some View {
        self
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Color(nsColor: .quaternaryLabelColor))
            .clipShape(Capsule())
    }

    func detailCard() -> some View {
        self
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(nsColor: .separatorColor)))
    }
}

func gitColor(_ status: String?) -> Color? {
    switch status {
    case "added": return .green
    case "deleted": return .red
    case "renamed": return .blue
    case "untracked": return .gray
    case "modified": return .orange
    default: return nil
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        isEmpty ? fallback : self
    }
}

struct SettingsView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        Form {
            Section("OpenAI") {
                SecureField("OpenAI API token", text: $state.openAIAPIKey)
                TextField("Model", text: $state.openAIModel)
                Stepper(
                    "Request timeout: \(Int(state.openAITimeoutSeconds)) seconds",
                    value: $state.openAITimeoutSeconds,
                    in: 60...900,
                    step: 60
                )
                Button(state.isTestingOpenAI ? "Testing..." : "Test OpenAI Connection") {
                    state.testOpenAIConnection()
                }
                .disabled(state.isTestingOpenAI)
                Text(state.openAITestStatus)
                    .font(.caption)
                    .textSelection(.enabled)
                Text("Project generation can take several minutes. ChatGPT must return JSON with a files array. The app writes those files automatically and reloads the visualizer.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Project") {
                LabeledContent("Projects folder", value: state.projectsFolderURL?.path ?? "None")
                Text("This is the parent folder where generated apps are created. Open an existing app with File > Open Project Folder...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Button("Choose Projects Folder") {
                    state.chooseProjectsFolder()
                }
            }
        }
        .formStyle(.grouped)
        .padding()
    }
}
