import SwiftUI

/// How big a trip shows on the homepage, as on the web and Android: a default for all trips (Automatisch: the
/// trips to come and the latest one big, the rest as rows) and per trip a choice from its menu that wins over it.
/// Kept on this phone only.
@Observable
final class CardSizes {
    static let shared = CardSizes()
    static let auto = "auto", large = "large", compact = "compact"

    var standard: String { didSet { UserDefaults.standard.set(standard, forKey: "cardSize") } }
    private(set) var overrides: [String: String] { didSet { save() } }

    private init() {
        standard = UserDefaults.standard.string(forKey: "cardSize") ?? CardSizes.auto
        let data = UserDefaults.standard.data(forKey: "cardSizeOverrides") ?? Data()
        overrides = (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    /// What the trip's own menu has chosen; Auto when nothing.
    func choice(_ id: String) -> String { overrides[id] ?? CardSizes.auto }

    /// nil or Auto follows the default again.
    func set(_ id: String, _ value: String?) {
        if let value, value != CardSizes.auto { overrides[id] = value } else { overrides[id] = nil }
    }

    func clear() { overrides = [:] }

    /// Whether this trip shows big; `autoBig` is what Automatisch means for it.
    func big(_ id: String, autoBig: Bool) -> Bool {
        switch overrides[id] ?? standard {
        case CardSizes.large: true
        case CardSizes.compact: false
        default: autoBig
        }
    }

    private func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(overrides), forKey: "cardSizeOverrides")
    }
}

/// What the ⋯ of a trip can do, as on Android: its size, and for your own trip renaming and deleting it,
/// for someone else's leaving it. The menu is attached to the button it opens from, so it unfolds right there.
struct TripMenu<Label: View>: View {
    let trip: Trip
    var onRename: () -> Void = {}
    var onDelete: () -> Void = {}
    var onLeave: () -> Void = {}
    @ViewBuilder let label: Label
    @Environment(Store.self) private var store
    private let sizes = CardSizes.shared

    private var mine: Bool {
        guard trip.remoteId != nil else { return false }
        return (trip.ownerId ?? "").isEmpty || trip.ownerId == store.me?.id
    }

    var body: some View {
        Menu {
            Picker(selection: Binding(get: { sizes.choice(trip.id) }, set: { value in
                Haptic.select()
                // After the menu has folded away, so the card turns into a row (or back) in plain sight.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) {
                    withAnimation(.smooth(duration: 0.45)) { sizes.set(trip.id, value) }
                }
            })) {
                Text("Auto").tag(CardSizes.auto)
                Text("Groot").tag(CardSizes.large)
                Text("Klein").tag(CardSizes.compact)
            } label: {
                // No title: the three choices speak for themselves, in full contrast.
                EmptyView()
            }
            .pickerStyle(.palette)
            .accessibilityLabel("Grootte")
            if trip.remoteId != nil {
                Section {
                    if mine {
                        Button("Hernoemen", systemImage: "pencil", action: onRename)
                        Button("Verwijderen", systemImage: "trash", role: .destructive, action: onDelete)
                    } else {
                        Button("Reis verlaten", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive, action: onLeave)
                    }
                }
            }
        } label: {
            label
        }
        .accessibilityLabel("Meer voor \(trip.title)")
    }
}

/// A new name for a trip: the field already filled in, Opslaan once it is different.
struct RenameTripSheet: View {
    let trip: Trip
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    init(trip: Trip) {
        self.trip = trip
        _title = State(initialValue: trip.title)
    }

    private var trimmed: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSave: Bool { !busy && !trimmed.isEmpty && trimmed != trip.title }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                TextField("Naam van de reis", text: $title)
                    .font(.inter(17, 500))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(save)
                    .padding(.horizontal, 16)
                    .frame(height: 54)
                    .background(Brand.raised, in: .rect(cornerRadius: 18))
                    .onChange(of: title) { _, t in if t.count > 120 { title = String(t.prefix(120)) } }
                if let error {
                    Text(error).font(.inter(14, 500)).foregroundStyle(.red).padding(.leading, 4)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(Brand.paper)
            .navigationTitle("Hernoemen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() }.tint(.primary) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm, action: save).disabled(!canSave)
                }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.height(200)])
    }

    private func save() {
        guard canSave else { return }
        busy = true
        Task {
            do {
                try await Remote.renameTrip(trip, trimmed)
                Haptic.tap()
                await store.load()
                dismiss()
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Hernoemen lukte niet"
            }
            busy = false
        }
    }
}

/// Deleting a trip, as on the web: its name typed out first, because it cannot be undone.
struct DeleteTripSheet: View {
    let trip: Trip
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var matches: Bool { typed.trimmingCharacters(in: .whitespacesAndNewlines) == trip.title.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                Text("\u{201C}\(trip.title)\u{201D} wordt definitief verwijderd, samen met de route, de notities en de foto-koppelingen. Dit kan niet ongedaan gemaakt worden.")
                    .font(.inter(15, 450))
                    .foregroundStyle(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Typ de naam van de reis om te bevestigen.")
                    .font(.inter(14, 600))
                    .foregroundStyle(Brand.inkSoft)
                    .padding(.top, 16)
                    .padding(.bottom, 8)
                TextField(trip.title, text: $typed)
                    .font(.inter(17, 500))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .padding(.horizontal, 16)
                    .frame(height: 54)
                    .background(Brand.raised, in: .rect(cornerRadius: 18))
                if let error {
                    Text(error).font(.inter(14, 500)).foregroundStyle(.red).padding(.top, 8).padding(.leading, 4)
                }
                Button(role: .destructive, action: delete) {
                    ZStack {
                        Text("Reis verwijderen").opacity(busy ? 0 : 1)
                        ProgressView().controlSize(.small).tint(.white).opacity(busy ? 1 : 0)
                    }
                    .font(.outfit(17, 600))
                    .frame(maxWidth: .infinity)
                    .frame(height: 30)
                }
                .buttonStyle(.glassProminent)
                .tint(.red)
                .controlSize(.large)
                .disabled(!matches || busy)
                .animation(.calm, value: matches)
                .padding(.top, 18)
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(Brand.paper)
            .navigationTitle("Reis verwijderen?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() }.tint(.primary) }
            }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium])
    }

    private func delete() {
        guard matches, !busy else { return }
        busy = true
        Task {
            do {
                try await Remote.deleteTrip(trip)
                Haptic.tap()
                CardSizes.shared.set(trip.id, nil)
                await store.load()
                dismiss()
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Verwijderen lukte niet"
            }
            busy = false
        }
    }
}
