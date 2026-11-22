import SwiftUI

/// A flight filled in properly: its number, the airports it flew from and to and any layovers, each airport picked
/// from the list by tapping a suggestion, never just typed.
struct FlightSheet: View {
    let target: FlightTarget
    let onSave: (_ number: String, _ from: String?, _ to: String?, _ via: [String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var number: String
    @State private var from: String?
    @State private var to: String?
    @State private var via: [Layover]
    @State private var nextVia = 0
    /// Which airport field has the search open, so one opens at a time.
    @State private var editing: String?

    struct Layover: Identifiable, Hashable {
        let id: Int
        var code: String?
    }

    init(target: FlightTarget, onSave: @escaping (String, String?, String?, [String]) -> Void) {
        self.target = target
        self.onSave = onSave
        _number = State(initialValue: target.number)
        _from = State(initialValue: target.from)
        _to = State(initialValue: target.to)
        _via = State(initialValue: target.via.enumerated().map { Layover(id: $0.offset, code: $0.element) })
        _nextVia = State(initialValue: target.via.count)
    }

    var body: some View {
        let codes = [from].compactMap { $0 } + via.compactMap(\.code) + [to].compactMap { $0 }
        let time = from != nil && to != nil ? FlightAirports.flightTime(codes) : nil
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    if let subtitle = target.subtitle {
                        Text(subtitle).font(.inter(14, 500)).foregroundStyle(Brand.inkSoft).padding(.leading, 4)
                    }
                    label("Vluchtnummer")
                    TextField("bijv. KL1703", text: Binding(get: { number }, set: { number = String($0.uppercased().prefix(16)) }))
                        .font(.inter(16, 500))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 16)
                        .frame(height: 54)
                        .background(Brand.sunken, in: .rect(cornerRadius: 18))
                    label("Van")
                    AirportField(code: $from, key: "from", editing: $editing, hint: "Stad, vliegveld of code")
                    label("Overstappen")
                    VStack(alignment: .leading, spacing: 8) {
                        if via.isEmpty {
                            Text("Directe vlucht.").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft).padding(.leading, 4)
                        }
                        ForEach($via) { $stop in
                            HStack(alignment: .top, spacing: 8) {
                                AirportField(code: $stop.code, key: "via\(stop.id)", editing: $editing, hint: "Overstap op")
                                Button {
                                    Haptic.tap()
                                    withAnimation(.calm) { via.removeAll { $0.id == stop.id } }
                                } label: {
                                    Image(systemName: "minus").font(.system(size: 14, weight: .bold)).foregroundStyle(Brand.ink)
                                        .frame(width: 54, height: 54)
                                        .background(Brand.sunken, in: .rect(cornerRadius: 18))
                                }
                                .buttonStyle(PressStyle(scale: 0.94))
                                .accessibilityLabel("Overstap verwijderen")
                            }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                        Button {
                            Haptic.tap()
                            withAnimation(.calm) {
                                via.append(Layover(id: nextVia, code: nil))
                                editing = "via\(nextVia)"
                                nextVia += 1
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus").font(.system(size: 13, weight: .bold))
                                Text("Overstap toevoegen")
                            }
                            .font(.outfit(14.5, 600)).foregroundStyle(Brand.accent)
                                .padding(.horizontal, 14).frame(height: 40)
                                .background(Brand.sunken, in: .capsule)
                        }
                        .buttonStyle(PressStyle(scale: 0.96))
                    }
                    label("Naar")
                    AirportField(code: $to, key: "to", editing: $editing, hint: "Stad, vliegveld of code")
                    if let time {
                        HStack(spacing: 8) {
                            Image(systemName: "airplane").font(.system(size: 14, weight: .semibold)).foregroundStyle(Brand.accent)
                            Text("Ongeveer \(time) reizen").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft)
                        }
                        .padding(.top, 14)
                        .padding(.leading, 4)
                        .transition(.opacity)
                    }
                    Button {
                        Haptic.tap()
                        onSave(number, from, to, via.compactMap(\.code))
                        dismiss()
                    } label: {
                        Text("Opslaan").font(.outfit(16, 650)).frame(maxWidth: .infinity).frame(height: 52)
                    }
                    .buttonStyle(.borderedProminent)
                    .buttonBorderShape(.capsule)
                    .padding(.top, 22)
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 24)
                .animation(.calm, value: via)
                .animation(.calm, value: time)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Brand.paper)
            .navigationTitle(target.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) } }
        }
        .presentationDetents([.large])
        .task {
            // An empty airport starts at the one nearest the city it leaves from or flies to, as on the web.
            await FlightAirports.shared.load()
            if from == nil, let a = await FlightAirports.shared.nearest(target.nearFrom) { from = a.iata }
            if to == nil, let a = await FlightAirports.shared.nearest(target.nearTo) { to = a.iata }
        }
    }

    private func label(_ text: String) -> some View {
        Text(text).font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft).padding(.top, 16).padding(.bottom, 6).padding(.leading, 4)
    }
}

/// One airport: the chosen one as a chip, or, once tapped, a search whose suggestions are the only way to choose. An
/// exact code gets its suggestion too ("EIN" shows "Eindhoven (EIN)"), so typing alone never fills the field. Your
/// own airports are offered first while nothing is typed.
private struct AirportField: View {
    @Binding var code: String?
    let key: String
    @Binding var editing: String?
    let hint: String
    @State private var draft = ""
    @State private var results: [FlightAirports.Airport] = []
    @FocusState private var focused: Bool

    private var open: Bool { editing == key || code == nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if open {
                TextField(code.map { FlightAirports.label($0) } ?? hint, text: $draft)
                    .font(.inter(16, 500))
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .frame(height: 54)
                    .background(Brand.sunken, in: .rect(cornerRadius: 18))
                    .onChange(of: focused) { _, on in
                        if on { editing = key } else if editing == key && code != nil { editing = nil; draft = "" }
                    }
                    .onAppear { if editing == key { focused = true } }
            } else if let code {
                Button {
                    editing = key
                    focused = true
                } label: {
                    HStack(spacing: 8) {
                        HStack(spacing: 8) {
                            if let a = FlightAirports.byCode[code] { FlagView(flag: a.country, height: 13) }
                            Text(FlightAirports.label(code)).font(.outfit(15, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                            Button {
                                self.code = nil
                                draft = ""
                                editing = key
                            } label: {
                                Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Brand.ink).frame(width: 28, height: 28)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Vliegveld weghalen")
                        }
                        .padding(.leading, 12)
                        .padding(.trailing, 4)
                        .frame(height: 38)
                        .background(Brand.accent.opacity(0.16), in: .capsule)
                        Spacer(minLength: 4)
                        Text("Wijzigen").font(.outfit(14, 600)).foregroundStyle(Brand.accent).padding(.trailing, 8)
                    }
                    .padding(.horizontal, 8)
                    .frame(height: 54)
                    .background(Brand.sunken, in: .rect(cornerRadius: 18))
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
            }
            let shown: [FlightAirports.Airport] = open
                ? (draft.trimmingCharacters(in: .whitespaces).count >= 2 ? results : (focused ? Prefs.airports.compactMap { FlightAirports.byCode[$0] } : []))
                : []
            if !shown.isEmpty {
                VStack(spacing: 2) {
                    if draft.trimmingCharacters(in: .whitespaces).count < 2 {
                        Text("Jouw vliegvelden").font(.outfit(13, 600)).foregroundStyle(Brand.inkSoft).frame(maxWidth: .infinity, alignment: .leading).padding(.leading, 4).padding(.bottom, 4)
                    }
                    ForEach(Array(shown.enumerated()), id: \.element.iata) { i, a in
                        Button {
                            Haptic.select()
                            code = a.iata
                            draft = ""
                            editing = nil
                            focused = false
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text("\(a.city) (\(a.iata))").font(.outfit(15, 600)).foregroundStyle(Brand.ink).lineLimit(1)
                                    Text("\(a.name) · \(Remote.countryName(a.country))").font(.inter(12.5, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                FlagView(flag: a.country, height: 13)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Brand.raised, in: UnevenRoundedRectangle(
                                topLeadingRadius: i == 0 ? 18 : 6, bottomLeadingRadius: i == shown.count - 1 ? 18 : 6,
                                bottomTrailingRadius: i == shown.count - 1 ? 18 : 6, topTrailingRadius: i == 0 ? 18 : 6))
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        // The calm curve the suggestions open and close on: no overshoot.
        .animation(.easeOut(duration: 0.22), value: shown(open: open))
        .task(id: draft) {
            let q = draft.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            results = await FlightAirports.shared.search(q)
        }
    }

    private func shown(open: Bool) -> [String] { open ? results.map(\.iata) + [focused ? "f" : ""] : [] }
}
