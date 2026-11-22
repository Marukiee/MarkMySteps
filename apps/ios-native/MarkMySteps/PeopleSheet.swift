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

    private var live: Bool { trip.remoteId != nil }
    private var canManage: Bool { live && trip.ownerId != nil && trip.ownerId == store.me?.id }
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
                    Section("Iemand toevoegen") {
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass").foregroundStyle(Brand.inkSoft)
                            TextField("Naam of gebruikersnaam", text: $query)
                                .font(.inter(17))
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .submitLabel(.search)
                        }
                        ForEach(suggestions.filter { s in !current.members.contains { $0.userId == s.id } }) { s in
                            HStack(spacing: 12) {
                                Avatar(userId: s.id, hasAvatar: s.hasAvatar, initial: String(s.name.prefix(1)).uppercased(), color: Color(hex: 0x5B8DEF), size: 36)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(s.name).font(.inter(16, 550))
                                    Text("@\(s.username)").font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                                }
                                Spacer()
                                Button {
                                    act("add\(s.id)") { try await Remote.addMember(current, username: s.username) }
                                } label: {
                                    if busy == "add\(s.id)" { ProgressView().controlSize(.small) } else { Text("Toevoegen").font(.inter(15, 600)) }
                                }
                                .buttonStyle(.bordered)
                                .buttonBorderShape(.capsule)
                                .disabled(busy != nil)
                            }
                        }
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
                            Button {
                                act("newlink") { try await Remote.createShareLink(current); await loadLinks() }
                            } label: {
                                Label("Nieuwe deellink", systemImage: "link.badge.plus")
                            }
                            .disabled(busy != nil)
                        }
                    } else {
                        CompassSpinner(size: 28).frame(maxWidth: .infinity, minHeight: 44)
                    }
                } header: {
                    Text("Deellinks")
                }
                .listRowBackground(Brand.raised)
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle("Mensen en delen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) }
            }
            .animation(.snappy, value: suggestions.map(\.id))
            .animation(.snappy, value: links?.map(\.id))
            .task { await loadLinks() }
            .task(id: query) {
                guard canManage else { return }
                // A short pause while typing, then the server's suggestions, companions first.
                try? await Task.sleep(for: .milliseconds(250))
                guard !Task.isCancelled else { return }
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
        .presentationDetents([.medium, .large])
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
                if !p.username.isEmpty {
                    Text("@\(p.username)").font(.inter(13, 450)).foregroundStyle(Brand.inkSoft).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if canManage && p.role != "OWNER", let id = p.userId {
                Menu {
                    Picker("Rol", selection: Binding(get: { p.role }, set: { role in act("role\(id)") { try await Remote.setRole(current, userId: id, role: role) } })) {
                        Text("Reisgenoot").tag("MEMBER")
                        Text("Gast").tag("GUEST")
                    }
                    Button("Van de reis halen", systemImage: "person.badge.minus", role: .destructive) { removing = p }
                } label: {
                    HStack(spacing: 4) {
                        if busy == "role\(id)" || busy == "remove\(id)" { ProgressView().controlSize(.small) }
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

    @ViewBuilder private func linkRow(_ link: Remote.ShareLink) -> some View {
        HStack(spacing: 10) {
            Image(systemName: link.hasPassword ? "lock" : "link").foregroundStyle(Brand.inkSoft).frame(width: 22)
            Text(link.url.replacingOccurrences(of: "https://", with: ""))
                .font(.inter(14, 500))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 6)
            Button {
                UIPasteboard.general.string = link.url
                withAnimation(.snappy) { copied = link.id }
                Task {
                    try? await Task.sleep(for: .seconds(1.6))
                    withAnimation(.snappy) { if copied == link.id { copied = nil } }
                }
            } label: {
                Image(systemName: copied == link.id ? "checkmark" : "doc.on.doc")
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(copied == link.id ? "Gekopieerd" : "Link kopiëren")
            if canManage {
                Button(role: .destructive) { revoking = link } label: {
                    Image(systemName: "trash").frame(width: 30, height: 30)
                }
                .buttonStyle(.borderless)
                .disabled(busy != nil)
                .accessibilityLabel("Link intrekken")
            }
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
