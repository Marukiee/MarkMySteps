import SwiftUI

/*
 * Signing in: the globe turning above, the app's name, and one card with the
 * server, the name and the password. An account with an authenticator app
 * gets a second step for its code. "Bekijk met voorbeelden" opens the app on
 * the invented trips instead.
 */
struct LoginView: View {
    /// Why signing in is asked again, e.g. an expired session.
    var notice: String? = nil
    let onDone: () -> Void
    let onDemo: () -> Void

    @State private var server = Api.shared.host
    @State private var name = ""
    @State private var password = ""
    @State private var code = ""
    @State private var showPassword = false
    @State private var mfaToken: String? = Launch.step == "code" ? "preview" : nil
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    @State private var topInset: CGFloat = 60

    private enum Field { case server, name, password, code }

    private var canSubmit: Bool {
        if busy { return false }
        if mfaToken == nil { return !server.trimmingCharacters(in: .whitespaces).isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty }
        return code.count >= 6
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // A fixed height: the globe must not shrink when the keyboard takes room. It stays below the
                // Dynamic Island; above it the page colour fades softly into the globe, never a hard band.
                GlobeHero(trips: Demo.past + [Demo.upcoming])
                    .frame(height: 270)
                    .frame(maxWidth: .infinity)
                    .overlay(alignment: .top) {
                        LinearGradient(colors: [Brand.paper, Brand.paper.opacity(0)], startPoint: .top, endPoint: .bottom)
                            .frame(height: 56)
                            .allowsHitTesting(false)
                    }
                    .padding(.top, topInset)
                    .overlay(alignment: .bottom) {
                        LinearGradient(colors: [Brand.paper.opacity(0), Brand.paper], startPoint: .top, endPoint: .bottom)
                            .frame(height: 90)
                            .allowsHitTesting(false)
                    }

                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 14) {
                        // The brand mark as everywhere: the compass on its own, in the accent colour.
                        CompassLogo(size: 40)
                        Text("MarkMySteps").font(.outfit(30, 700)).tracking(-0.6).foregroundStyle(Brand.ink)
                    }
                    Text("Log in op je eigen server om je reizen te zien.")
                        .font(.inter(15, 500))
                        .foregroundStyle(Brand.inkSoft)
                        .padding(.top, 10)
                        .padding(.bottom, 20)

                    card

                    Button(action: onDemo) {
                        Text("Bekijk met voorbeelden").font(.outfit(16, 600)).frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .buttonBorderShape(.capsule)
                    .controlSize(.large)
                    .padding(.top, 12)

                    Text("Deze testapp leest alleen. Hij verandert niets aan je reizen.")
                        .font(.inter(12.5, 500))
                        .foregroundStyle(Brand.inkSoft)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 14)
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
        }
        // The focused field, and the button under it, scroll up above the keyboard.
        .onChange(of: focus) { _, field in
            guard let field else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                withAnimation(.smooth) {
                    if field == .password || field == .code { proxy.scrollTo("submit", anchor: .bottom) }
                    else { proxy.scrollTo(field, anchor: .center) }
                }
            }
        }
        }
        .scrollDismissesKeyboard(.interactively)
        .scrollIndicators(.hidden)
        .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { if $0 > 0 { topInset = $0 } }
        .ignoresSafeArea(.container, edges: .top)
        .background(Brand.paper)
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            Group {
                if mfaToken == nil {
                    VStack(alignment: .leading, spacing: 14) {
                        field("Server") {
                            TextField("jouw-server.nl", text: $server)
                                .keyboardType(.URL)
                                .textContentType(.URL)
                                .textInputAutocapitalization(.never)
                                .focused($focus, equals: .server)
                                .id(Field.server)
                                .submitLabel(.next)
                                .onSubmit { focus = .name }
                        }
                        field("Gebruikersnaam of e-mail") {
                            TextField("", text: $name)
                                .keyboardType(.emailAddress)
                                .textContentType(.username)
                                .textInputAutocapitalization(.never)
                                .focused($focus, equals: .name)
                                .id(Field.name)
                                .submitLabel(.next)
                                .onSubmit { focus = .password }
                        }
                        field("Wachtwoord") {
                            HStack(spacing: 6) {
                                Group {
                                    if showPassword { TextField("", text: $password) } else { SecureField("", text: $password) }
                                }
                                .textContentType(.password)
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
                    }
                    .transition(.asymmetric(insertion: .move(edge: .leading).combined(with: .opacity), removal: .move(edge: .leading).combined(with: .opacity)))
                } else {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("Vul de code uit je authenticator-app in.")
                            .font(.inter(15, 500))
                            .foregroundStyle(Brand.inkSoft)
                        field("Code") {
                            TextField("123456", text: $code)
                                .keyboardType(.numberPad)
                                .textContentType(.oneTimeCode)
                                .focused($focus, equals: .code)
                                .onChange(of: code) { _, v in
                                    let clean = String(v.filter { $0.isLetter || $0.isNumber }.prefix(12))
                                    if clean != v { code = clean; return }
                                    // Six digits sign in by themselves; a longer recovery code waits for the button.
                                    if clean.count == 6 && clean.allSatisfy(\.isNumber) { submit() }
                                }
                                .onAppear { focus = .code }
                        }
                    }
                    .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .move(edge: .trailing).combined(with: .opacity)))
                }
            }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.inter(14, 600))
                    .foregroundStyle(.red)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            Button(action: submit) {
                // The label and a small spinner share one fixed box and cross-fade: nothing changes size.
                ZStack {
                    Text(mfaToken == nil ? "Inloggen" : "Bevestigen").font(.outfit(17, 650)).opacity(busy ? 0 : 1)
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                        .opacity(busy ? 1 : 0)
                }
                .frame(maxWidth: .infinity)
                .frame(height: 22)
                .animation(.easeInOut(duration: 0.2), value: busy)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.capsule)
            .controlSize(.large)
            // Stays in its own colour while busy; a second tap is ignored in submit().
            .disabled(!canSubmit && !busy)
            .padding(.bottom, 8)
            .id("submit")

            if mfaToken != nil {
                Button {
                    withAnimation(.calm) { mfaToken = nil; code = ""; error = nil }
                } label: {
                    Label("Ander account", systemImage: "chevron.left").font(.inter(15, 550))
                }
                .buttonStyle(.borderless)
                .frame(maxWidth: .infinity)
                .transition(.opacity)
            }
        }
        .padding(16)
        .background(Brand.raised, in: .rect(cornerRadius: 26))
        .animation(.calm, value: mfaToken)
        .animation(.calm, value: error)
        .onAppear { if error == nil, let notice { error = notice } }
    }

    private func field<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 6)
            content()
                .font(.inter(17))
                .autocorrectionDisabled()
                .padding(.leading, 16)
                .padding(.trailing, 8)
                .frame(height: 50)
                .background(Brand.sunken, in: .rect(cornerRadius: 16))
        }
    }

    private func submit() {
        guard canSubmit, !busy else { return }
        error = nil
        busy = true
        Task {
            defer { busy = false }
            do {
                if let token = mfaToken {
                    try await Api.shared.loginCode(mfaToken: token, code: code)
                    password = ""; code = ""
                    onDone()
                } else {
                    switch try await Api.shared.login(server: server, identifier: name, password: password) {
                    case .needsCode(let token):
                        withAnimation(.calm) { mfaToken = token }
                        focus = .code
                    case .done:
                        password = ""
                        onDone()
                    }
                }
            } catch let failure as Api.Failure {
                error = switch failure.status {
                case 401: mfaToken == nil ? "Naam of wachtwoord klopt niet" : "Die code klopt niet"
                case 429: "Even te vaak geprobeerd, wacht een minuut"
                default: failure.message
                }
            } catch {
                self.error = "Kan de server niet bereiken"
            }
        }
    }
}
