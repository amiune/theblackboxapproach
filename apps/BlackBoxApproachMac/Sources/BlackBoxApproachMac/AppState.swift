import AppKit
import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var projectURL: URL?
    @Published var projectsFolderURL: URL?
    @Published var openAIAPIKey: String {
        didSet { UserDefaults.standard.set(openAIAPIKey, forKey: Self.apiKeyKey) }
    }
    @Published var openAIModel: String {
        didSet { UserDefaults.standard.set(openAIModel, forKey: Self.modelKey) }
    }
    @Published var openAITimeoutSeconds: Double {
        didSet { UserDefaults.standard.set(openAITimeoutSeconds, forKey: Self.timeoutKey) }
    }
    @Published var openAITestStatus: String = "Not tested."
    @Published var isTestingOpenAI: Bool = false

    private static let apiKeyKey = "BlackBoxApproachOpenAIAPIKey"
    private static let modelKey = "BlackBoxApproachOpenAIModel"
    private static let timeoutKey = "BlackBoxApproachOpenAITimeoutSeconds"
    private static let projectPathKey = "BlackBoxApproachProjectPath"
    private static let projectsFolderPathKey = "BlackBoxApproachProjectsFolderPath"

    private let openAIClient = OpenAIClient()

    init() {
        openAIAPIKey = UserDefaults.standard.string(forKey: Self.apiKeyKey) ?? ""
        openAIModel = UserDefaults.standard.string(forKey: Self.modelKey) ?? "gpt-5-mini"
        let savedTimeout = UserDefaults.standard.double(forKey: Self.timeoutKey)
        openAITimeoutSeconds = savedTimeout > 0 ? savedTimeout : 300

        if let savedPath = UserDefaults.standard.string(forKey: Self.projectPathKey) {
            projectURL = URL(fileURLWithPath: savedPath)
        }
        if let savedPath = UserDefaults.standard.string(forKey: Self.projectsFolderPathKey) {
            projectsFolderURL = URL(fileURLWithPath: savedPath)
        }
    }

    func chooseProjectsFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Choose Projects Folder"
        panel.message = "Choose the parent folder where new app projects should be created."

        if panel.runModal() == .OK, let url = panel.url {
            projectsFolderURL = url
            UserDefaults.standard.set(url.path, forKey: Self.projectsFolderPathKey)
        }
    }

    func openProjectFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Open Project"
        panel.message = "Choose a project folder. This folder becomes the current project shown in the visualizer."
        if let projectsFolderURL {
            panel.directoryURL = projectsFolderURL
        }

        if panel.runModal() == .OK, let url = panel.url {
            try? ProjectService().prepareProjectFolder(url, templateBlackboxesURL: Self.templateBlackboxesURL(), initGit: true)
            projectURL = url
            projectsFolderURL = url.deletingLastPathComponent()
            UserDefaults.standard.set(url.path, forKey: Self.projectPathKey)
            UserDefaults.standard.set(url.deletingLastPathComponent().path, forKey: Self.projectsFolderPathKey)
        }
    }

    func closeProject() {
        projectURL = nil
        UserDefaults.standard.removeObject(forKey: Self.projectPathKey)
    }

    func projectSnapshotPayload() async throws -> [String: Any] {
        guard let projectURL else {
            return [
                "status": "Choose or create a project.",
                "files": []
            ]
        }

        return try await Task.detached(priority: .userInitiated) {
            let projectService = ProjectService()
            let gitService = GitService()
            var files = try projectService.loadVisualizerFiles(from: projectURL)
            let git = try gitService.snapshot(for: projectURL)
            files.append(["path": "blackboxes/git_status.txt", "name": "git_status.txt", "text": git.status])
            files.append(["path": "blackboxes/git_diff.patch", "name": "git_diff.patch", "text": git.diff])

            return [
                "status": "\(files.count) files loaded from \(projectURL.lastPathComponent)",
                "files": files
            ]
        }.value
    }

    func sendPromptAndApplyFiles(_ prompt: String, selectedId: String?) async throws -> [String: Any] {
        let isExistingProjectModification = selectedId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        let workspaceURL: URL

        if isExistingProjectModification {
            guard let projectURL else {
                throw BlackBoxAppError.missingProject
            }
            if try GitService().hasUncommittedChanges(at: projectURL) {
                throw BlackBoxAppError.processFailed("This project has uncommitted changes. Commit or discard them before asking ChatGPT for another modification.")
            }
            workspaceURL = projectURL
        } else {
            workspaceURL = projectsFolderURL ?? Self.defaultProjectsFolder() ?? Self.toolingRoot() ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        }

        let answer = try await openAIClient.send(
            prompt: fileWritingPrompt(for: prompt, isExistingProjectModification: isExistingProjectModification),
            apiKey: openAIAPIKey,
            model: openAIModel,
            timeoutSeconds: openAITimeoutSeconds,
            requireJSONObject: true
        )
        let result = try ProjectService().applyChatGPTFileResponse(
            answer,
            in: workspaceURL,
            templateBlackboxesURL: Self.templateBlackboxesURL(),
            allowProjectCreation: !isExistingProjectModification
        )

        if let newProjectURL = result.projectURL {
            projectURL = newProjectURL
            UserDefaults.standard.set(newProjectURL.path, forKey: Self.projectPathKey)
        }

        return [
            "message": result.message,
            "writtenFiles": result.paths,
            "projectPath": result.projectURL?.path ?? workspaceURL.path,
            "answer": answer
        ]
    }

    func commitCurrentProject(message: String) async throws -> [String: Any] {
        guard let projectURL else {
            throw BlackBoxAppError.missingProject
        }
        let result = try await Task.detached(priority: .userInitiated) {
            try GitService().commitAll(at: projectURL, message: message)
        }.value
        return [
            "message": result,
            "projectPath": projectURL.path
        ]
    }

    func discardCurrentProjectChanges() async throws -> [String: Any] {
        guard let projectURL else {
            throw BlackBoxAppError.missingProject
        }
        let result = try await Task.detached(priority: .userInitiated) {
            try GitService().discardUncommittedChanges(at: projectURL)
        }.value
        return [
            "message": result,
            "projectPath": projectURL.path
        ]
    }

    func testOpenAIConnection() {
        Task {
            isTestingOpenAI = true
            openAITestStatus = "Testing OpenAI connection..."
            defer { isTestingOpenAI = false }

            do {
                let result = try await openAIClient.send(
                    prompt: "Return exactly: OK",
                    apiKey: openAIAPIKey,
                    model: openAIModel,
                    timeoutSeconds: min(openAITimeoutSeconds, 60),
                    requireJSONObject: false
                )
                openAITestStatus = "Connected. Response: \(result.trimmingCharacters(in: .whitespacesAndNewlines))"
            } catch {
                openAITestStatus = "Failed: \(error.localizedDescription)"
            }
        }
    }

    private func fileWritingPrompt(for prompt: String, isExistingProjectModification: Bool) -> String {
        let projectModeRules = isExistingProjectModification
            ? """
            This is a modification to the currently open project.
            Do NOT include project.path in the JSON response.
            Do NOT create a new project directory.
            All file paths must be relative to the current project root.
            """
            : """
            The user-selected Projects Folder is already the parent directory for apps.
            For a brand-new app or product, project.path MUST be only the new app directory name, for example "simple-notepad".
            Do NOT prefix project.path with "projects/".
            Do NOT use nested project paths.
            Do NOT prefix file paths with the project directory name. If project.path is "simple-notepad", write "blackboxes/system.yaml", not "simple-notepad/blackboxes/system.yaml".
            Each app must have its own directory, its own blackboxes/ directory, and its own .git directory.
            If project.path is present, file paths are relative to that app project directory.
            """

        return """
        \(prompt)

        Return only JSON, with no markdown fences and no prose outside the JSON.
        The JSON schema is:
        {
          "message": "short summary",
          "project": {
            "path": "my-app",
            "init_git": true
          },
          "files": [
            {
              "path": "relative/path/from/project/root",
              "content": "complete file contents"
            }
          ]
        }
        The project object is only for brand-new projects. Omit project when editing the currently open project.

        \(projectModeRules)
        If project.path is omitted, file paths are relative to the currently selected project.
        Write every box, data structure, code file, documentation file, or other project file that must change.
        Do not use absolute paths. Do not include parent directory traversal.

        BlackBox graph requirements for new apps:
        - Create blackboxes/system.yaml with root_box set to the root box id.
        - Every file in blackboxes/boxes/ must be a valid box YAML with id, name, kind, box_type, state, provenance, human_summary, ai_reasoning, signature, intent, algorithm, children, contracts, referenced_data, and implementation.
        - children must list child box ids only, never paths, never filenames, and never .yaml suffixes.
        - Box file names should match ids, for example child id "render_page" goes in blackboxes/boxes/render_page.yaml.
        - The root box must be abstract. Its name must match the app/project name from project.path in readable title case.
        - The root intent and summary must be a plain-language resume of the user's project creation request, not an input/process/output formula.
        - Box names and intents must be easy for non-technical people to read, especially intermediate abstract boxes. Prefer product/user language over implementation jargon.
        - The root algorithm should decompose into major child calls using readable responsibility names.
        - Refine children recursively until the leaf boxes contain actual executable programming code in implementation.code.
        - Non-leaf abstract or partial boxes may have empty implementation.code, but every leaf box must have executable implementation.code.
        - Also create real code files such as index.html, app.js, and style.css when building a static web app.
        - Implementation code inside leaf boxes must correspond to the real code files.
        - Use blackboxes/data/ for shared input, state, and output data structures.
        - Every file in blackboxes/data/ MUST be a valid data_structure YAML, not a black_box YAML.
        - Data structure YAML MUST use kind: data_structure and MUST include a top-level fields array.
        - Do NOT describe data schema fields inside implementation.code comments. Data structures do not use implementation.code.
        - Each data field must include name, type, provenance, human_summary, and ai_reasoning.
        - Always create or update blackboxes/history/provenance_log.yaml.
        - provenance_log.yaml MUST NOT be empty. It must include an entries array with at least one entry for this response.
        - For modifications, preserve existing history entries and append new entries.
        - Each provenance entry must include timestamp, actor, action, affected_files, summary, and provenance_notes.

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

        Canonical provenance log YAML shape:
        entries:
          - timestamp: "2026-06-02T00:00:00Z"
            actor: ai_assistant
            action: created_project
            affected_files:
              - blackboxes/system.yaml
              - blackboxes/boxes/root.yaml
              - blackboxes/data/note_schema.yaml
              - index.html
            summary: Created the initial project graph and app files.
            provenance_notes: Marked generated boxes, fields, and implementation assumptions as ai_defined.
        """
    }

    private static func toolingRoot() -> URL? {
        if let resourceURL = Bundle.main.resourceURL {
            let bundledSchema = resourceURL.appendingPathComponent("templates/blackbox-project/blackboxes/schema/blackbox.schema.json")
            if FileManager.default.fileExists(atPath: bundledSchema.path) {
                return resourceURL
            }
        }

        var url = URL(fileURLWithPath: FileManager.default.currentDirectoryPath).standardizedFileURL
        for _ in 0..<8 {
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("templates/blackbox-project/blackboxes/schema/blackbox.schema.json").path) {
                return url
            }
            let parent = url.deletingLastPathComponent()
            if parent.path == url.path {
                break
            }
            url = parent
        }
        return nil
    }

    private static func templateBlackboxesURL() -> URL? {
        toolingRoot()?.appendingPathComponent("templates/blackbox-project/blackboxes")
    }

    private static func defaultProjectsFolder() -> URL? {
        toolingRoot()?.appendingPathComponent("projects")
    }
}
