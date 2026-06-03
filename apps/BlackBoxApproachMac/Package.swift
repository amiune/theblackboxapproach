// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "BlackBoxApproachMac",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "BlackBoxApproachMac", targets: ["BlackBoxApproachMac"])
    ],
    targets: [
        .executableTarget(
            name: "BlackBoxApproachMac",
            path: "Sources/BlackBoxApproachMac"
        )
    ]
)
