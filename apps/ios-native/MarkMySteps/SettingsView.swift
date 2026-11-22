import SwiftUI

/*
 * Instellingen like the iOS Settings app: who is signed in at the top, then
 * the categories of the web app's settings, each opening a page of its own.
 * Switches here are kept on this phone only; nothing is sent to the server.
 */

enum SettingsSection: String, CaseIterable, Identifiable, Hashable {
    case account, weergave, reizen, fotos, meldingen, opslag, updates, over
    var id: String { rawValue }

    var title: String {
        switch self {
        case .account: "Account"
        case .weergave: "Weergave"
        case .reizen: "Reizen en route"
        case .fotos: "Foto's"
        case .meldingen: "Meldingen"
        case .opslag: "Opslag en back-up"
        case .updates: "Updates"
        case .over: "Over"
        }
    }

    var summary: String {
        switch self {
        case .account: "Profiel, wachtwoord, tweestapsverificatie"
        case .weergave: "Thema, taal, globe"
        case .reizen: "Tracking, eigen locatie, vliegvelden"
        case .fotos: "Immich verbonden"
        case .meldingen: "Reacties en nieuwe foto's"
        case .opslag: "Offline kaart, foto-cache"
        case .updates: "Automatisch, build 267"
        case .over: "MarkMySteps, AGPL-3.0"
        }
    }

    var symbol: String {
        switch self {
        case .account: "person.fill"
        case .weergave: "paintbrush.fill"
        case .reizen: "point.topleft.down.to.point.bottomright.curvepath.fill"
        case .fotos: "photo.on.rectangle.angled"
        case .meldingen: "bell.badge.fill"
        case .opslag: "externaldrive.fill"
        case .updates: "arrow.down.circle.fill"
        case .over: "info.circle.fill"
        }
    }

    var tint: Color {
        switch self {
        case .account: Color(hex: 0xE8613C)
        case .weergave: Color(hex: 0x3F7FE0)
        case .reizen: Color(hex: 0x2A9D5C)
        case .fotos: Color(hex: 0xD9467F)
        case .meldingen: Color(hex: 0xE5484D)
        case .opslag: Color(hex: 0x8E8E93)
        case .updates: Color(hex: 0x5B6BE0)
        case .over: Color(hex: 0x8E8E93)
        }
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
    @Environment(Store.self) private var store
    @State private var path: [SettingsSection] = Launch.section.flatMap { s in SettingsSection.allCases.first { $0.rawValue == s } }.map { [$0] } ?? []

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
                    ForEach(SettingsSection.allCases) { section in
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
            .navigationDestination(for: SettingsSection.self) { SectionPage(section: $0, onSignIn: onSignIn) }
        }
    }

    private var name: String { store.me?.name.isEmpty == false ? store.me!.name : "Mark" }
}

private struct SectionPage: View {
    let section: SettingsSection
    let onSignIn: () -> Void
    @Environment(Store.self) private var store
    @AppStorage("theme") private var theme = "system"
    @AppStorage("set.twoFactor") private var twoFactor = true
    @AppStorage("set.tracking") private var tracking = true
    @AppStorage("set.selfLocation") private var selfLocation = false
    @AppStorage("set.notify") private var notify = true
    @AppStorage("set.offlineMap") private var offlineMap = false
    @AppStorage("set.autoUpdate") private var autoUpdate = true
    @State private var confirmSignOut = false
    @State private var checking = false

    var body: some View {
        Form {
            Group {
            switch section {
            case .account: account
            case .weergave: appearance
            case .reizen: travel
            case .fotos: photos
            case .meldingen: notifications
            case .opslag: storage
            case .updates: updates
            case .over: about
            }
            }
            // Rows in the raised tone, so they stand off the paper in light and dark.
            .listRowBackground(Brand.raised)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Brand.paper)
        .navigationTitle(section.title)
        .navigationBarTitleDisplayMode(.large)
    }

    private let readOnly = Text("Deze testapp leest alleen. Wijzigen doe je in de web-app.")

    @ViewBuilder private var account: some View {
        Section {
            LabeledContent { Text("naam, foto") } label: { Label("Profiel", systemImage: "person.crop.circle") }
            LabeledContent { Text("verborgen") } label: { Label("Wachtwoord", systemImage: "lock") }
            Toggle(isOn: $twoFactor) { Label("Tweestapsverificatie", systemImage: "checkmark.shield") }
                .disabled(true)
        } header: { Text("Jij") } footer: { readOnly }
        Section("Server") {
            LabeledContent { Text(store.live ? Api.shared.host : "voorbeelden") } label: { Label("Server", systemImage: "server.rack") }
            if store.live {
                Button(role: .destructive) { confirmSignOut = true } label: {
                    Label("Uitloggen", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(.red)
                }
                .confirmationDialog("Uitloggen van \(Api.shared.host)?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                    Button("Uitloggen", role: .destructive, action: onSignIn)
                } message: {
                    Text("Je reizen blijven op de server. Daarna zie je de voorbeelden.")
                }
            } else {
                Button(action: onSignIn) {
                    Label("Inloggen", systemImage: "person.badge.key")
                }
            }
        }
    }

    @ViewBuilder private var appearance: some View {
        Section {
            Picker("Thema", selection: $theme) {
                Text("Licht").tag("light")
                Text("Donker").tag("dark")
                Text("Systeem").tag("system")
            }
            .pickerStyle(.segmented)
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
        } header: { Text("Thema") }
        Section("Taal en kaart") {
            LabeledContent { Text("Nederlands") } label: { Label("Taal", systemImage: "globe") }
            LabeledContent { Text("draait mee met je vinger") } label: { Label("Globe", systemImage: "globe.europe.africa") }
        }
    }

    @ViewBuilder private var travel: some View {
        Section("Onderweg") {
            Toggle(isOn: $tracking) { Label("Route-tracking", systemImage: "location.north.line") }
            Toggle(isOn: $selfLocation) { Label("Eigen locatie", systemImage: "mappin.and.ellipse") }
            LabeledContent { Text("AMS, EIN") } label: { Label("Standaard vliegvelden", systemImage: "airplane") }
        }
        Section {
            LabeledContent { Text("GPX, KML") } label: { Label("Route-bestanden", systemImage: "doc") }
            LabeledContent { Text("in de web-app") } label: { Label("Polarsteps importeren", systemImage: "square.and.arrow.down") }
        } header: { Text("Importeren") } footer: { readOnly }
    }

    @ViewBuilder private var photos: some View {
        Section {
            LabeledContent { Text(store.live ? "verbonden" : "voorbeelden") } label: { Label("Immich", systemImage: "photo.on.rectangle") }
            LabeledContent { Text("alles van de dagen samen") } label: { Label("Foto's in je statistieken", systemImage: "camera") }
        } header: { Text("Bron") } footer: {
            Text("Welke foto's bij een reis horen, regel je in Immich: datum en plaats in de foto zelf.")
        }
    }

    @ViewBuilder private var notifications: some View {
        Section("Op je telefoon") {
            Toggle(isOn: $notify) { Label("Meldingen", systemImage: "bell") }
            LabeledContent { Text("op je foto's en dagen") } label: { Label("Reacties", systemImage: "bubble.left.and.bubble.right") }
        }
    }

    @ViewBuilder private var storage: some View {
        Section("Op dit toestel") {
            Toggle(isOn: $offlineMap) { Label("Kaart offline bewaren", systemImage: "map") }
            LabeledContent { Text("412 MB") } label: { Label("Foto-cache", systemImage: "photo.stack") }
            LabeledContent { Text("laatst gisteren") } label: { Label("Back-up", systemImage: "arrow.clockwise.icloud") }
        }
    }

    @ViewBuilder private var updates: some View {
        Section("Nieuwe versies") {
            Toggle(isOn: $autoUpdate) { Label("Automatisch controleren", systemImage: "arrow.triangle.2.circlepath") }
            Button {
                checking = true
                Task {
                    try? await Task.sleep(for: .seconds(1.2))
                    checking = false
                }
            } label: {
                LabeledContent {
                    if checking { ProgressView() } else { Text("build 267").foregroundStyle(.secondary) }
                } label: {
                    Label("Nu controleren", systemImage: "arrow.down.circle")
                }
            }
            .disabled(checking)
        }
    }

    @ViewBuilder private var about: some View {
        Section {
            VStack(spacing: 10) {
                CompassLogo(size: 64)
                Text("MarkMySteps").font(.outfit(26, 700)).foregroundStyle(Brand.ink)
                Text("Testapp voor iPhone, versie 0.1").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        }
        Section("MarkMySteps") {
            LabeledContent { Text("build 267") } label: { Label("Wat is er nieuw", systemImage: "sparkles") }
            LabeledContent { Text("AGPL-3.0") } label: { Label("Licentie", systemImage: "doc.text") }
        }
    }
}
