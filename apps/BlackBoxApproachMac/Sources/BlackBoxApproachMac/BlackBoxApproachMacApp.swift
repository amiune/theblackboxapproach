import SwiftUI

@main
struct BlackBoxApproachMacApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(state)
                .frame(minWidth: 1180, minHeight: 760)
        }

        Settings {
            SettingsView()
                .environmentObject(state)
                .frame(width: 520)
        }
        .commands {
            CommandGroup(after: .newItem) {
                Button("Open Project Folder...") {
                    state.openProjectFolder()
                }
                .keyboardShortcut("o", modifiers: [.command])
            }
            CommandGroup(replacing: .saveItem) {
                Button("Close Project") {
                    state.closeProject()
                }
                .keyboardShortcut("w", modifiers: [.command])
                .disabled(state.projectURL == nil)
            }
        }
    }
}
