import SwiftUI
import UIKit

@main
struct MarkMyStepsApp: App {
    init() {
        Fonts.register()
        // Navigation titles in the brand font; the bars themselves stay the system's glass.
        UINavigationBar.appearance().largeTitleTextAttributes = [.font: Fonts.ui("Outfit", 34, 680)]
        UINavigationBar.appearance().titleTextAttributes = [.font: Fonts.ui("Outfit", 17, 620)]
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

/// Launch arguments for tests and screenshots, e.g. `-page planner -trip georgia -theme dark -shot YES`.
/// They land in UserDefaults' argument domain, so they never stick.
enum Launch {
    private static let defaults = UserDefaults.standard
    /// trips, trip, planner, travellers, settings, login
    static let page = defaults.string(forKey: "page")
    static let trip = defaults.string(forKey: "trip")
    /// A settings page to open, by its title in lower case, e.g. "weergave".
    static let section = defaults.string(forKey: "section")
    /// An anchor to scroll to once the page shows: days, planner, add, years.
    static let scroll = defaults.string(forKey: "scroll")
    /// The login step to show: "code" for the authenticator step.
    static let step = defaults.string(forKey: "step")
    /// Skip entrance animations, so screenshots are stable.
    static let shot = defaults.bool(forKey: "shot")
    /// Open the photo viewer or the full map on the trip page.
    static let photo = defaults.bool(forKey: "photo")
    static let map = defaults.bool(forKey: "map")
    /// Open a friend's page on Reizigers.
    static let friend = defaults.string(forKey: "friend")
}

enum AppTab: Hashable {
    case trips, travellers, settings
}

struct RootView: View {
    @State private var store = Store.shared
    /// light, dark or system; a `-theme` launch argument overrides it for that run.
    @AppStorage("theme") private var theme = "system"
    @State private var signedOut: Bool

    init() {
        let page = Launch.page
        _signedOut = State(initialValue: page == "login" || (page == nil && !Api.shared.signedIn))
    }

    var body: some View {
        ZStack {
            if signedOut {
                LoginView(
                    notice: store.sessionExpired ? "Je sessie is verlopen. Log opnieuw in." : nil,
                    onDone: {
                        store.sessionExpired = false
                        withAnimation(.smooth(duration: 0.45)) { signedOut = false }
                        Task { await store.load() }
                    },
                    onDemo: { withAnimation(.smooth(duration: 0.45)) { signedOut = false } }
                )
                .transition(.opacity.combined(with: .scale(scale: 1.04)))
            } else {
                MainTabs(onSignIn: {
                    store.signOut()
                    withAnimation(.smooth(duration: 0.45)) { signedOut = true }
                })
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .environment(store)
        .tint(Brand.accent)
        .preferredColorScheme(theme == "light" ? .light : theme == "dark" ? .dark : nil)
        .task { await store.load() }
        // A session the server no longer accepts goes back to signing in, never on to the demo's trips.
        .onChange(of: store.sessionExpired) { _, expired in
            if expired { withAnimation(.smooth(duration: 0.45)) { signedOut = true } }
        }
        .task {
            if let host = UserDefaults.standard.string(forKey: "nettest") { await Api.netTest(host) }
            if UserDefaults.standard.bool(forKey: "keychaintest") { Keychain.selfTest() }
            // Test mode proves itself at launch: one write that only ever reaches the log, never the server.
            if Api.dryRun { _ = try? await Api.shared.send("POST", "/api/dryrun-probe", body: ["probe": true]) }
        }
    }
}

struct MainTabs: View {
    let onSignIn: () -> Void
    @State private var tab: AppTab = MainTabs.startTab
    @State private var homeReset = 0
    @State private var travellersReset = 0
    @State private var settingsReset = 0

    private static var startTab: AppTab {
        switch Launch.page {
        case "travellers", "notices": .travellers
        case "settings": .settings
        default: .trips
        }
    }

    var body: some View {
        TabView(selection: $tab) {
            Tab("Reizen", systemImage: "safari", value: AppTab.trips) {
                HomeView(onAvatar: { tab = .settings }, resetToken: homeReset)
            }
            Tab("Reizigers", systemImage: "person.2", value: AppTab.travellers) {
                TravellersView(resetToken: travellersReset, onOpenRequests: { tab = .settings })
            }
            Tab("Instellingen", systemImage: "gearshape", value: AppTab.settings) {
                SettingsView(onSignIn: onSignIn, resetToken: settingsReset)
            }
        }
        // The bar always stays whole, also while scrolling: never shrunk into a circle.
        .tabBarMinimizeBehavior(.never)
        .sensoryFeedback(.selection, trigger: tab)
        .onChange(of: tab) { old, new in
            // Back on Reizen from another tab: the home page starts at the top again.
            if new == .trips && old != .trips { homeReset += 1 }
            // A tab left behind opens at its top next time: Reizigers with the bell in view, Instellingen on its
            // main list instead of the sub page of before.
            if old == .travellers && new != .travellers { travellersReset += 1 }
            if old == .settings && new != .settings { settingsReset += 1 }
        }
    }
}
