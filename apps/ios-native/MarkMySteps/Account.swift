import CoreImage.CIFilterBuiltins
import PhotosUI
import SwiftUI

/*
 * Your account in the app, as the web and Android have it: the profile photo, your name and username (with a
 * check whether the name is free), your password, and two-step verification with a QR code and recovery codes.
 * Signing out sits at the bottom and asks first.
 */
struct AccountPage: View {
    let onSignIn: () -> Void
    @Environment(Store.self) private var store
    @State private var account = SettingsRemote.Account()
    @State private var name = ""
    @State private var username = ""
    @State private var free: Bool?
    @State private var checking = false
    @State private var profileNote: (String, Bool)?
    @State private var savingProfile = false
    @State private var photo: PhotosPickerItem?
    @State private var photoBusy = false
    @State private var confirmRemovePhoto = false
    @State private var current = ""
    @State private var new = ""
    @State private var repeatNew = ""
    @State private var passwordNote: (String, Bool)?
    @State private var savingPassword = false
    @State private var twoFactor: SettingsRemote.TwoFactor?
    @State private var twoFactorFlow: TwoFactorFlow?
    @State private var confirmSignOut = false
    @State private var loaded = false

    /// Screenshots only (`-menuPreview YES`): the page as when signed in, on the demo; nothing can reach a server.
    private var live: Bool { store.live || Launch.menuPreview }
    private var usernameChanged: Bool { !username.isEmpty && username != account.username }

    var body: some View {
        Form {
            Group {
                if !live {
                    Section {
                        Text("Je bekijkt de voorbeelden. Log in om je profiel, wachtwoord en tweestapsverificatie te beheren.")
                            .font(.inter(15, 450)).foregroundStyle(Brand.inkSoft)
                        Button("Inloggen", systemImage: "person.badge.key", action: onSignIn)
                    }
                } else {
                    photoSection
                    profileSection
                    passwordSection
                    twoFactorSection
                    Section {
                        Button(role: .destructive) { confirmSignOut = true } label: {
                            Label("Uitloggen", systemImage: "rectangle.portrait.and.arrow.right").foregroundStyle(.red)
                        }
                    } footer: { Text("Ingelogd op \(Api.shared.host).") }
                }
            }
            .listRowBackground(Brand.raised)
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .background(Brand.paper)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.large)
        .confirmationDialog("Uitloggen van \(Api.shared.host)?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Uitloggen", role: .destructive, action: onSignIn)
        } message: { Text("Je reizen blijven op de server. Daarna zie je de voorbeelden.") }
        .confirmationDialog("Profielfoto verwijderen?", isPresented: $confirmRemovePhoto, titleVisibility: .visible) {
            Button("Verwijderen", role: .destructive) { removePhoto() }
        } message: { Text("Je initiaal komt er weer voor in de plaats.") }
        .sheet(item: $twoFactorFlow) { flow in
            TwoFactorSheet(flow: flow) { Task { twoFactor = try? await SettingsRemote.twoFactor() } }
        }
        .task {
            if Launch.menuPreview && !store.live { name = "Mark"; username = "mark"; account.displayName = "Mark"; account.username = "mark"; account.email = "mark@voorbeeld.nl"; twoFactor = .init(enabled: false, codesLeft: 0); return }
            guard live, !loaded else { return }
            if let me = store.me { account.id = me.id; account.displayName = me.name; account.username = me.username; account.hasAvatar = me.hasAvatar }
            name = account.displayName
            username = account.username
            if let a = try? await SettingsRemote.account() {
                account = a
                name = a.displayName
                username = a.username
            }
            twoFactor = try? await SettingsRemote.twoFactor()
            loaded = true
        }
        .task(id: username) {
            // Whether the new name is free, a moment after the last key.
            free = nil
            guard usernameChanged, username.count >= 3 else { return }
            checking = true
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            free = await SettingsRemote.usernameFree(username)
            checking = false
        }
        .onChange(of: photo) { _, item in if let item { upload(item) } }
    }

    // MARK: Photo

    private var photoSection: some View {
        Section {
            HStack(spacing: 16) {
                Avatar(userId: account.id.isEmpty ? store.me?.id : account.id, hasAvatar: account.hasAvatar, initial: String((name.isEmpty ? "?" : name).prefix(1)).uppercased(),
                       color: Brand.accent.opacity(0.14), ink: Brand.accent, size: 84)
                    .overlay { if photoBusy { Circle().fill(.black.opacity(0.35)); ProgressView().tint(.white) } }
                VStack(alignment: .leading, spacing: 8) {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label(account.hasAvatar ? "Andere foto" : "Foto kiezen", systemImage: "photo").font(.outfit(15, 600))
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .disabled(photoBusy)
                    if account.hasAvatar {
                        Button("Verwijderen", role: .destructive) { confirmRemovePhoto = true }
                            .font(.outfit(14, 600))
                            .buttonStyle(.borderless)
                            .disabled(photoBusy)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
        } header: { Text("Profielfoto") } footer: { Text("Midden uit je foto gesneden tot een vierkant, zoals de gezichten in de app.") }
    }

    private func upload(_ item: PhotosPickerItem) {
        photoBusy = true
        Task {
            defer { photoBusy = false; photo = nil }
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data), let jpeg = Self.square(image) else {
                profileNote = ("Deze foto kon niet gelezen worden", true)
                return
            }
            do {
                try await SettingsRemote.uploadAvatar(jpeg)
                account.hasAvatar = true
                ImageLoader.shared.forget("avatar/\(account.id)")
                Haptic.tap()
                await store.load()
            } catch {
                profileNote = ((error as? Api.Failure)?.message ?? "Uploaden lukte niet", true)
            }
        }
    }

    /// The middle square of a photo, 512 by 512, as a JPEG.
    static func square(_ image: UIImage) -> Data? {
        let side = min(image.size.width, image.size.height)
        guard side > 0 else { return nil }
        let target = CGSize(width: 512, height: 512)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let scaled = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            let k = 512 / side
            let w = image.size.width * k, h = image.size.height * k
            image.draw(in: CGRect(x: (512 - w) / 2, y: (512 - h) / 2, width: w, height: h))
        }
        return scaled.jpegData(compressionQuality: 0.86)
    }

    private func removePhoto() {
        photoBusy = true
        Task {
            do {
                try await SettingsRemote.removeAvatar()
                account.hasAvatar = false
                ImageLoader.shared.forget("avatar/\(account.id)")
                await store.load()
            } catch {
                profileNote = ((error as? Api.Failure)?.message ?? "Verwijderen lukte niet", true)
            }
            photoBusy = false
        }
    }

    // MARK: Name and username

    private var profileSection: some View {
        Section {
            TextField("Naam", text: $name).font(.inter(17)).textContentType(.name)
            HStack(spacing: 4) {
                Text("@").foregroundStyle(Brand.inkSoft)
                TextField("gebruikersnaam", text: Binding(get: { username }, set: { username = String($0.lowercased().filter { !$0.isWhitespace }.prefix(30)) }))
                    .font(.inter(17))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                Spacer(minLength: 4)
                if usernameChanged {
                    Group {
                        if checking { ProgressView().controlSize(.small) }
                        else if free == true { Label("Vrij", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
                        else if free == false { Label("Bezet", systemImage: "xmark.circle.fill").foregroundStyle(.red) }
                    }
                    .font(.inter(13, 600))
                    .transition(.opacity)
                }
            }
            LabeledContent("E-mail") { Text(account.email.isEmpty ? " " : account.email).foregroundStyle(Brand.inkSoft) }
            Button {
                saveProfile()
            } label: {
                HStack {
                    Text("Opslaan")
                    if savingProfile { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(savingProfile || name.trimmingCharacters(in: .whitespaces).isEmpty
                      || (name == account.displayName && !usernameChanged) || (usernameChanged && free == false))
        } header: { Text("Naam") } footer: {
            if let profileNote { Text(profileNote.0).foregroundStyle(profileNote.1 ? .red : Brand.inkSoft) }
            else { Text("Met je gebruikersnaam vinden anderen je om je aan een reis toe te voegen.") }
        }
        .animation(.calm, value: free)
    }

    private func saveProfile() {
        savingProfile = true
        profileNote = nil
        Task {
            do {
                try await SettingsRemote.saveProfile(displayName: name, username: usernameChanged ? username : nil)
                account.displayName = name
                if usernameChanged { account.username = username }
                profileNote = ("Opgeslagen", false)
                Haptic.tap()
                await store.load()
            } catch {
                profileNote = ((error as? Api.Failure)?.message ?? "Opslaan lukte niet", true)
            }
            savingProfile = false
        }
    }

    // MARK: Password

    private var passwordSection: some View {
        let strength = Self.strength(new)
        return Section {
            SecureField("Huidig wachtwoord", text: $current).textContentType(.password)
            SecureField("Nieuw wachtwoord", text: $new).textContentType(.newPassword)
            if !new.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Brand.sunken)
                            Capsule().fill(strength.color).frame(width: geo.size.width * strength.share)
                        }
                    }
                    .frame(height: 6)
                    Text(strength.label).font(.inter(13, 550)).foregroundStyle(strength.color)
                }
                .animation(.calm, value: strength.share)
                .transition(.opacity)
            }
            SecureField("Herhaal nieuw wachtwoord", text: $repeatNew).textContentType(.newPassword)
            Button {
                changePassword()
            } label: {
                HStack {
                    Text("Wachtwoord wijzigen")
                    if savingPassword { Spacer(); ProgressView().controlSize(.small) }
                }
            }
            .disabled(savingPassword || current.isEmpty || new.count < 10 || new != repeatNew)
        } header: { Text("Wachtwoord") } footer: {
            if let passwordNote { Text(passwordNote.0).foregroundStyle(passwordNote.1 ? .red : Brand.inkSoft) }
            else if !repeatNew.isEmpty && new != repeatNew { Text("De twee nieuwe wachtwoorden zijn niet gelijk.").foregroundStyle(.red) }
            else { Text("Minstens 10 tekens. Je blijft op dit toestel ingelogd.") }
        }
        .animation(.calm, value: new.isEmpty)
    }

    struct Strength { let share: CGFloat; let label: String; let color: Color }

    static func strength(_ p: String) -> Strength {
        var score = 0
        if p.count >= 10 { score += 1 }
        if p.count >= 14 { score += 1 }
        if p.rangeOfCharacter(from: .uppercaseLetters) != nil && p.rangeOfCharacter(from: .lowercaseLetters) != nil { score += 1 }
        if p.rangeOfCharacter(from: .decimalDigits) != nil { score += 1 }
        if p.rangeOfCharacter(from: CharacterSet.alphanumerics.inverted) != nil { score += 1 }
        if p.count < 10 { return Strength(share: 0.2, label: "Te kort", color: .red) }
        switch score {
        case ...2: return Strength(share: 0.45, label: "Zwak", color: .orange)
        case 3: return Strength(share: 0.7, label: "Redelijk", color: Color(hex: 0xD9A441))
        default: return Strength(share: 1, label: "Sterk", color: .green)
        }
    }

    private func changePassword() {
        savingPassword = true
        passwordNote = nil
        Task {
            do {
                try await SettingsRemote.changePassword(current: current, new: new)
                current = ""; new = ""; repeatNew = ""
                passwordNote = ("Je wachtwoord is gewijzigd", false)
                Haptic.tap()
            } catch {
                passwordNote = ((error as? Api.Failure)?.message ?? "Wijzigen lukte niet", true)
            }
            savingPassword = false
        }
    }

    // MARK: Two-step

    private var twoFactorSection: some View {
        Section {
            if let twoFactor {
                LabeledContent {
                    Text(twoFactor.enabled ? "Aan" : "Uit").foregroundStyle(twoFactor.enabled ? .green : Brand.inkSoft)
                } label: {
                    Label("Tweestapsverificatie", systemImage: twoFactor.enabled ? "checkmark.shield.fill" : "shield")
                }
                if twoFactor.enabled {
                    LabeledContent("Herstelcodes over") { Text("\(twoFactor.codesLeft)").foregroundStyle(Brand.inkSoft) }
                    Button("Nieuwe herstelcodes") { twoFactorFlow = .newCodes }
                    Button("Uitzetten", role: .destructive) { twoFactorFlow = .disable }
                } else {
                    Button("Aanzetten", systemImage: "qrcode") { twoFactorFlow = .enable }
                }
            } else {
                HStack { Text("Tweestapsverificatie"); Spacer(); ProgressView().controlSize(.small) }
            }
        } header: { Text("Tweestapsverificatie") } footer: {
            Text("Naast je wachtwoord een code uit een app als Google Authenticator of 1Password, zodat alleen jij erin kunt.")
        }
    }
}

enum TwoFactorFlow: String, Identifiable {
    case enable, disable, newCodes
    var id: String { rawValue }
}

/// Turning two-step on (password, QR and key, a code, then the recovery codes), off, or getting new codes.
private struct TwoFactorSheet: View {
    let flow: TwoFactorFlow
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var code = ""
    @State private var setup: (secret: String, uri: String)?
    @State private var codes: [String]?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Group {
                    if let codes {
                        Section {
                            if codes.isEmpty {
                                Text("Klaar.").font(.inter(15, 500))
                            } else {
                                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                                    ForEach(codes, id: \.self) { c in Text(c).font(.system(size: 16, weight: .medium, design: .monospaced)) }
                                }
                                .padding(.vertical, 6)
                                Button(copied ? "Gekopieerd" : "Kopieer alle codes", systemImage: copied ? "checkmark" : "doc.on.doc") {
                                    UIPasteboard.general.string = codes.joined(separator: "\n")
                                    copied = true
                                    Haptic.tap()
                                }
                            }
                        } header: { Text("Herstelcodes") } footer: {
                            Text("Bewaar ze ergens veilig. Elke code werkt één keer, als je je telefoon niet bij de hand hebt.")
                        }
                    } else if flow == .enable, let setup {
                        Section {
                            HStack { Spacer(); QRCode(text: setup.uri).frame(width: 200, height: 200); Spacer() }.padding(.vertical, 8)
                            HStack {
                                Text(setup.secret).font(.system(size: 14, weight: .medium, design: .monospaced)).lineLimit(2).textSelection(.enabled)
                                Spacer()
                                Button(copied ? "Gekopieerd" : "Kopieer") {
                                    UIPasteboard.general.string = setup.secret
                                    copied = true
                                    Haptic.tap()
                                }
                                .buttonStyle(.bordered).buttonBorderShape(.capsule)
                            }
                        } header: { Text("Scan met je authenticator-app") } footer: { Text("Of vul de sleutel met de hand in.") }
                        Section {
                            TextField("Code van 6 cijfers", text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                            Button("Aanzetten") { run { codes = try await SettingsRemote.twoFactorEnable(code: code) } }
                                .disabled(code.filter(\.isNumber).count < 6 || busy)
                        } footer: { if let error { Text(error).foregroundStyle(.red) } }
                    } else {
                        Section {
                            SecureField("Wachtwoord", text: $password).textContentType(.password)
                            if flow != .enable {
                                TextField("Code uit je app of een herstelcode", text: $code).textContentType(.oneTimeCode).autocorrectionDisabled()
                            }
                            Button(flow == .enable ? "Verder" : flow == .disable ? "Uitzetten" : "Nieuwe codes maken", role: flow == .disable ? .destructive : nil) { go() }
                                .disabled(password.isEmpty || (flow != .enable && code.trimmingCharacters(in: .whitespaces).count < 6) || busy)
                        } header: { Text(flow == .enable ? "Bevestig met je wachtwoord" : "Bevestig dat jij het bent") } footer: {
                            if let error { Text(error).foregroundStyle(.red) }
                            else if flow == .disable { Text("Daarna log je weer in met alleen je wachtwoord.") }
                            else if flow == .newCodes { Text("Je oude herstelcodes werken daarna niet meer.") }
                        }
                    }
                }
                .listRowBackground(Brand.raised)
            }
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle(flow == .enable ? "Tweestaps aanzetten" : flow == .disable ? "Tweestaps uitzetten" : "Nieuwe herstelcodes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if codes != nil { Button("Klaar") { dismiss() } } else { Button(role: .close) { dismiss() }.tint(.primary) }
                }
            }
            .animation(.calm, value: codes)
        }
        .onDisappear { password = ""; code = ""; onDone() }
    }

    private func go() {
        switch flow {
        case .enable:
            run {
                guard let s = try await SettingsRemote.twoFactorSetup(password: password) else { throw Api.Failure(message: "De server stuurde geen sleutel terug") }
                setup = s
                password = ""
            }
        case .disable:
            run {
                try await SettingsRemote.twoFactorDisable(password: password, code: code)
                codes = []
            }
        case .newCodes:
            run { codes = try await SettingsRemote.twoFactorNewCodes(password: password, code: code) }
        }
    }

    private func run(_ work: @escaping () async throws -> Void) {
        busy = true
        error = nil
        Task {
            do { try await work(); Haptic.tap() } catch { self.error = (error as? Api.Failure)?.message ?? "Dat lukte niet" }
            busy = false
        }
    }
}

/// A QR code, drawn crisp at any size.
struct QRCode: View {
    let text: String

    var body: some View {
        if let image = Self.make(text) {
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                .padding(10)
                .background(.white, in: .rect(cornerRadius: 14))
                .accessibilityLabel("QR-code voor je authenticator-app")
        }
    }

    static func make(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let out = filter.outputImage, let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
