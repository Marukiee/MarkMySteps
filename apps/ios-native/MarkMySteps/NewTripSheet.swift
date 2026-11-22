import SwiftUI

/// A new trip: a name and the dates, then it opens straight away.
struct NewTripSheet: View {
    let onCreated: (String) -> Void
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var start: Date? = nil
    @State private var end: Date? = nil
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private var canCreate: Bool { store.live && !title.trimmingCharacters(in: .whitespaces).isEmpty && start != nil && !busy }

    /// "7 t/m 14 dec · 8 dagen", or what to do next.
    private var summary: String {
        guard let start else { return "Druk op de eerste dag en sleep naar de laatste" }
        guard let last = end, last != start else { return "\(Format.shortDay(start)) · 1 dag" }
        let days = (Format.calendar.dateComponents([.day], from: start, to: last).day ?? 0) + 1
        return "\(Format.range(start, last, withYear: false)) · \(days) dagen"
    }

    var body: some View {
        NavigationStack {
            // No Form or scroll view around the calendar: a drag over the days picks them, it never scrolls.
            VStack(alignment: .leading, spacing: 0) {
                Text("Naam").font(.inter(13, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 4).padding(.bottom, 6)
                TextField("Bijv. Zomer in Zweden", text: $title)
                    .font(.inter(17, 500))
                    .focused($focused)
                    .submitLabel(.done)
                    .padding(.horizontal, 16)
                    .frame(height: 52)
                    .background(Brand.raised, in: .rect(cornerRadius: 18))
                Text("Wanneer").font(.inter(13, 600)).foregroundStyle(Brand.inkSoft).padding(.leading, 4).padding(.top, 18).padding(.bottom, 6)
                VStack(spacing: 8) {
                    RangeCalendar(start: $start, end: $end)
                    Text(summary)
                        .font(.inter(14, 550))
                        .foregroundStyle(start == nil ? Brand.inkSoft : Brand.ink)
                        .contentTransition(.numericText())
                        .animation(.calm, value: summary)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 4)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 10)
                .background(Brand.raised, in: .rect(cornerRadius: 24))
                if !store.live {
                    Text("In de voorbeelden maak je geen reis; log in op je server.")
                        .font(.inter(13, 500)).foregroundStyle(Brand.inkSoft).padding(.top, 10).padding(.leading, 4)
                } else if let error {
                    Text(error).font(.inter(13, 500)).foregroundStyle(.red).padding(.top, 10).padding(.leading, 4)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .background(Brand.paper)
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
        }
        .presentationDetents([.height(700), .large])
    }

    private func create() {
        guard canCreate, let start else { return }
        let end = self.end ?? start
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
