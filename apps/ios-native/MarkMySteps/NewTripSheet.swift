import SwiftUI

/// A new trip: a name and the dates, then it opens straight away.
struct NewTripSheet: View {
    let onCreated: (String) -> Void
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var start = Format.calendar.startOfDay(for: Date())
    @State private var end = Format.calendar.date(byAdding: .day, value: 7, to: Format.calendar.startOfDay(for: Date())) ?? Date()
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var canCreate: Bool { store.live && !title.trimmingCharacters(in: .whitespaces).isEmpty && end >= start && !busy }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Bijv. Zomer in Zweden", text: $title)
                        .font(.inter(17))
                        .focused($focused)
                        .submitLabel(.done)
                } header: { Text("Naam") }
                .listRowBackground(Brand.raised)
                Section {
                    DatePicker("Van", selection: $start, displayedComponents: .date)
                    DatePicker("Tot en met", selection: $end, in: start..., displayedComponents: .date)
                } header: { Text("Wanneer") } footer: {
                    if !store.live { Text("In de voorbeelden maak je geen reis; log in op je server.") }
                    else if let error { Text(error).foregroundStyle(.red) }
                }
                .listRowBackground(Brand.raised)
            }
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .environment(\.locale, Format.dutch)
            .navigationTitle("Nieuwe reis")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuleren") { dismiss() }.tint(.primary) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: create) {
                        ZStack {
                            Text("Maken").opacity(busy ? 0 : 1)
                            ProgressView().controlSize(.small).opacity(busy ? 1 : 0)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!canCreate)
                }
            }
            .onChange(of: start) { _, s in if end < s { end = s } }
            .onAppear { focused = true }
        }
        .presentationDetents([.medium, .large])
    }

    private func create() {
        guard canCreate else { return }
        busy = true
        error = nil
        Task {
            do {
                let id = try await Remote.createTrip(title: title.trimmingCharacters(in: .whitespaces), start: start, end: end)
                await store.load()
                dismiss()
                if let id { onCreated(id) }
            } catch {
                self.error = (error as? Api.Failure)?.message ?? "Maken lukte niet"
            }
            busy = false
        }
    }
}
