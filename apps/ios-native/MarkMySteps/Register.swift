import SwiftUI

/*
 * The way in for someone new, as the web and Android: ask a server for an account, and wait for its admin to let
 * you in (the app looks by itself). "Doorgaan zonder server" from Android is not here: on iPhone the app has no
 * server of its own on the phone yet.
 */

/// Account maken: server, name, username, email and a password of ten characters or more. The first account of a
/// server is in at once; anyone after waits for the admin.
struct RegisterView: View {
    let onApproved: () -> Void
    let onPending: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var server = Api.shared.host
    @State private var name = ""
    @State private var username = ""
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?

    private enum Field { case server, name, username, email, password }

    private var usernameOk: Bool { username.trimmingCharacters(in: .whitespaces).wholeMatch(of: /[a-zA-Z0-9._-]{3,30}/) != nil }
    private var emailOk: Bool { email.trimmingCharacters(in: .whitespaces).wholeMatch(of: /[^@\s]+@[^@\s]+\.[^@\s]+/) != nil }
    private var ready: Bool {
        !server.trimmingCharacters(in: .whitespaces).isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty
            && usernameOk && emailOk && password.count >= 10
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).frame(width: 26, height: 26)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .tint(.primary)
                    .accessibilityLabel("Terug")

                    HStack(spacing: 14) {
                        CompassLogo(size: 36)
                        Text("Account maken").font(.outfit(30, 700)).tracking(-0.6).foregroundStyle(Brand.ink)
                    }
                    .padding(.top, 18)
                    Text("Vraag een account aan op je eigen server. De beheerder laat je toe.")
                        .font(.inter(15, 500))
                        .foregroundStyle(Brand.inkSoft)
                        .padding(.top, 10)
                        .padding(.bottom, 20)

                    card
                        .onChange(of: focus) { _, field in
                            guard let field else { return }
                            // The field in use, and the button under the password, stay above the keyboard.
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                                withAnimation(.smooth) {
                                    if field == .password { proxy.scrollTo("submit", anchor: .bottom) } else { proxy.scrollTo(field, anchor: .center) }
                                }
                            }
                        }

                    Button("Ik heb al een account") { dismiss() }
                        .font(.outfit(15, 600))
                        .buttonStyle(.borderless)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollIndicators(.hidden)
        }
        .background(Brand.paper)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            AuthField("Server") {
                TextField("jouw-server.nl", text: $server)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .focused($focus, equals: .server)
                    .submitLabel(.next)
                    .onSubmit { focus = .name }
            }
            .id(Field.server)
            AuthField("Naam") {
                TextField("", text: $name)
                    .textContentType(.name)
                    .textInputAutocapitalization(.words)
                    .focused($focus, equals: .name)
                    .submitLabel(.next)
                    .onSubmit { focus = .username }
            }
            .id(Field.name)
            AuthField("Gebruikersnaam", hint: "Hiermee voegen vrienden je toe aan reizen. 3 tot 30 letters, cijfers, punt, streepje of underscore.",
                      hintIsError: !username.isEmpty && !usernameOk) {
                HStack(spacing: 2) {
                    Text("@").foregroundStyle(Brand.inkSoft)
                    TextField("bijv. mark", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .focused($focus, equals: .username)
                        .submitLabel(.next)
                        .onSubmit { focus = .email }
                        .onChange(of: username) { _, v in
                            let clean = String(v.trimmingCharacters(in: .whitespaces).prefix(30))
                            if clean != v { username = clean }
                        }
                }
            }
            .id(Field.username)
            AuthField("E-mail") {
                TextField("", text: $email)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .focused($focus, equals: .email)
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
            }
            .id(Field.email)
            AuthField("Wachtwoord", hint: "Minimaal 10 tekens", hintIsError: !password.isEmpty && password.count < 10) {
                HStack(spacing: 6) {
                    Group {
                        if showPassword { TextField("", text: $password) } else { SecureField("", text: $password) }
                    }
                    .textContentType(.newPassword)
                    .textInputAutocapitalization(.never)
                    .focused($focus, equals: .password)
                    .submitLabel(.go)
                    .onSubmit(submit)
                    Button { showPassword.toggle() } label: {
                        Image(systemName: showPassword ? "eye" : "eye.slash")
                            .contentTransition(.symbolEffect(.replace))
                            .foregroundStyle(Brand.inkSoft)
                            .frame(width: 36, height: 36)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(showPassword ? "Wachtwoord verbergen" : "Wachtwoord tonen")
                }
            }
            .id(Field.password)

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.inter(14, 600))
                    .foregroundStyle(.red)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Button(action: submit) {
                // The label and a small spinner share one fixed box and cross-fade: nothing changes size.
                ZStack {
                    Text("Account maken").font(.outfit(17, 650)).opacity(busy ? 0 : 1)
                    ProgressView().controlSize(.small).tint(.white).opacity(busy ? 1 : 0)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 22)
                .animation(.easeInOut(duration: 0.2), value: busy)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            .disabled(!ready && !busy)
            .padding(.bottom, 8)
            .id("submit")
        }
        .padding(16)
        .background(Brand.raised, in: .rect(cornerRadius: 26))
        .animation(.calm, value: error)
    }

    private func submit() {
        guard ready, !busy else { return }
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                let status = try await Api.shared.register(server: server, email: email, username: username, displayName: name, password: password)
                password = ""
                if status == "APPROVED" { onApproved() } else { onPending() }
            } catch let failure as Api.Failure {
                error = switch failure.status {
                case 409: "Dat e-mailadres of die gebruikersnaam is al in gebruik."
                case 403: "Er wachten te veel mensen op goedkeuring op deze server. Probeer het later opnieuw."
                case 429: "Te veel pogingen. Probeer het over een uur opnieuw."
                default: failure.message
                }
            } catch {
                self.error = "Kan de server niet bereiken"
            }
        }
    }
}

/// A labelled field of the way in, as on the sign-in card: the label above, the field sunken in the card, and
/// under it a quiet hint that turns red while what is typed does not fit.
struct AuthField<Content: View>: View {
    let label: String
    var hint: String? = nil
    var hintIsError = false
    @ViewBuilder let content: Content

    init(_ label: String, hint: String? = nil, hintIsError: Bool = false, @ViewBuilder content: () -> Content) {
        self.label = label
        self.hint = hint
        self.hintIsError = hintIsError
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 6)
            content
                .font(.inter(17))
                .autocorrectionDisabled()
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .frame(height: 50)
                .background(Brand.sunken, in: .rect(cornerRadius: 16))
            if let hint {
                Text(hint)
                    .font(.inter(12.5, 500))
                    .foregroundStyle(hintIsError ? Color.red : Brand.inkSoft)
                    .padding(.horizontal, 6)
                    .animation(.calm, value: hintIsError)
            }
        }
    }
}

/// Waiting for the admin, as the web's PendingPage: the compass turns while the server decides. The app asks every
/// twenty seconds and whenever it comes back to the front; approved, it carries on by itself, refused, it says so
/// and goes back to signing in.
struct PendingView: View {
    let onApproved: () -> Void
    let onSignOut: () -> Void
    /// A look at the page for screenshots (`-page pending`): it never asks the server anything.
    var preview = false
    @Environment(\.scenePhase) private var phase
    @State private var checking = false
    @State private var failed: String?
    @State private var rejected = false
    @State private var checkedAt: Date?
    @State private var wake = 0

    var body: some View {
        VStack(spacing: 12) {
            if rejected {
                Image(systemName: "xmark")
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.red)
                    .frame(width: 64, height: 64)
                    .background(Color.red.opacity(0.12), in: .circle)
                title("Niet goedgekeurd")
                line("De beheerder van deze server heeft je aanvraag afgewezen. Neem contact met diegene op als je denkt dat dat niet klopt.")
                Button(action: onSignOut) { Text("Terug naar inloggen").font(.outfit(16, 600)).frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .padding(.top, 6)
            } else {
                // The needle sweeps round while you wait: something is happening, and it cannot be hurried.
                CompassSpinner(size: 40)
                    .frame(width: 64, height: 64)
                    .background(Brand.accent.opacity(0.14), in: .circle)
                title("Even wachten op goedkeuring")
                line("Je aanvraag staat klaar bij de beheerder van deze server. Zodra die je toelaat, ga je vanzelf door naar de app.")
                line("Je mag de app sluiten. Open je hem weer, dan kijkt hij meteen opnieuw.", small: true)
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    Text(status(now: context.date))
                        .font(.inter(13, 550))
                        .foregroundStyle(failed == nil ? Brand.inkSoft : .red)
                        .contentTransition(.opacity)
                }
                .padding(.top, 4)
                Button(action: onSignOut) { Text("Uitloggen").font(.outfit(16, 600)).frame(maxWidth: .infinity) }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .padding(.top, 6)
            }
        }
        .padding(24)
        .background(Brand.raised, in: .rect(cornerRadius: 32))
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Brand.paper)
        .animation(.calm, value: rejected)
        .onChange(of: phase) { _, now in if now == .active { wake += 1 } }
        .task(id: wake) { await watch() }
    }

    private func title(_ text: String) -> some View {
        Text(text).font(.outfit(22, 650)).foregroundStyle(Brand.ink).multilineTextAlignment(.center)
    }

    private func line(_ text: String, small: Bool = false) -> some View {
        Text(text).font(.inter(small ? 13.5 : 15, 500)).foregroundStyle(Brand.inkSoft).multilineTextAlignment(.center)
    }

    private func status(now: Date) -> String {
        if let failed { return failed }
        if checking { return "Controleren…" }
        guard let checkedAt else { return "Nog niet gecontroleerd" }
        let minutes = Int(now.timeIntervalSince(checkedAt) / 60)
        return minutes < 1 ? "Net gecontroleerd" : "\(minutes) min geleden gecontroleerd"
    }

    private func watch() async {
        guard !preview else { return }
        while !Task.isCancelled {
            checking = true
            do {
                let state = try await Api.shared.approval()
                failed = nil
                checkedAt = Date()
                checking = false
                if state == "REJECTED" { rejected = true; return }
                if state == "APPROVED" {
                    if await Api.shared.upgrade() { onApproved(); return }
                }
            } catch {
                failed = (error as? Api.Failure)?.message ?? "Kon de status niet ophalen"
            }
            checking = false
            try? await Task.sleep(for: .seconds(20))
        }
    }
}
