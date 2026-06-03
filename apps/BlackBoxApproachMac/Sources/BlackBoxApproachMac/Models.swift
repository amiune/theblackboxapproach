import Foundation

struct GitSnapshot {
    let status: String
    let diff: String
}

struct AppliedFilesResult {
    let message: String
    let paths: [String]
    let projectURL: URL?
}
