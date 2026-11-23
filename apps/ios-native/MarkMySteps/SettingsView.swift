import SwiftUI

/*
 * Instellingen like the iOS Settings app and like Android's tabs: who is signed in at the top (it opens your
 * account), then Weergave, Voorkeuren, Diensten, Gegevens, Accounts for an admin, and Over, each a page of its own.
 */

enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case account, weergave, voorkeuren, diensten, gegevens, accounts, over
    var id: String { rawValue }

    var title: String {
        switch self {
        case .account: "Account"
        case .weergave: "Weergave"
        case .voorkeuren: "Voorkeuren"
        case .diensten: "Diensten"
        case .gegevens: "Gegevens"
        case .accounts: "Accounts"
        case .over: "Over"
        }
    }

    var summary: String {
        switch self {
        case .account: "Profielfoto, naam, wachtwoord, 2FA"
        case .weergave: "Thema, reiskaarten, kaartstijl"
        case .voorkeuren: "Vliegvelden, globe, tracking, meldingen"
        case .diensten: "Server, Immich"
        case .gegevens: "Back-up, importeren, route-bestanden"
        case .accounts: "Aanvragen en accounts op je server"
        case .over: "Versie, wat is er nieuw"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.fill"
        case .weergave: "paintbrush.fill"
        case .voorkeuren: "airplane"
        case .diensten: "cloud.fill"
        case .gegevens: "externaldrive.fill"
        case .accounts: "person.2.fill"
        case .over: "info.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .account: Color(hex: 0xE8613C)
        case .weergave: Color(hex: 0x3F7FE0)
        case .voorkeuren: Color(hex: 0x2A9D5C)
        case .diensten: Color(hex: 0x5B6BE0)
        case .gegevens: Color(hex: 0x8E8E93)
        case .accounts: Color(hex: 0xD9467F)
        case .over: Color(hex: 0x8E8E93)
        }
    }
}

/// A page to open on Instellingen from elsewhere (the face on the homepage, "Aanvragen bekijken").
struct SettingsRequest: Equatable {
    let section: SettingsSection
    let token: Int
}

enum AppInfo {
    static var version: String {
        let v = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1"
        let b = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return "versie \(v) (\(b))"
    }
}

/// The coloured square with a white symbol, as the iOS Settings app draws them.
struct SettingsIcon: View {
    let symbol: String
    let tint: Color
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(tint, in: .rect(cornerRadius: 8))
    }
}

struct SettingsView: View {
    let onSignIn: () -> Void
    /// Bumped when another tab is chosen: next time Instellingen opens on its main list.
    var resetToken = 0
    var request: SettingsRequest?
    @Environment(Store.self) private var store
    @State private var path: [SettingsSection] = Launch.section.flatMap { s in SettingsSection.allCases.first { $0.rawValue == s } }.map { [$0] } ?? []

    private var sections: [SettingsSection] {
        SettingsSection.allCases.filter { $0 != .account && ($0 != .accounts || (store.live && (store.me?.admin ?? SettingsRemote.cachedAdmin))) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    NavigationLink(value: SettingsSection.account) {
                        HStack(spacing: 14) {
                            Avatar(userId: store.me?.id, hasAvatar: store.me?.hasAvatar ?? false, initial: String(name.prefix(1)),
                                   color: Brand.accent.opacity(0.14), ink: Brand.accent, size: 58)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(name).font(.outfit(20, 650)).foregroundStyle(Brand.ink)
                                Text(store.live ? "@\(store.me?.username ?? "") · \(Api.shared.host)" : "Voorbeelden, niet ingelogd")
                                    .font(.inter(13.5, 500))
                                    .foregroundStyle(Brand.inkSoft)
                                    .lineLimit(1)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
                .listRowBackground(Brand.raised)
                Section {
                    ForEach(sections) { section in
                        NavigationLink(value: section) {
                            HStack(spacing: 14) {
                                SettingsIcon(symbol: section.symbol, tint: section.tint)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(section.title).font(.inter(17, 500)).foregroundStyle(Brand.ink)
                                    Text(section.summary).font(.inter(13, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
                .listRowBackground(Brand.raised)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle("Instellingen")
            .navigationDestination(for: SettingsSection.self) { section in
                switch section {
                case .account: AccountPage(onSignIn: onSignIn)
                case .weergave: AppearancePage()
                case .voorkeuren: PreferencesPage()
                case .diensten: ServicesPage(onSignIn: onSignIn)
                case .gegevens: DataPage(onSignIn: onSignIn)
                case .accounts: AdminAccountsPage()
                case .over: AboutPage()
                }
            }
        }
        .onChange(of: resetToken) {
            // Out of sight, so without the back animation.
            var quiet = Transaction()
            quiet.disablesAnimations = true
            withTransaction(quiet) { path = [] }
        }
        .onChange(of: request, initial: true) { _, r in
            guard let r else { return }
            var quiet = Transaction()
            quiet.disablesAnimations = true
            withTransaction(quiet) { path = [r.section] }
        }
    }

    private var name: String { store.me?.name.isEmpty == false ? store.me!.name : "Mark" }
}

/// The look of a settings page: grouped rows in the raised tone on the paper.
extension View {
    func settingsPage(_ title: String) -> some View {
        formStyle(.grouped)
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
    }
}

/// A page that needs your own server, shown signed out: what it is for and how to sign in, nothing invented.
struct SignInFirst: View {
    let text: String
    let onSignIn: () -> Void
    var body: some View {
        Section {
            Text(text).font(.inter(15, 450)).foregroundStyle(Brand.inkSoft)
            Button("Inloggen", systemImage: "person.badge.key", action: onSignIn)
        }
        .listRowBackground(Brand.raised)
    }
}

/// A row for something that does not work here yet: greyed, and only when tapped it says why. Never a switch that
/// does nothing.
struct UnavailableRow: View {
    let title: String
    let symbol: String
    let reason: String
    @State private var asked = false

    var body: some View {
        Button { asked = true } label: {
            HStack {
                Label(title, systemImage: symbol)
                Spacer()
                Image(systemName: "info.circle").font(.system(size: 15))
            }
            .foregroundStyle(Brand.inkSoft.opacity(0.7))
        }
        .alert(title, isPresented: $asked) { Button("OK", role: .cancel) {} } message: { Text(reason) }
    }
}

// MARK: Weergave

private struct AppearancePage: View {
    @AppStorage("theme") private var theme = "system"
    @AppStorage("mapStyle") private var mapStyle = MapLook.positron.rawValue
    @Environment(\.colorScheme) private var scheme
    private let sizes = CardSizes.shared

    var body: some View {
        Form {
            Group {
                Section {
                    Picker("Thema", selection: $theme) {
                        Text("Licht").tag("light")
                        Text("Donker").tag("dark")
                        Text("Systeem").tag("system")
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .sensoryFeedback(.selection, trigger: theme)
                } header: { Text("Thema") }
                Section {
                    Picker("Kaartgrootte", selection: Binding(get: { sizes.standard }, set: { v in withAnimation(.calm) { sizes.standard = v } })) {
                        Text("Automatisch").tag(CardSizes.auto)
                        Text("Groot").tag(CardSizes.large)
                        Text("Klein").tag(CardSizes.compact)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                    .sensoryFeedback(.selection, trigger: sizes.standard)
                } header: { Text("Reiskaarten op de homepage") }
                Section {
                    // With nothing to wipe the row says so in muted words instead of a grey button that only
                    // looks broken; with choices it is a red action with how many trips it resets.
                    let count = sizes.overrides.count
                    Button(role: .destructive) {
                        withAnimation(.calm) { sizes.clear() }
                        Haptic.tap()
                    } label: {
                        HStack {
                            if count == 0 {
                                Label("Geen handmatige keuzes", systemImage: "checkmark.circle")
                                    .foregroundStyle(Brand.inkSoft.opacity(0.75))
                            } else {
                                Label("Handmatige keuzes wissen", systemImage: "trash").foregroundStyle(.red)
                                Spacer()
                                Text(count == 1 ? "1 reis" : "\(count) reizen")
                                    .font(.inter(15, 500))
                                    .foregroundStyle(Brand.inkSoft)
                                    .contentTransition(.numericText())
                            }
                        }
                        .animation(.calm, value: count)
                    }
                    .disabled(count == 0)
                } footer: {
                    Text("Automatisch: aankomende reizen en de laatste reis groot, de rest als rij. Per reis kies je het ook in het menu van de reis.")
                }
                Section {
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                        ForEach(MapLook.allCases) { look in
                            let on = MapLook.chosen(mapStyle) == look
                            Button { withAnimation(.calm) { mapStyle = look.rawValue } } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    MapLookPreview(look: look, dark: scheme == .dark).frame(height: 70).clipShape(.rect(cornerRadius: 12))
                                    HStack {
                                        Text(look.label).font(.outfit(14, 600)).foregroundStyle(Brand.ink).lineLimit(1).minimumScaleFactor(0.85)
                                        Spacer(minLength: 2)
                                        if on { Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(Brand.accent) }
                                    }
                                }
                                .padding(8)
                                .background(on ? Brand.accent.opacity(0.12) : Brand.sunken.opacity(0.5), in: .rect(cornerRadius: 18))
                                .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(on ? Brand.accent : .clear, lineWidth: 2) }
                            }
                            .buttonStyle(PressStyle())
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, 6)
                    .sensoryFeedback(.selection, trigger: mapStyle)
                } header: { Text("Kaartstijl") } footer: { Text("Voor alle kaarten in de app. In de donkere stand worden de lichte stijlen vanzelf de donkere kaart.") }
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Weergave")
    }
}

// MARK: Over

private struct AboutPage: View {
    var body: some View {
        Form {
            Section {
                VStack(spacing: 10) {
                    CompassLogo(size: 64)
                    Text("MarkMySteps").font(.outfit(26, 700)).foregroundStyle(Brand.ink)
                    Text("Voor iPhone, \(AppInfo.version)").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .listRowBackground(Color.clear)
            }
            Group {
                Section {
                    NavigationLink { WhatsNewPage() } label: { Label("Wat is er nieuw", systemImage: "sparkles") }
                    NavigationLink { PrivacyPage() } label: { Label("Privacy", systemImage: "lock") }
                    external("Broncode", "github.com/Marukiee/MarkMySteps", "chevron.left.forwardslash.chevron.right", "https://github.com/Marukiee/MarkMySteps")
                    external("Licentie", "AGPL-3.0", "doc.text", "https://www.gnu.org/licenses/agpl-3.0.html")
                } header: { Text("Meer") } footer: { Text("Nieuwe versies voor iPhone komen via TestFlight.") }
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Over")
    }

    /// A row that opens the web: an arrow out of the app, never a chevron as if it were a page here.
    private func external(_ title: String, _ value: String, _ symbol: String, _ url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack {
                Label(title, systemImage: symbol).foregroundStyle(Brand.ink)
                Spacer()
                Text(value).foregroundStyle(Brand.inkSoft).lineLimit(1)
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.inkSoft)
            }
        }
    }
}

/// The web's changelog in the app: per release what is new, what got better and what was fixed.
private struct WhatsNewPage: View {
    struct Entry: Decodable, Hashable {
        let title: String
        let date: String
        let new: [String]?
        let better: [String]?
        let fixed: [String]?
    }

    private let entries: [Entry] = {
        guard let url = Bundle.main.url(forResource: "changelog", withExtension: "json"), let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Entry].self, from: data)) ?? []
    }()

    var body: some View {
        Form {
            ForEach(entries, id: \.self) { e in
                Section {
                    group("Nieuw", e.new, Color(hex: 0x2A9D5C))
                    group("Verbeteringen", e.better, Color(hex: 0x3F7FE0))
                    group("Opgelost", e.fixed, Color(hex: 0xE8613C))
                } header: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.title).font(.outfit(18, 650)).foregroundStyle(Brand.ink).textCase(nil)
                        Text(day(e.date)).font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).textCase(nil)
                    }
                }
                .listRowBackground(Brand.raised)
            }
        }
        .settingsPage("Wat is er nieuw")
    }

    @ViewBuilder private func group(_ label: String, _ items: [String]?, _ tint: Color) -> some View {
        if let items, !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text(label).font(.outfit(13, 650)).foregroundStyle(tint).padding(.horizontal, 10).padding(.vertical, 3).background(tint.opacity(0.12), in: .capsule)
                ForEach(items, id: \.self) { item in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Circle().fill(tint).frame(width: 5, height: 5).offset(y: -2)
                        Text(item).font(.inter(14.5, 450)).foregroundStyle(Brand.ink)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func day(_ iso: String) -> String { Remote.day(iso).map { Format.shortDay($0) + " " + iso.prefix(4) } ?? iso }
}

/// What the app keeps and who sees it, in plain words, as Android and the web say it.
private struct PrivacyPage: View {
    private let sections: [(String, [(String?, String)])] = [
        ("Wat de app bewaart", [
            ("Je account", "je naam, gebruikersnaam, e-mailadres en profielfoto. Je wachtwoord wordt alleen versleuteld bewaard."),
            ("Je route", "de locatiepunten die de app vastlegt terwijl je een reis bijhoudt."),
            ("Je reizen", "titels, data, stops, dagverhalen en notities."),
            ("Reacties en likes", "op foto's en dagverhalen."),
        ]),
        ("Je locatie", [(nil, "De app legt je locatie alleen vast als je zelf tracking aanzet voor een reis. Zolang dat loopt, ook met het scherm uit, neemt de app een meting per interval. Stop je, dan stopt het.")]),
        ("Diensten van anderen", [
            ("Kaarten", "Apple Kaarten: welk stuk kaart je bekijkt."),
            ("Plaatsen zoeken", "Photon van Komoot: wat je intypt, en voor de plaats onder een foto de coördinaten."),
            ("Weer", "Open-Meteo: de coördinaten van een plaats."),
        ]),
        ("Waar het staat en hoe lang", [(nil, "Alles staat op de server van MarkMySteps en gaat er versleuteld (https) naartoe. Je gegevens blijven bewaard zolang je account bestaat.")]),
        ("Je rechten", [(nil, "Je mag je gegevens inzien, laten verbeteren of je account met alles erop laten verwijderen. Mail daarvoor; het is binnen een maand geregeld.")]),
    ]

    var body: some View {
        Form {
            Group {
                ForEach(sections, id: \.0) { s in
                    Section(s.0) {
                        ForEach(Array(s.1.enumerated()), id: \.offset) { _, line in
                            if let head = line.0 {
                                (Text(head + ": ").font(.inter(15, 650)) + Text(line.1).font(.inter(15, 450))).foregroundStyle(Brand.ink)
                            } else {
                                Text(line.1).font(.inter(15, 450)).foregroundStyle(Brand.ink)
                            }
                        }
                    }
                }
                Section {
                    Link(destination: URL(string: "mailto:mark@markmaaktmedia.nl")!) {
                        HStack {
                            Label("Mail Mark Maakt Media", systemImage: "envelope").foregroundStyle(Brand.ink)
                            Spacer()
                            Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Brand.inkSoft)
                        }
                    }
                }
            }
            .listRowBackground(Brand.raised)
        }
        .settingsPage("Privacy")
    }
}
