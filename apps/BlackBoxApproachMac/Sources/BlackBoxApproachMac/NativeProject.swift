import Foundation

enum YamlNode: Equatable {
    case map([String: YamlNode])
    case array([YamlNode])
    case scalar(String)
    case bool(Bool)
    case number(Double)
    case null

    var mapValue: [String: YamlNode]? {
        if case .map(let value) = self { return value }
        return nil
    }

    var arrayValue: [YamlNode]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var stringValue: String? {
        switch self {
        case .scalar(let value):
            return value
        case .bool(let value):
            return value ? "true" : "false"
        case .number(let value):
            return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
        case .null:
            return nil
        case .map, .array:
            return nil
        }
    }
}

struct ProjectFile: Identifiable {
    let id = UUID()
    let path: String
    let name: String
    let text: String
}

struct BoxNode: Identifiable {
    let id: String
    let path: String
    let rawText: String
    let data: [String: YamlNode]

    var name: String { string("name") ?? id }
    var kind: String { string("kind") ?? "" }
    var boxType: String { string("box_type") ?? "" }
    var state: String { string("state") ?? "" }
    var provenance: String { string("provenance") ?? "" }
    var humanSummary: String { string("human_summary") ?? "" }
    var aiReasoning: String { string("ai_reasoning") ?? "" }
    var intent: String { string("intent") ?? "" }
    var algorithm: String { string("algorithm") ?? "" }
    var implementationCode: String {
        data["implementation"]?.mapValue?["code"]?.stringValue ?? ""
    }
    var children: [String] {
        NativeProjectDocument.stringArray(from: data["children"])
    }
    var referencedData: [String] {
        NativeProjectDocument.stringArray(from: data["referenced_data"])
    }
    var signature: YamlNode? { data["signature"] }
    var contracts: YamlNode? { data["contracts"] }

    func string(_ key: String) -> String? {
        data[key]?.stringValue
    }
}

struct DataNode: Identifiable {
    let id: String
    let path: String
    let rawText: String
    let data: [String: YamlNode]

    var name: String { data["name"]?.stringValue ?? id }
    var provenance: String { data["provenance"]?.stringValue ?? "" }
    var implementationCode: String {
        data["implementation"]?.mapValue?["code"]?.stringValue ?? ""
    }
    var fields: [String] {
        let explicitFields = (data["fields"]?.arrayValue ?? []).compactMap { item in
            if let map = item.mapValue {
                let name = map["name"]?.stringValue ?? map["id"]?.stringValue ?? map["key"]?.stringValue
                let type = map["type"]?.stringValue
                if let name, let type, !type.isEmpty {
                    return "\(name): \(type)"
                }
                return name
            }
            return item.stringValue
        }
        if !explicitFields.isEmpty {
            return explicitFields
        }
        return Self.fieldsFromImplementationCode(implementationCode)
    }

    private static func fieldsFromImplementationCode(_ code: String) -> [String] {
        code.split(separator: "\n").compactMap { rawLine in
            var line = String(rawLine).trimmingCharacters(in: .whitespacesAndNewlines)
            while line.hasPrefix("#") {
                line = String(line.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let colon = line.firstIndex(of: ":") else {
                return nil
            }
            let key = line[..<colon].trimmingCharacters(in: .whitespacesAndNewlines)
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, !value.isEmpty else {
                return nil
            }
            return "\(key): \(value)"
        }
    }
}

struct GitChange: Identifiable {
    let id: String
    let path: String
    let status: String
    let label: String
}

struct ValidationIssue: Identifiable {
    let id = UUID()
    let severity: String
    let message: String
}

struct NativeProjectDocument {
    var files: [ProjectFile] = []
    var boxes: [String: BoxNode] = [:]
    var dataStructures: [String: DataNode] = [:]
    var rootBoxId: String?
    var gitChanges: [String: GitChange] = [:]
    var gitDiffs: [String: String] = [:]
    var validation: [ValidationIssue] = []
    var status: String = "No project loaded"

    var sortedBoxes: [BoxNode] {
        boxes.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var sortedDataStructures: [DataNode] {
        dataStructures.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var rootIds: [String] {
        if let rootBoxId, boxes[rootBoxId] != nil {
            return [rootBoxId]
        }
        let childIds = Set(boxes.values.flatMap(\.children))
        let roots = boxes.keys.filter { !childIds.contains($0) }.sorted()
        return roots.isEmpty ? boxes.keys.sorted() : roots
    }

    var hasPendingGitChanges: Bool {
        !gitChanges.isEmpty
    }

    static func from(payload: [String: Any]) -> NativeProjectDocument {
        let rawFiles = payload["files"] as? [[String: String]] ?? []
        var document = NativeProjectDocument()
        document.status = payload["status"] as? String ?? "Project loaded"
        document.files = rawFiles.map {
            ProjectFile(path: normalizePath($0["path"] ?? ""), name: $0["name"] ?? "", text: $0["text"] ?? "")
        }

        for file in document.files {
            if isGitStatusFile(file.path) {
                document.parseGitStatus(file.text)
                continue
            }
            if isGitDiffFile(file.path) {
                document.parseGitDiff(file.text)
                continue
            }

            let parsed = YamlLite.parse(file.text).mapValue ?? [:]
            if isSystemFile(file.path, parsed) {
                document.rootBoxId = parsed["root_box"]?.stringValue
            } else if isBoxFile(file.path, parsed) {
                let id = parsed["id"]?.stringValue ?? basenameWithoutExtension(file.path)
                document.boxes[id] = BoxNode(id: id, path: file.path, rawText: file.text, data: parsed)
            } else if isDataFile(file.path, parsed) {
                let id = parsed["id"]?.stringValue ?? basenameWithoutExtension(file.path)
                let dataNode = DataNode(id: id, path: file.path, rawText: file.text, data: parsed)
                document.dataStructures[id.lowercased()] = dataNode
                document.dataStructures[basenameWithoutExtension(file.path).lowercased()] = dataNode
                document.dataStructures[dataNode.name.lowercased()] = dataNode
            }
        }

        document.validate()
        return document
    }

    static func stringArray(from node: YamlNode?) -> [String] {
        guard let node else { return [] }
        switch node {
        case .array(let values):
            return values.compactMap(\.stringValue)
        case .scalar(let value):
            return value.isEmpty ? [] : [value]
        default:
            return []
        }
    }

    func box(for id: String?) -> BoxNode? {
        guard let id else { return nil }
        return boxes[id]
    }

    func gitChange(for path: String) -> GitChange? {
        gitChanges[Self.normalizePath(path)]
    }

    func diff(for path: String) -> String {
        gitDiffs[Self.normalizePath(path)] ?? "No unified diff was loaded for this path."
    }

    func dataNode(for ref: String) -> DataNode? {
        dataStructures[ref.lowercased()] ?? dataStructures[Self.basenameWithoutExtension(ref).lowercased()]
    }

    mutating private func validate() {
        validation.removeAll()
        if rootBoxId == nil {
            validation.append(ValidationIssue(severity: "error", message: "blackboxes/system.yaml is missing root_box."))
        }

        for box in boxes.values {
            for required in ["id", "kind", "box_type", "state", "intent", "algorithm"] where box.data[required] == nil {
                validation.append(ValidationIssue(severity: "warning", message: "\(box.id) is missing \(required)."))
            }
            for child in box.children where boxes[child] == nil {
                validation.append(ValidationIssue(severity: "warning", message: "\(box.id) lists missing child \(child)."))
            }
            if box.children.isEmpty && box.implementationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                validation.append(ValidationIssue(severity: "warning", message: "\(box.id) is a leaf box without executable implementation.code."))
            }
        }
    }

    mutating private func parseGitStatus(_ text: String) {
        for line in text.split(separator: "\n") {
            guard line.count >= 4 else { continue }
            let chars = Array(line)
            guard chars[2] == " " else { continue }
            let statusCode = String(chars[0...1])
            var path = String(line.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
            if let range = path.range(of: " -> ", options: .backwards) {
                path = String(path[range.upperBound...])
            }
            path = Self.normalizePath(path)
            guard !path.isEmpty else { continue }
            let kind = Self.gitStatusKind(statusCode)
            gitChanges[path] = GitChange(id: path, path: path, status: kind, label: Self.gitStatusLabel(kind))
        }
    }

    mutating private func parseGitDiff(_ text: String) {
        var currentPath: String?
        var buffer: [String] = []

        func flush() {
            if let currentPath {
                gitDiffs[currentPath] = buffer.joined(separator: "\n")
            }
        }

        for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
            if let match = line.range(of: #"^diff --git a/(.+?) b/(.+)$"#, options: .regularExpression) {
                flush()
                let header = String(line[match])
                let pieces = header.replacingOccurrences(of: "diff --git a/", with: "").components(separatedBy: " b/")
                currentPath = pieces.last.map(Self.normalizePath)
                buffer = [line]
            } else if currentPath != nil {
                buffer.append(line)
            }
        }
        flush()
    }

    private static func isSystemFile(_ path: String, _ parsed: [String: YamlNode]) -> Bool {
        path.hasSuffix("system.yaml") || path.hasSuffix("system.yml") || parsed["kind"]?.stringValue == "black_box_system"
    }

    private static func isBoxFile(_ path: String, _ parsed: [String: YamlNode]) -> Bool {
        parsed["kind"]?.stringValue == "black_box" || path.contains("/boxes/")
    }

    private static func isDataFile(_ path: String, _ parsed: [String: YamlNode]) -> Bool {
        parsed["kind"]?.stringValue == "data_structure" || path.contains("/data/")
    }

    private static func isGitStatusFile(_ path: String) -> Bool {
        path.hasSuffix("git_status.txt") || path.hasSuffix("git-status.txt")
    }

    private static func isGitDiffFile(_ path: String) -> Bool {
        path.hasSuffix("git_diff.patch") || path.hasSuffix("git_diff.diff") || path.hasSuffix("git-diff.patch") || path.hasSuffix("git-diff.diff")
    }

    static func normalizePath(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func basenameWithoutExtension(_ path: String) -> String {
        URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    }

    private static func gitStatusKind(_ code: String) -> String {
        if code.contains("?") { return "untracked" }
        if code.contains("A") { return "added" }
        if code.contains("D") { return "deleted" }
        if code.contains("R") { return "renamed" }
        return "modified"
    }

    private static func gitStatusLabel(_ status: String) -> String {
        switch status {
        case "added": return "Added"
        case "deleted": return "Deleted"
        case "renamed": return "Renamed"
        case "untracked": return "Untracked"
        default: return "Modified"
        }
    }
}

enum YamlLite {
    private struct Line {
        let raw: String
        let indent: Int
    }

    static func parse(_ text: String) -> YamlNode {
        let lines = text.replacingOccurrences(of: "\r", with: "").split(separator: "\n", omittingEmptySubsequences: false).map {
            let raw = String($0)
            return Line(raw: raw, indent: raw.prefix { $0 == " " }.count)
        }
        let parser = Parser(lines: lines)
        return parser.parseNode(index: 0, indent: 0).0
    }

    private final class Parser {
        let lines: [Line]

        init(lines: [Line]) {
            self.lines = lines
        }

        func parseNode(index: Int, indent: Int) -> (YamlNode, Int) {
            let i = skipIgnorable(index)
            guard i < lines.count, lines[i].indent >= indent else { return (.map([:]), i) }
            let text = String(lines[i].raw.dropFirst(lines[i].indent))
            if text.hasPrefix("- ") {
                return parseArray(index: i, indent: lines[i].indent)
            }
            return parseMap(index: i, indent: lines[i].indent)
        }

        private func parseMap(index: Int, indent: Int) -> (YamlNode, Int) {
            var object: [String: YamlNode] = [:]
            var i = index
            while i < lines.count {
                i = skipIgnorable(i)
                guard i < lines.count else { break }
                let line = lines[i]
                if line.indent < indent { break }
                if line.indent > indent {
                    i += 1
                    continue
                }
                let body = String(line.raw.dropFirst(line.indent))
                if body.hasPrefix("- ") { break }
                guard let pair = parseKeyValue(body) else {
                    i += 1
                    continue
                }
                let parsed = parseValue(pair.value, lineIndex: i, parentIndent: line.indent)
                object[pair.key] = parsed.value
                i = parsed.next
            }
            return (.map(object), i)
        }

        private func parseArray(index: Int, indent: Int) -> (YamlNode, Int) {
            var array: [YamlNode] = []
            var i = index
            while i < lines.count {
                i = skipIgnorable(i)
                guard i < lines.count else { break }
                let line = lines[i]
                if line.indent < indent { break }
                if line.indent != indent {
                    i += 1
                    continue
                }
                let body = String(line.raw.dropFirst(line.indent))
                guard body.hasPrefix("- ") else { break }
                let itemText = String(body.dropFirst(2)).trimmingCharacters(in: .whitespacesAndNewlines)
                if itemText.isEmpty {
                    let child = parseNode(index: i + 1, indent: indent + 2)
                    array.append(child.0)
                    i = child.1
                    continue
                }
                if let pair = parseKeyValue(itemText) {
                    var object: [String: YamlNode] = [:]
                    let parsed = parseValue(pair.value, lineIndex: i, parentIndent: line.indent)
                    object[pair.key] = parsed.value
                    i = parsed.next == i ? i + 1 : parsed.next
                    while i < lines.count {
                        i = skipIgnorable(i)
                        if i >= lines.count || lines[i].indent <= indent { break }
                        let more = parseMap(index: i, indent: lines[i].indent)
                        if case .map(let values) = more.0 {
                            object.merge(values) { _, new in new }
                        }
                        i = more.1
                    }
                    array.append(.map(object))
                } else {
                    array.append(parseScalar(itemText))
                    i += 1
                }
            }
            return (.array(array), i)
        }

        private func parseValue(_ rawValue: String, lineIndex: Int, parentIndent: Int) -> (value: YamlNode, next: Int) {
            let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
            if value == "|" || value == ">" {
                let block = collectBlock(index: lineIndex + 1, parentIndent: parentIndent, folded: value == ">")
                return (.scalar(block.value), block.next)
            }
            if value.isEmpty {
                let child = parseNode(index: lineIndex + 1, indent: parentIndent + 2)
                return child
            }
            return (parseScalar(value), lineIndex + 1)
        }

        private func collectBlock(index: Int, parentIndent: Int, folded: Bool) -> (value: String, next: Int) {
            var blockLines: [String] = []
            var i = index
            var minIndent: Int?
            while i < lines.count {
                let raw = lines[i].raw
                if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    blockLines.append("")
                    i += 1
                    continue
                }
                let indent = lines[i].indent
                if indent <= parentIndent { break }
                minIndent = min(minIndent ?? indent, indent)
                blockLines.append(raw)
                i += 1
            }
            let trimBy = minIndent ?? (parentIndent + 2)
            let normalized = blockLines.map { line -> String in
                line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : String(line.dropFirst(min(trimBy, line.prefix { $0 == " " }.count)))
            }
            return (folded ? normalized.joined(separator: " ").replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression) : normalized.joined(separator: "\n"), i)
        }

        private func skipIgnorable(_ index: Int) -> Int {
            var i = index
            while i < lines.count {
                let trimmed = lines[i].raw.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty && !trimmed.hasPrefix("#") { break }
                i += 1
            }
            return i
        }

        private func parseKeyValue(_ text: String) -> (key: String, value: String)? {
            guard let colon = text.firstIndex(of: ":") else { return nil }
            let key = text[..<colon].trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            let value = text[text.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            return key.isEmpty ? nil : (key, value)
        }

        private func parseScalar(_ value: String) -> YamlNode {
            let trimmed = stripInlineComment(value.trimmingCharacters(in: .whitespacesAndNewlines))
            if trimmed == "null" || trimmed == "~" { return .null }
            if trimmed == "true" { return .bool(true) }
            if trimmed == "false" { return .bool(false) }
            if let number = Double(trimmed), trimmed.range(of: #"^-?\d+(\.\d+)?$"#, options: .regularExpression) != nil {
                return .number(number)
            }
            if trimmed.hasPrefix("["), trimmed.hasSuffix("]") {
                let inside = String(trimmed.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
                if inside.isEmpty { return .array([]) }
                return .array(inside.split(separator: ",").map { parseScalar(String($0)) })
            }
            return .scalar(trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "\"'")))
        }

        private func stripInlineComment(_ value: String) -> String {
            var quote: Character?
            let chars = Array(value)
            for (index, char) in chars.enumerated() {
                if (char == "'" || char == "\""), index == 0 || chars[index - 1] != "\\" {
                    quote = quote == char ? nil : (quote ?? char)
                }
                if char == "#", quote == nil, index == 0 || chars[index - 1].isWhitespace {
                    return String(chars[..<index]).trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
            return value
        }
    }
}

func renderYaml(_ node: YamlNode?, indent: Int = 0) -> String {
    guard let node else { return "" }
    let pad = String(repeating: " ", count: indent)
    switch node {
    case .map(let map):
        if map.isEmpty { return "{}" }
        return map.keys.sorted().map { key in
            let child = map[key]!
            switch child {
            case .map, .array:
                return "\(pad)\(key):\n\(renderYaml(child, indent: indent + 2))"
            default:
                return "\(pad)\(key): \(renderYaml(child, indent: 0))"
            }
        }.joined(separator: "\n")
    case .array(let array):
        if array.isEmpty { return "[]" }
        return array.map { item in
            switch item {
            case .map, .array:
                return "\(pad)- \(renderYaml(item, indent: indent + 2).trimmingCharacters(in: .whitespacesAndNewlines))"
            default:
                return "\(pad)- \(renderYaml(item))"
            }
        }.joined(separator: "\n")
    case .scalar(let value):
        return value
    case .bool(let value):
        return value ? "true" : "false"
    case .number(let value):
        return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
    case .null:
        return "null"
    }
}
