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
        case .fotos: "Immich via je server"
        case .meldingen: "Reacties en nieuwe foto's"
        case .opslag: "Foto-cache op dit toestel"
        case .updates: "Via TestFlight"
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
        .onChange(of: resetToken) {
            // Out of sight, so without the back animation.
            var quiet = Transaction()
            quiet.disablesAnimations = true
            withTransaction(quiet) { path = [] }
        }
    }

    private var name: String { store.me?.name.isEmpty == false ? store.me!.name : "Mark" }
}

private struct SectionPage: View {
    let section: SettingsSection
    let onSignIn: () -> Void
    @Environment(Store.self) private var store
    @AppStorage("theme") private var theme = "system"
    @AppStorage("set.tracking") private var tracking = true
    @AppStorage("set.selfLocation") private var selfLocation = false
    @AppStorage("set.notify") private var notify = true
    @State private var confirmSignOut = false
    private let sizes = CardSizes.shared
    @State private var cacheCleared = false

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
            LabeledContent { Text("in de web-app") } label: { Label("Tweestapsverificatie", systemImage: "checkmark.shield") }
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
        } header: { Text("Reizen op de homepage") }
        Section {
            Button(role: .destructive) {
                withAnimation(.calm) { sizes.clear() }
                Haptic.tap()
            } label: {
                Label("Handmatige keuzes wissen", systemImage: "trash").foregroundStyle(sizes.overrides.isEmpty ? Brand.inkSoft : .red)
            }
            .disabled(sizes.overrides.isEmpty)
        } footer: {
            Text("Automatisch: aankomende reizen en de laatste reis groot, de rest als rij. Per reis kies je het ook in het menu van de reis.")
        }
        Section("Taal en kaart") {
            LabeledContent { Text("Nederlands") } label: { Label("Taal", systemImage: "globe") }
            LabeledContent { Text("draait mee met je vinger") } label: { Label("Globe", systemImage: "globe.europe.africa") }
        }
    }

    @ViewBuilder private var travel: some View {
        Section("Onderweg") {
            Toggle(isOn: $tracking) { Label("Route-tracking", systemImage: "location.north.line") }
            Toggle(isOn: $selfLocation) { Label("Eigen locatie", systemImage: "mappin.and.ellipse") }
            LabeledContent { Text("in de web-app") } label: { Label("Standaard vliegvelden", systemImage: "airplane") }
        }
        Section {
            LabeledContent { Text("GPX, KML") } label: { Label("Route-bestanden", systemImage: "doc") }
            LabeledContent { Text("in de web-app") } label: { Label("Polarsteps importeren", systemImage: "square.and.arrow.down") }
        } header: { Text("Importeren") } footer: { readOnly }
    }

    @ViewBuilder private var photos: some View {
        Section {
            LabeledContent { Text(store.live ? "via je server" : "voorbeelden") } label: { Label("Immich", systemImage: "photo.on.rectangle") }
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
        Section {
            LabeledContent { Text(cacheText) } label: { Label("Foto-cache", systemImage: "photo.stack") }
            Button(role: .destructive) {
                ImageLoader.shared.clear()
                cacheCleared = true
            } label: {
                Label(cacheCleared ? "Geleegd" : "Foto-cache legen", systemImage: cacheCleared ? "checkmark" : "trash")
                    .contentTransition(.symbolEffect(.replace))
            }
            .disabled(cacheCleared)
        } header: { Text("Op dit toestel") } footer: {
            Text("Foto's worden alleen bewaard zolang de app open is; je reizen staan op je server.")
        }
    }

    private var cacheText: String { cacheCleared ? "leeg" : "in het geheugen" }

    @ViewBuilder private var updates: some View {
        Section {
            LabeledContent { Text(AppInfo.version) } label: { Label("Deze versie", systemImage: "info.circle") }
        } header: { Text("Nieuwe versies") } footer: {
            Text("Nieuwe versies van deze testapp komen via TestFlight.")
        }
    }

    @ViewBuilder private var about: some View {
        Section {
            VStack(spacing: 10) {
                CompassLogo(size: 64)
                Text("MarkMySteps").font(.outfit(26, 700)).foregroundStyle(Brand.ink)
                Text("Testapp voor iPhone, \(AppInfo.version)").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .listRowBackground(Color.clear)
        }
        Section("MarkMySteps") {
            LabeledContent { Text(AppInfo.version) } label: { Label("Versie", systemImage: "sparkles") }
            LabeledContent { Text("AGPL-3.0") } label: { Label("Licentie", systemImage: "doc.text") }
        }
    }
}
