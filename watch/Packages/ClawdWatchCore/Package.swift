// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "ClawdWatchCore", platforms: [.macOS(.v13), .watchOS(.v10)], products: [.library(name: "ClawdWatchCore", targets: ["ClawdWatchCore"])], targets: [.target(name: "ClawdWatchCore"), .testTarget(name: "ClawdWatchCoreTests", dependencies: ["ClawdWatchCore"], resources: [.copy("Fixtures")])])
