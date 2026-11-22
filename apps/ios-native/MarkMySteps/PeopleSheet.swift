import SwiftUI
import UIKit

/*
 * Mensen en delen, opened from the faces on the cover and from the trip's
 * menu: who is on the trip and in which role, adding people (the server
 * suggests companions first), and share links to copy or revoke. Changes are
 * only made when the owner taps them.
 */
struct PeopleSheet: View {
    let trip: Trip
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var links: [Remote.ShareLink]?
    @State private var query = ""
    @State private var suggestions: [Remote.Friend] = []
    @State private var busy: String?
    @State private var error: String?
    @State private var copied: String?
    @State private var revoking: Remote.ShareLink?
    @State private var removing: Person?
    @State private var newPassword = ""
    @State private var passwordFor: Remote.ShareLink?
    @State private var passwordText = ""
    @State private var picked: Set<String> = []
    @State private var asGuest = false
    @State private var daysFor: Person?
    @State private var revealed: (link: Remote.ShareLink, password: String?, recoverable: Bool)?

    private var live: Bool { trip.remoteId != nil }
    /// Screenshots only (`-menuPreview YES`): the demo trip as your own, with the demo's friends as suggestions; nothing
    /// can be sent, a demo trip has no server id.
    private var canManage: Bool { (live && trip.ownerId != nil && trip.ownerId == store.me?.id) || Launch.menuPreview }
    /// The trip as the store has it now, so changes show as soon as the list reloads.
    private var current: Trip { store.trips.first { $0.id == trip.id } ?? trip }

    private var members: [Person] {
        let order = ["OWNER": 0, "MEMBER": 1, "GUEST": 2]
        let list = live ? current.members : current.people
        return list.sorted { (order[$0.role] ?? 3, $0.name) < (order[$1.role] ?? 3, $1.name) }
    }

    var body: some View {
        NavigationStack {
            List {
                if let error {
                    Section { Label(error, systemImage: "exclamationmark.circle.fill").foregroundStyle(.red) }
                }
                Section {
                    ForEach(members, id: \.self) { person in memberRow(person) }
                } header: {
                    Text("Op deze reis")
                } footer: {
                    if !live { Text("In de voorbeelden kun je niemand toevoegen of verwijderen.") }
                    else if !canManage { Text("Alleen de eigenaar van de reis past mensen en rollen aan.") }
                }
                .listRowBackground(Brand.raised)

                if canManage {
                    Section {
                        Picker("Toevoegen als", selection: $asGuest) {
                            Text("Reisgenoot").tag(false)
                            Text("Gast").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .sensoryFeedback(.selection, trigger: asGuest)
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkSoft)
                            TextField("Naam of gebruikersnaam", text: $query)
                                .font(.inter(17))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .submitLabel(.search)
                        }
                        // Pick several, then add them in one go.
                        ForEach(suggestions.filter { s in !current.members.contains { $0.userId == s.id } }) { s in
                            let on = picked.contains(s.username)
                            Button {
                                Haptic.select()
                                withAnimation(.calm) { if on { picked.remove(s.username) } else { picked.insert(s.username) } }
                            } label: {
                                HStack(spacing: 12) {
                                    Avatar(userId: s.id, hasAvatar: s.hasAvatar, initial: String(s.name.prefix(1)).uppercased(), color: Color(hex: 0x5B8DEF), size: 36)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(s.name).font(.inter(16, 550)).foregroundStyle(Brand.ink)
                                        Text("@\(s.username)").font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                                    }
                                    Spacer()
                                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                        .font(.system(size: 22))
                                        .foregroundStyle(on ? Brand.accent : Brand.inkSoft.opacity(0.5))
                                        .contentTransition(.symbolEffect(.replace))
                                }
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                        if !picked.isEmpty {
                            Button {
                                let names = Array(picked)
                                let guest = asGuest
                                act("add") {
                                    try await Remote.addMembers(current, usernames: names)
                                    // Added as companions by the server; guests get their role straight after.
                                    if guest {
                                        await store.load()
                                        let now = store.trips.first { $0.id == trip.id }?.members ?? []
                                        for m in now where names.contains(m.username) && m.role != "GUEST" {
                                            if let id = m.userId { try await Remote.updateMember(current, userId: id, role: "GUEST") }
                                        }
                                    }
                                    picked = []
                                    query = ""
                                }
                            } label: {
                                HStack {
                                    Spacer()
                                    if busy == "add" { ProgressView().controlSize(.small) }
                                    Text("\(picked.count) toevoegen als \(asGuest ? (picked.count == 1 ? "gast" : "gasten") : (picked.count == 1 ? "reisgenoot" : "reisgenoten"))")
                                        .font(.outfit(16, 650))
                                    Spacer()
                                }
                                .foregroundStyle(.white)
                                .frame(height: 46)
                                .background(Brand.accent, in: .capsule)
                            }
                            .buttonStyle(PressStyle(scale: 0.97))
                            .disabled(busy != nil)
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0))
                            .transition(.opacity.combined(with: .scale(scale: 0.95)))
                        }
                    } header: { Text("Iemand toevoegen") } footer: {
                        Text(asGuest ? "Een gast kijkt mee en kan reageren, maar verandert niets aan de reis." : "Een reisgenoot reist mee: foto's tellen mee en de route kan bijgehouden worden.")
                    }
                    .listRowBackground(Brand.raised)
                }

                Section {
                    if !live {
                        Text("Deellinks maak je bij je eigen reizen, na het inloggen.").foregroundStyle(Brand.inkSoft)
                    } else if let links {
                        if links.isEmpty {
                            Text("Nog geen deellink. Met een link kan iemand de reis bekijken zonder account.").foregroundStyle(Brand.inkSoft)
                        }
                        ForEach(links) { link in linkRow(link) }
                        if canManage {
                            // A new link, with a password if you like.
                            HStack(spacing: 10) {
                                SecureField("wachtwoord (optioneel)", text: $newPassword)
                                    .font(.inter(16))
                                    .textContentType(.newPassword)
                                Button {
                                    let pw = newPassword
                                    act("newlink") { try await Remote.createShareLink(current, password: pw); newPassword = ""; await loadLinks() }
                                } label: {
                                    Label("Deellink", systemImage: "plus").font(.inter(15, 600))
                                }
                                .buttonStyle(.borderedProminent)
                                .buttonBorderShape(.capsule)
                                .disabled(busy != nil)
                            }
                        }
                    } else {
                        CompassSpinner(size: 28).frame(maxWidth: .infinity, minHeight: 44)
                    }
                } header: {
                    Text("Deellinks")
                } footer: {
                    if live && !canManage { Text("Alleen de beheerder van de reis maakt, wijzigt of trekt links in. Kopiëren mag iedereen.") }
                }
                .listRowBackground(Brand.raised)

                // Fotoboek and Samenvatting will live down here later.
                Color.clear.frame(height: 24).listRowBackground(Color.clear)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle("Mensen en delen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) }
            }
            .animation(.calm, value: suggestions.map(\.id))
            .animation(.calm, value: links?.map(\.id))
            .task { await loadLinks() }
            .task(id: query) {
                guard canManage else { return }
                // A short pause while typing, then the server's suggestions, companions first.
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
                if Launch.menuPreview && !live {
                    suggestions = Demo.friends.map { Remote.Friend(id: $0.handle, name: $0.name, username: $0.handle, hasAvatar: false, sharedTrips: $0.shared) }
                    return
                }
                suggestions = (try? await Remote.suggestions(query)) ?? []
            }
            .confirmationDialog("Deze deellink intrekken?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } }), titleVisibility: .visible) {
                Button("Intrekken", role: .destructive) {
                    if let link = revoking { act("revoke\(link.id)") { try await Remote.revokeShareLink(current, link); await loadLinks() } }
                }
            } message: {
                Text("Wie de link heeft, kan de reis daarna niet meer bekijken.")
            }
            .confirmationDialog("\(removing?.name ?? "") van de reis halen?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
                Button("Van de reis halen", role: .destructive) {
                    if let p = removing, let id = p.userId { act("remove\(id)") { try await Remote.removeMember(current, userId: id) } }
                }
            }
        }
        .alert(passwordFor?.hasPassword == true ? "Wachtwoord wijzigen" : "Wachtwoord instellen",
               isPresented: Binding(get: { passwordFor != nil }, set: { if !$0 { passwordFor = nil } })) {
            SecureField("Wachtwoord", text: $passwordText)
            Button("Annuleren", role: .cancel) {}
            Button("Bewaren") {
                if let link = passwordFor, !passwordText.isEmpty {
                    let pw = passwordText
                    act("pw\(link.id)") { try await Remote.setLinkPassword(current, link, pw); await loadLinks() }
                }
            }
        } message: {
            Text("Wie de link opent, vult dit eerst in.")
        }
        .alert("Wachtwoord van de link", isPresented: Binding(get: { revealed != nil }, set: { if !$0 { revealed = nil } })) {
            if let pw = revealed?.password {
                Button("Kopieer") { UIPasteboard.general.string = pw; Haptic.tap() }
            }
            Button("OK", role: .cancel) {}
        } message: {
            if let pw = revealed?.password { Text(pw) }
            else { Text("Dit wachtwoord is van voor de tijd dat wachtwoorden leesbaar bewaard werden. Stel een nieuw in om het te kunnen delen.") }
        }
        .sheet(item: Binding(get: { daysFor.map { PersonDays(person: $0) } }, set: { if $0 == nil { daysFor = nil } })) { item in
            AlongSheet(trip: current, person: item.person) { from, to in
                if let id = item.person.userId { act("days\(id)") { try await Remote.updateMember(current, userId: id, days: (from, to)) } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    /// "4 t/m 7 dec" when someone was along for part of the trip.
    private func along(_ p: Person) -> String? {
        guard p.fromDate != nil || p.toDate != nil, let first = current.start else { return nil }
        let last = Format.calendar.date(byAdding: .day, value: max(0, current.days - 1), to: first) ?? first
        return Format.range(p.fromDate ?? first, p.toDate ?? last, withYear: false)
    }

    private func roleName(_ role: String) -> String {
        switch role {
        case "OWNER": "Eigenaar"
        case "GUEST": "Gast"
        default: "Reisgenoot"
        }
    }

    @ViewBuilder private func memberRow(_ p: Person) -> some View {
        HStack(spacing: 12) {
            Avatar(userId: p.userId, hasAvatar: p.hasAvatar, initial: p.initial, color: p.color, size: 38)
            VStack(alignment: .leading, spacing: 1) {
                Text(p.name.isEmpty ? p.initial : p.name).font(.inter(16, 550)).foregroundStyle(Brand.ink).lineLimit(1)
                let extra = [p.username.isEmpty ? nil : "@\(p.username)", along(p), p.role == "MEMBER" && !p.canTrack ? "tracken uit" : nil].compactMap { $0 }
                if !extra.isEmpty {
                    Text(extra.joined(separator: " · ")).font(.inter(13, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if canManage && p.role != "OWNER", let id = p.userId {
                Menu {
                    Picker("Rol", selection: Binding(get: { p.role }, set: { role in act("role\(id)") { try await Remote.updateMember(current, userId: id, role: role) } })) {
                        Text("Reisgenoot").tag("MEMBER")
                        Text("Gast").tag("GUEST")
                    }
                    if p.role == "MEMBER" {
                        Toggle("Mag tracken", systemImage: "location.north.line", isOn: Binding(get: { p.canTrack }, set: { on in
                            act("track\(id)") { try await Remote.updateMember(current, userId: id, canTrack: on) }
                        }))
                        Button("Dagen mee", systemImage: "calendar") { daysFor = p }
                    }
                    Button("Van de reis halen", systemImage: "person.badge.minus", role: .destructive) { removing = p }
                } label: {
                    HStack(spacing: 4) {
                        if busy == "role\(id)" || busy == "remove\(id)" || busy == "track\(id)" || busy == "days\(id)" { ProgressView().controlSize(.small) }
                        Text(roleName(p.role)).font(.inter(15, 500))
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
                    }
                    .foregroundStyle(Brand.inkSoft)
                }
                .disabled(busy != nil)
            } else {
                Text(roleName(p.role)).font(.inter(15, 500)).foregroundStyle(Brand.inkSoft)
            }
        }
    }

    /// A link as Android shows it: the path after the server as an orange link, a clear
    /// Kopieer button (the full address), and a settings button for its password and revoking.
    @ViewBuilder private func linkRow(_ link: Remote.ShareLink) -> some View {
        let full = link.url
        HStack(spacing: 10) {
            if link.hasPassword {
                Image(systemName: "lock.fill").font(.system(size: 13)).foregroundStyle(Brand.inkSoft).accessibilityLabel("Met wachtwoord")
            }
            // The whole address in the accent with a soft underline, cut at the end; a tap copies it.
            Button { copy(link) } label: {
                Text(full)
                    .font(.inter(15, 550))
                    .foregroundStyle(Brand.accent)
                    .underline(true, color: Brand.accent.opacity(0.35))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Link kopiëren")
            .accessibilityValue(full)
            Button { copy(link) } label: {
                Text(copied == link.id ? "Gekopieerd" : "Kopieer").font(.inter(14, 600)).contentTransition(.opacity)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.capsule)
            if canManage {
                Menu {
                    Button(link.hasPassword ? "Wachtwoord wijzigen" : "Wachtwoord instellen", systemImage: "lock") {
                        passwordFor = link; passwordText = ""
                    }
                    if link.hasPassword {
                        Button("Wachtwoord bekijken", systemImage: "eye") {
                            Task {
                                if let r = try? await Remote.linkPassword(current, link) { revealed = (link, r.password, r.recoverable) }
                                else { error = "Het wachtwoord kon niet worden opgehaald" }
                            }
                        }
                        Button("Wachtwoord weghalen", systemImage: "lock.open") {
                            act("pw\(link.id)") { try await Remote.setLinkPassword(current, link, nil); await loadLinks() }
                        }
                    }
                    Button("Intrekken", systemImage: "trash", role: .destructive) { revoking = link }
                } label: {
                    Image(systemName: "gearshape").font(.system(size: 16, weight: .semibold)).foregroundStyle(Brand.inkSoft).frame(width: 32, height: 32)
                }
                .accessibilityLabel("Instellingen van deze link")
                .disabled(busy != nil)
            }
        }
    }

    private func copy(_ link: Remote.ShareLink) {
        UIPasteboard.general.string = link.url
        Haptic.tap()
        withAnimation(.calm) { copied = link.id }
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            withAnimation(.calm) { if copied == link.id { copied = nil } }
        }
    }

    private func loadLinks() async {
        guard live else { return }
        links = (try? await Remote.shareLinks(current)) ?? []
    }

    /// One change at a time; afterwards the trips are read again so the sheet shows the new state.
    private func act(_ key: String, _ work: @escaping () async throws -> Void) {
        guard busy == nil else { return }
        busy = key
        error = nil
        Task {
            do {
                try await work()
                await store.load()
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Dat lukte niet"
            }
            busy = nil
        }
    }
}

private struct PersonDays: Identifiable {
    let person: Person
    var id: String { person.userId ?? person.name }
}

/// The days someone was along, in the app's range calendar, kept inside the trip.
private struct AlongSheet: View {
    let trip: Trip
    let person: Person
    let onSave: (Date?, Date?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var a: Date?
    @State private var b: Date?

    private var first: Date { trip.start ?? Format.calendar.startOfDay(for: Date()) }
    private var last: Date { Format.calendar.date(byAdding: .day, value: max(0, trip.days - 1), to: first) ?? first }
    private func clamp(_ d: Date?) -> Date? { d.map { min(max($0, first), last) } }

    var body: some View {
        let from = clamp(a) ?? first, to = clamp(b ?? a) ?? last
        NavigationStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Dagen mee").font(.outfit(14, 600)).foregroundStyle(Brand.inkSoft)
                Text(from == first && to == last ? "De hele reis" : Format.range(from, to, withYear: false))
                    .font(.outfit(21, 650)).foregroundStyle(Brand.ink)
                    .contentTransition(.opacity)
                    .animation(.calm, value: [from, to])
                RangeCalendar(start: $a, end: $b).padding(.top, 12)
                Button("Hele reis") { a = first; b = last }.font(.outfit(15, 600)).padding(.top, 4)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .background(Brand.paper)
            .navigationTitle(person.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Klaar") {
                        // The trip's own first or last day is sent as nothing: along from the start, or to the end.
                        onSave(from == first ? nil : from, to == last ? nil : to)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear { a = person.fromDate ?? first; b = person.toDate ?? last }
    }
}
