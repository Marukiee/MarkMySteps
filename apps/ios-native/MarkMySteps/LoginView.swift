import SwiftUI

/*
 * Signing in, short and calm as on Android: the compass in a slowly turning cookie shape, the app's name and one
 * line, then one card with the server (a line you tap to change), the name and the password. An account with an
 * authenticator app gets a second step for its code. Under the card two joined pills: Account maken, and Zonder
 * server, which on iPhone explains that a phone without a server is not there yet and offers the examples.
 */
struct LoginView: View {
    /// Why signing in is asked again, e.g. an expired session.
    var notice: String? = nil
    let onDone: () -> Void
    let onDemo: () -> Void
    /// A new account that waits for the server's admin.
    var onPending: () -> Void = {}

    @State private var server = Api.shared.host
    @State private var name = ""
    @State private var password = ""
    @State private var code = ""
    @State private var showPassword = false
    @State private var mfaToken: String? = Launch.step == "code" ? "preview" : nil
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focus: Field?
    @State private var registering = Launch.page == "register"
    /// The server is set once and rarely changed: one line to tap, a field only then.
    @State private var editServer = Api.shared.host.isEmpty
    @State private var noServer = false

    private enum Field { case server, name, password, code }

    private var canSubmit: Bool {
        if busy { return false }
        if mfaToken == nil { return !server.trimmingCharacters(in: .whitespaces).isEmpty && !name.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty }
        return code.count >= 6
    }

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(spacing: 0) {
                brand
                    .padding(.top, 36)
                    .padding(.bottom, 28)

                VStack(alignment: .leading, spacing: 0) {
                    card

                    // The other ways in, as on Android: ask your server for an account, or (on Android) keep
                    // everything on this phone. Two tonal pills joined as one group, under the card.
                    if mfaToken == nil {
                        HStack(spacing: 3) {
                            joinedPill("Account maken", leading: true) { Haptic.tap(); registering = true }
                            joinedPill("Zonder server", leading: false) { Haptic.tap(); noServer = true }
                        }
                        .padding(.top, 12)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
                .animation(.calm, value: mfaToken)
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
        .scrollBounceBehavior(.basedOnSize)
        .background(Brand.paper)
        .fullScreenCover(isPresented: $registering) {
            RegisterView(onApproved: { registering = false; onDone() }, onPending: { registering = false; onPending() })
        }
        .alert("Zonder server", isPresented: $noServer) {
            Button("Bekijk voorbeelden") { onDemo() }
            Button("Annuleren", role: .cancel) {}
        } message: {
            Text("Op de iPhone werkt MarkMySteps nog niet zonder eigen server: daar is opslag op de telefoon voor nodig. Zolang kun je de app bekijken met voorbeeldreizen.")
        }
    }

    /// The brand on its own: the compass, still, in a soft cookie shape that turns slowly behind it.
    private var brand: some View {
        VStack(spacing: 0) {
            ZStack {
                SpinningCookie()
                    .foregroundStyle(Brand.accent.opacity(0.16))
                CompassLogo(size: 58, lineWidth: 2)
            }
            .frame(width: 120, height: 120)
            Text("MarkMySteps")
                .font(.outfit(34, 700))
                .tracking(-0.7)
                .foregroundStyle(Brand.ink)
                .padding(.top, 22)
            Text("Log in op je eigen server om je reizen te zien.")
                .font(.inter(15, 500))
                .foregroundStyle(Brand.inkSoft)
                .multilineTextAlignment(.center)
                .padding(.top, 6)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity)
    }

    /// One of the two joined pills: round on the outside, tight where they meet.
    private func joinedPill(_ label: String, leading: Bool, action: @escaping () -> Void) -> some View {
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: leading ? 26 : 8, bottomLeadingRadius: leading ? 26 : 8,
            bottomTrailingRadius: leading ? 8 : 26, topTrailingRadius: leading ? 8 : 26, style: .continuous
        )
        return Button(action: action) {
            Text(label)
                .font(.outfit(15, 600))
                .foregroundStyle(Brand.ink)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Brand.raised, in: shape)
                .contentShape(shape)
        }
        .buttonStyle(PressStyle(scale: 0.97))
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 14) {
            Group {
                if mfaToken == nil {
                    VStack(alignment: .leading, spacing: 14) {
                        if editServer {
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
                            .transition(.opacity)
                        } else {
                            serverLine.transition(.opacity)
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

    /// The server as one quiet line: what it is, the address, a pencil. A tap turns it into the field.
    private var serverLine: some View {
        Button {
            Haptic.tap()
            withAnimation(.calm) { editServer = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { focus = .server }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "cloud").font(.system(size: 17, weight: .semibold)).foregroundStyle(Brand.accent)
                    .frame(width: 22)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Server").font(.outfit(12.5, 600)).foregroundStyle(Brand.inkSoft)
                    Text(server.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: ""))
                        .font(.inter(15, 500)).foregroundStyle(Brand.ink).lineLimit(1).truncationMode(.middle)
                }
                Spacer(minLength: 8)
                Image(systemName: "pencil").font(.system(size: 15, weight: .semibold)).foregroundStyle(Brand.inkSoft)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Brand.sunken, in: .rect(cornerRadius: 18, style: .continuous))
            .contentShape(.rect(cornerRadius: 18))
        }
        .buttonStyle(PressStyle(scale: 0.98))
        .accessibilityLabel("Server: \(server). Wijzigen")
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

/// Material's nine-sided cookie, as a shape: a circle with nine soft bumps.
struct CookieShape: Shape {
    var lobes = 9
    var depth: CGFloat = 0.075

    nonisolated func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let steps = 240
        var path = Path()
        for i in 0...steps {
            let t = Double(i) / Double(steps) * 2 * .pi
            // Peaks at the full radius, valleys a little in: (1 - depth) + depth * (1 + cos) / 2.
            let r = outer * ((1 - depth) + depth * (1 + cos(Double(lobes) * t)) / 2)
            let p = CGPoint(x: c.x + r * cos(t - .pi / 2), y: c.y + r * sin(t - .pi / 2))
            if i == 0 { path.move(to: p) } else { path.addLine(to: p) }
        }
        path.closeSubpath()
        return path
    }
}

/// The cookie turning once every 40 seconds, steadily; still under Reduce Motion and in screenshots.
private struct SpinningCookie: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if reduceMotion || Launch.shot {
            CookieShape()
        } else {
            TimelineView(.animation) { tl in
                let t = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 40) / 40
                CookieShape().rotationEffect(.degrees(t * 360))
            }
        }
    }
}
