import Foundation

enum BlackBoxAppError: LocalizedError {
    case missingProject
    case invalidRelativePath(String)
    case processFailed(String)
    case missingAPIKey
    case invalidOpenAIResponse
    case requestTimedOut(Double)
    case networkUnavailable(String)

    var errorDescription: String? {
        switch self {
        case .missingProject:
            return "Choose a project folder first."
        case .invalidRelativePath(let path):
            return "The path must stay inside the selected project: \(path)"
        case .processFailed(let message):
            return message
        case .missingAPIKey:
            return "Add an OpenAI API token in Settings before sending a prompt."
        case .invalidOpenAIResponse:
            return "The OpenAI response did not include readable text."
        case .requestTimedOut(let seconds):
            return "The OpenAI request timed out after \(Int(seconds)) seconds. Try again, increase the timeout in Settings, or use a faster model."
        case .networkUnavailable(let message):
            return "The app could not reach OpenAI: \(message)"
        }
    }
}

final class ProjectService {
    private let fileManager = FileManager.default

    func prepareProjectFolder(_ projectURL: URL, templateBlackboxesURL: URL?, initGit: Bool) throws {
        try fileManager.createDirectory(at: projectURL, withIntermediateDirectories: true)
        try seedBlackboxesTemplateIfNeeded(in: projectURL, templateBlackboxesURL: templateBlackboxesURL)
        if initGit {
            try GitService().initializeRepositoryIfNeeded(at: projectURL)
        }
    }

    func loadVisualizerFiles(from root: URL) throws -> [[String: String]] {
        let urls = try recursiveFiles(at: root)
            .filter { isSnapshotLoadable($0, root: root) }
            .sorted { relativePath(for: $0, root: root) < relativePath(for: $1, root: root) }

        return try urls.map { url in
            [
                "path": relativePath(for: url, root: root),
                "name": url.lastPathComponent,
                "text": try String(contentsOf: url, encoding: .utf8)
            ]
        }
    }

    func applyChatGPTFileResponse(_ response: String, in root: URL, templateBlackboxesURL: URL?, allowProjectCreation: Bool) throws -> AppliedFilesResult {
        let object = try parseFileResponse(response)
        let message = object["message"] as? String ?? "Files applied from ChatGPT response."
        guard let files = object["files"] as? [[String: Any]] else {
            throw BlackBoxAppError.processFailed("ChatGPT response must contain a files array.")
        }

        let projectInfo = object["project"] as? [String: Any]
        let projectURL = allowProjectCreation ? try resolveProjectURL(projectInfo: projectInfo, root: root) : nil
        let targetRoot = projectURL ?? root

        if let projectURL {
            try prepareProjectFolder(
                projectURL,
                templateBlackboxesURL: templateBlackboxesURL,
                initGit: (projectInfo?["init_git"] as? Bool) ?? true
            )
        }

        var writtenPaths: [String] = []
        for file in files {
            guard let path = file["path"] as? String,
                  let contents = file["content"] as? String else {
                continue
            }

            let normalizedPath = normalizeResponseFilePath(path, projectDirectoryName: targetRoot.lastPathComponent)
            let url = try safeURL(relativePath: normalizedPath, in: targetRoot)
            try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try contents.write(to: url, atomically: true, encoding: .utf8)
            writtenPaths.append(normalizedPath)
        }

        return AppliedFilesResult(message: message, paths: writtenPaths, projectURL: projectURL)
    }

    private func recursiveFiles(at root: URL) throws -> [URL] {
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return []
        }

        return try enumerator.compactMap { item in
            guard let url = item as? URL else { return nil }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey])
            return values.isRegularFile == true ? url : nil
        }
    }

    private func isSnapshotLoadable(_ url: URL, root: URL) -> Bool {
        let relative = relativePath(for: url, root: root)
        let ext = url.pathExtension.lowercased()
        let ignoredPrefixes = [".git/", "node_modules/", ".build/", "dist/", "build/"]
        if ignoredPrefixes.contains(where: { relative.hasPrefix($0) }) {
            return false
        }
        if relative == "blackboxes/system.yaml" {
            return true
        }
        if relative == "blackboxes/git_status.txt" || relative == "blackboxes/git_diff.patch" {
            return true
        }
        if relative.hasPrefix("blackboxes/boxes/") || relative.hasPrefix("blackboxes/data/") {
            return ["yaml", "yml", "json"].contains(ext)
        }
        return isRelevantCodeFile(relative: relative, ext: ext)
    }

    private func isRelevantCodeFile(relative: String, ext: String) -> Bool {
        if relative.hasPrefix("blackboxes/") {
            return false
        }
        let allowedExtensions = [
            "html", "css", "js", "mjs", "ts", "tsx", "jsx",
            "swift", "py", "java", "kt", "go", "rs", "c", "cpp", "h",
            "json", "md"
        ]
        let allowedRootFiles = ["index.html", "app.js", "script.js", "style.css", "styles.css"]
        return allowedExtensions.contains(ext) || allowedRootFiles.contains(relative)
    }

    private func parseFileResponse(_ response: String) throws -> [String: Any] {
        let jsonText = extractJSONObject(from: response)
        guard let data = jsonText.data(using: .utf8) else {
            throw BlackBoxAppError.processFailed("ChatGPT returned text that cannot be encoded as UTF-8.")
        }

        do {
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw BlackBoxAppError.processFailed("ChatGPT must return a JSON object with message and files. Raw response: \(shortExcerpt(response))")
            }
            return object
        } catch let error as BlackBoxAppError {
            throw error
        } catch {
            throw BlackBoxAppError.processFailed("ChatGPT returned invalid file JSON: \(error.localizedDescription). Raw response: \(shortExcerpt(response))")
        }
    }

    private func extractJSONObject(from response: String) -> String {
        let trimmed = response.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{"), trimmed.hasSuffix("}") {
            return trimmed
        }

        if let fenceStart = trimmed.range(of: "```") {
            let afterFence = trimmed[fenceStart.upperBound...]
            let withoutLanguage: Substring
            if let newline = afterFence.firstIndex(of: "\n") {
                withoutLanguage = afterFence[afterFence.index(after: newline)...]
            } else {
                withoutLanguage = afterFence
            }
            if let fenceEnd = withoutLanguage.range(of: "```") {
                return String(withoutLanguage[..<fenceEnd.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }

        guard let start = trimmed.firstIndex(of: "{"),
              let end = trimmed.lastIndex(of: "}") else {
            return trimmed
        }
        return String(trimmed[start...end])
    }

    private func resolveProjectURL(projectInfo: [String: Any]?, root: URL) throws -> URL? {
        guard let path = projectInfo?["path"] as? String,
              !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        let normalized = normalizedProjectDirectoryName(path)
        guard !normalized.isEmpty else {
            throw BlackBoxAppError.invalidRelativePath(path)
        }
        let requestedURL = try safeURL(relativePath: normalized, in: root)
        return uniqueAvailableProjectURL(for: requestedURL)
    }

    private func normalizedProjectDirectoryName(_ path: String) -> String {
        var trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        trimmed = trimmed.replacingOccurrences(of: "\\", with: "/")
        if trimmed.lowercased().hasPrefix("projects/") {
            trimmed = String(trimmed.dropFirst("projects/".count))
        }
        return trimmed
            .split(separator: "/")
            .first
            .map(String.init) ?? ""
    }

    private func normalizeResponseFilePath(_ path: String, projectDirectoryName: String) -> String {
        var trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        trimmed = trimmed.replacingOccurrences(of: "\\", with: "/")
        while trimmed.hasPrefix("./") {
            trimmed = String(trimmed.dropFirst(2))
        }
        if trimmed.lowercased().hasPrefix("projects/") {
            trimmed = String(trimmed.dropFirst("projects/".count))
        }
        if trimmed == projectDirectoryName {
            return ""
        }
        if trimmed.hasPrefix(projectDirectoryName + "/") {
            trimmed = String(trimmed.dropFirst(projectDirectoryName.count + 1))
        }
        return trimmed
    }

    private func uniqueAvailableProjectURL(for requestedURL: URL) -> URL {
        guard fileManager.fileExists(atPath: requestedURL.path) else {
            return requestedURL
        }

        let parent = requestedURL.deletingLastPathComponent()
        let baseName = requestedURL.lastPathComponent
        var suffix = 2
        while true {
            let candidate = parent.appendingPathComponent("\(baseName)-\(suffix)")
            if !fileManager.fileExists(atPath: candidate.path) {
                return candidate
            }
            suffix += 1
        }
    }

    private func seedBlackboxesTemplateIfNeeded(in projectURL: URL, templateBlackboxesURL: URL?) throws {
        let targetBlackboxes = projectURL.appendingPathComponent("blackboxes")
        guard !fileManager.fileExists(atPath: targetBlackboxes.path),
              let templateBlackboxesURL else {
            return
        }
        try copyTemplateBlackboxes(from: templateBlackboxesURL, to: targetBlackboxes)
    }

    private func copyTemplateBlackboxes(from source: URL, to destination: URL) throws {
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)
        guard let enumerator = fileManager.enumerator(
            at: source,
            includingPropertiesForKeys: [.isDirectoryKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        ) else {
            return
        }

        for case let url as URL in enumerator {
            let relative = relativePath(for: url, root: source)
            if relative == "visualizer" || relative.hasPrefix("visualizer/") || url.lastPathComponent == ".DS_Store" {
                if url.lastPathComponent == "visualizer" {
                    enumerator.skipDescendants()
                }
                continue
            }

            let target = destination.appendingPathComponent(relative)
            let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey])
            if values.isDirectory == true {
                try fileManager.createDirectory(at: target, withIntermediateDirectories: true)
            } else if values.isRegularFile == true {
                try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                if fileManager.fileExists(atPath: target.path) {
                    try fileManager.removeItem(at: target)
                }
                try fileManager.copyItem(at: url, to: target)
            }
        }
    }

    private func safeURL(relativePath: String, in root: URL) throws -> URL {
        let trimmed = relativePath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !trimmed.hasPrefix("/") else {
            throw BlackBoxAppError.invalidRelativePath(relativePath)
        }

        let url = root.appendingPathComponent(trimmed).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        guard url.path == rootPath || url.path.hasPrefix(rootPath + "/") else {
            throw BlackBoxAppError.invalidRelativePath(relativePath)
        }
        return url
    }

    private func relativePath(for url: URL, root: URL) -> String {
        let rootPath = root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        guard path.hasPrefix(rootPath + "/") else { return url.lastPathComponent }
        return String(path.dropFirst(rootPath.count + 1))
    }

    private func shortExcerpt(_ text: String) -> String {
        let compact = text
            .replacingOccurrences(of: "\n", with: "\\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if compact.count <= 1200 {
            return compact
        }
        return String(compact.prefix(1200)) + "... [truncated]"
    }
}

final class GitService {
    private let maxGitTextBytes = 600_000

    func snapshot(for root: URL) throws -> GitSnapshot {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else {
            return GitSnapshot(status: "No .git directory found in this project.", diff: "")
        }

        let status = try statusText(for: root)
        let diff = try combinedDiff(for: root, status: status)
        return GitSnapshot(
            status: normalizedGitText(status, emptyMessage: "Relevant working copy clean."),
            diff: normalizedGitText(diff, emptyMessage: "No relevant unstaged diff.")
        )
    }

    func initializeRepositoryIfNeeded(at root: URL) throws {
        guard !FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else {
            return
        }
        _ = try runGit(["init"], in: root)
    }

    func hasUncommittedChanges(at root: URL) throws -> Bool {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else {
            return false
        }
        return !(try statusText(for: root).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    func commitAll(at root: URL, message: String) throws -> String {
        try initializeRepositoryIfNeeded(at: root)
        _ = try runGit(["add", "-A"], in: root)
        if !(try hasUncommittedChanges(at: root)) {
            return "No changes to commit."
        }

        let commitMessage = message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Save BlackBoxApproach changes"
            : message.trimmingCharacters(in: .whitespacesAndNewlines)
        let result = try runGit([
            "-c", "user.name=BlackBoxApproach",
            "-c", "user.email=blackboxapproach@example.local",
            "commit",
            "-m", commitMessage
        ], in: root)
        return normalizedGitText(result, emptyMessage: "Changes committed.")
    }

    func discardUncommittedChanges(at root: URL) throws -> String {
        guard FileManager.default.fileExists(atPath: root.appendingPathComponent(".git").path) else {
            return "No .git directory found."
        }

        if hasHead(at: root) {
            _ = try runGit(["reset", "--hard", "HEAD"], in: root)
        }
        _ = try runGit(["clean", "-fd"], in: root)
        return "Uncommitted changes discarded."
    }

    private func statusText(for root: URL) throws -> String {
        try runGit(["status", "--porcelain", "-uall", "--", "."], in: root)
    }

    private func combinedDiff(for root: URL, status: String) throws -> String {
        var chunks: [String] = []
        let unstaged = try runGit(["diff", "--", "."], in: root).trimmingCharacters(in: .whitespacesAndNewlines)
        let staged = try runGit(["diff", "--cached", "--", "."], in: root).trimmingCharacters(in: .whitespacesAndNewlines)

        if !unstaged.isEmpty {
            chunks.append(unstaged)
        }
        if !staged.isEmpty {
            chunks.append(staged)
        }

        let untracked = untrackedPaths(from: status)
        for path in untracked {
            if let diff = untrackedDiff(for: path, root: root), !diff.isEmpty {
                chunks.append(diff)
            }
        }

        return truncate(chunks.joined(separator: "\n"))
    }

    private func untrackedPaths(from status: String) -> [String] {
        status.split(separator: "\n").compactMap { line in
            guard line.hasPrefix("?? ") else { return nil }
            return String(line.dropFirst(3))
        }
    }

    private func untrackedDiff(for path: String, root: URL) -> String? {
        let url = root.appendingPathComponent(path).standardizedFileURL
        guard url.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else {
            return nil
        }

        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        let body = lines.map { "+" + $0 }.joined(separator: "\n")
        return [
            "diff --git a/\(path) b/\(path)",
            "new file mode 100644",
            "index 0000000..0000000",
            "--- /dev/null",
            "+++ b/\(path)",
            "@@ -0,0 +1,\(max(lines.count, 1)) @@",
            body
        ].joined(separator: "\n")
    }

    private func hasHead(at root: URL) -> Bool {
        do {
            _ = try runGit(["rev-parse", "--verify", "HEAD"], in: root)
            return true
        } catch {
            return false
        }
    }

    private func runGit(_ arguments: [String], in root: URL) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.currentDirectoryURL = root
        process.arguments = arguments

        let output = Pipe()
        let error = Pipe()
        process.standardOutput = output
        process.standardError = error

        try process.run()
        process.waitUntilExit()

        let outputData = output.fileHandleForReading.readDataToEndOfFile()
        let errorData = error.fileHandleForReading.readDataToEndOfFile()
        let outputText = String(data: outputData, encoding: .utf8) ?? ""
        let errorText = String(data: errorData, encoding: .utf8) ?? ""

        guard process.terminationStatus == 0 else {
            throw BlackBoxAppError.processFailed(errorText.isEmpty ? "git \(arguments.joined(separator: " ")) failed." : errorText)
        }

        return truncate(outputText)
    }

    private func normalizedGitText(_ text: String, emptyMessage: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? emptyMessage : trimmed
    }

    private func truncate(_ text: String) -> String {
        guard let data = text.data(using: .utf8), data.count > maxGitTextBytes else {
            return text
        }

        let truncatedData = data.prefix(maxGitTextBytes)
        let truncated = String(decoding: truncatedData, as: UTF8.self)
        return truncated + "\n\n[Git output truncated by the macOS app to keep the visualizer responsive.]"
    }
}

final class OpenAIClient {
    func send(prompt: String, apiKey: String, model: String, timeoutSeconds: Double, requireJSONObject: Bool) async throws -> String {
        guard !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw BlackBoxAppError.missingAPIKey
        }

        guard let url = URL(string: "https://api.openai.com/v1/responses") else {
            throw BlackBoxAppError.invalidOpenAIResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeoutSeconds
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = [
            "model": model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "gpt-5-mini" : model,
            "input": prompt
        ]

        if requireJSONObject {
            body["text"] = [
                "format": [
                    "type": "json_object"
                ]
            ]
        }

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeoutSeconds
        configuration.timeoutIntervalForResource = max(timeoutSeconds, 600)
        let session = URLSession(configuration: configuration)

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            let nsError = error as NSError
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorTimedOut {
                throw BlackBoxAppError.requestTimedOut(timeoutSeconds)
            }
            if nsError.domain == NSURLErrorDomain {
                throw BlackBoxAppError.networkUnavailable(nsError.localizedDescription)
            }
            throw error
        }
        if let httpResponse = response as? HTTPURLResponse, !(200..<300).contains(httpResponse.statusCode) {
            let message = String(data: data, encoding: .utf8) ?? "OpenAI request failed with status \(httpResponse.statusCode)."
            throw BlackBoxAppError.processFailed(message)
        }

        let object: Any
        do {
            object = try JSONSerialization.jsonObject(with: data)
        } catch {
            let body = String(data: data, encoding: .utf8) ?? "<non-UTF8 response>"
            throw BlackBoxAppError.processFailed("OpenAI returned a response the app could not parse: \(error.localizedDescription). Body: \(shortExcerpt(body))")
        }
        guard let dictionary = object as? [String: Any] else {
            throw BlackBoxAppError.invalidOpenAIResponse
        }

        if let responseError = dictionary["error"] as? [String: Any],
           let message = responseError["message"] as? String {
            throw BlackBoxAppError.processFailed("OpenAI response error: \(message)")
        }

        if let outputText = dictionary["output_text"] as? String, !outputText.isEmpty {
            return outputText
        }

        if let output = dictionary["output"] as? [[String: Any]] {
            let text = output.flatMap { item -> [String] in
                guard let content = item["content"] as? [[String: Any]] else { return [] }
                return content.compactMap { piece in
                    if let text = piece["text"] as? String {
                        return text
                    }
                    if let text = piece["output_text"] as? String {
                        return text
                    }
                    return nil
                }
            }.joined(separator: "\n")

            if !text.isEmpty {
                return text
            }
        }

        throw BlackBoxAppError.invalidOpenAIResponse
    }

    private func shortExcerpt(_ text: String) -> String {
        let compact = text
            .replacingOccurrences(of: "\n", with: "\\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if compact.count <= 1200 {
            return compact
        }
        return String(compact.prefix(1200)) + "... [truncated]"
    }
}
