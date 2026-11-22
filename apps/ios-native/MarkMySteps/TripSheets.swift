import MapKit
import SwiftUI

/*
 * The trip page's two small sheets, behind round glass buttons as on the web:
 * Kaart (the map's style, four previews two by two) and Reisinstellingen
 * (the trip's colour and fetching its photos from Immich again).
 */

/// The web's four map styles, drawn by MapKit; in dark mode the light ones turn dark by themselves.
enum MapLook: String, CaseIterable, Identifiable {
    case positron, bright, liberty, satellite
    var id: String { rawValue }

    var label: String {
        switch self {
        case .positron: "Licht & minimaal"
        case .bright: "Helder & kleurrijk"
        case .liberty: "Klassiek"
        case .satellite: "Satelliet"
        }
    }

    var style: MapStyle {
        switch self {
        case .positron: .standard(elevation: .flat, emphasis: .muted, pointsOfInterest: .excludingAll)
        case .bright: .standard(elevation: .flat, emphasis: .automatic, pointsOfInterest: .excludingAll)
        case .liberty: .standard(elevation: .realistic, emphasis: .automatic, pointsOfInterest: .including([.airport, .park, .nationalPark, .beach]))
        case .satellite: .hybrid(elevation: .realistic, pointsOfInterest: .excludingAll)
        }
    }
}

/// A small drawn preview of a map style, after the web's mapstyle.css swatches.
struct MapLookPreview: View {
    let look: MapLook
    let dark: Bool

    var body: some View {
        Canvas { ctx, size in
            let w = size.width, h = size.height
            func band(_ color: Color, _ angle: Double, _ at: CGFloat, _ thick: CGFloat) {
                var c = ctx
                c.translateBy(x: w / 2, y: h * at)
                c.rotate(by: .degrees(angle))
                c.fill(Path(CGRect(x: -w, y: -h * thick * 0.08, width: w * 2, height: h * thick * 0.16)), with: .color(color))
            }
            switch look {
            case .positron:
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(dark ? Color(hex: 0x212933) : Color(hex: 0xF3F1EC)))
                band(dark ? Color(hex: 0x2B3A2E) : Color(hex: 0xD7DDB9), 20, 0.6, 1.2)
                band(dark ? Color(hex: 0x3B4652) : Color(hex: 0xCFD6DD), -65, 0.44, 0.47)
            case .bright:
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(dark ? Color(hex: 0x2A3A2C) : Color(hex: 0xD9EFC7)))
                band(dark ? Color(hex: 0x6A5C37) : Color(hex: 0xE9D79A), -60, 0.4, 1.2)
                let r = h * 0.32
                ctx.fill(Path(ellipseIn: CGRect(x: w * 0.7 - r, y: h * 0.3 - r, width: r * 2, height: r * 2)), with: .color(dark ? Color(hex: 0x2F6F9E) : Color(hex: 0x7FC8F0)))
            case .liberty:
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(
                    Gradient(colors: dark ? [Color(hex: 0x2C2822), Color(hex: 0x211E19)] : [Color(hex: 0xEFE7D6), Color(hex: 0xE2D7BF)]),
                    startPoint: .zero, endPoint: CGPoint(x: 0, y: h)))
                band(dark ? Color(hex: 0x7A6C52) : Color(hex: 0xB9A98A), -45, 0.46, 0.49)
            case .satellite:
                ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .linearGradient(
                    Gradient(colors: [Color(hex: 0x2F4A63), Color(hex: 0x47624A), Color(hex: 0x6B6A45)]), startPoint: .zero, endPoint: CGPoint(x: w, y: h)))
                let r = h * 0.42
                ctx.fill(Path(ellipseIn: CGRect(x: w * 0.4 - r, y: h * 0.6 - r, width: r * 2, height: r * 2)), with: .color(Color(hex: 0x3F5D3A)))
            }
        }
    }
}

struct MapStyleSheet: View {
    @AppStorage("mapStyle") private var chosen = MapLook.positron.rawValue
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Stijl van de kaart").font(.inter(14, 500)).foregroundStyle(Brand.inkSoft)
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                        ForEach(MapLook.allCases) { look in
                            let on = chosen == look.rawValue
                            Button {
                                withAnimation(.snappy) { chosen = look.rawValue }
                            } label: {
                                VStack(alignment: .leading, spacing: 8) {
                                    MapLookPreview(look: look, dark: scheme == .dark)
                                        .frame(height: 84)
                                        .clipShape(.rect(cornerRadius: 14))
                                    HStack {
                                        Text(look.label).font(.outfit(14.5, 600)).foregroundStyle(Brand.ink).lineLimit(1).minimumScaleFactor(0.85)
                                        Spacer(minLength: 2)
                                        if on { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Brand.accent) }
                                    }
                                }
                                .padding(8)
                                .background(on ? Brand.accent.opacity(0.12) : Brand.raised, in: .rect(cornerRadius: 20))
                                // The chosen one outlined, as on the web.
                                .overlay { RoundedRectangle(cornerRadius: 20).strokeBorder(on ? Brand.accent : .clear, lineWidth: 2) }
                            }
                            .buttonStyle(PressStyle())
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    Text("In de donkere stand worden de lichte stijlen vanzelf de donkere kaart.")
                        .font(.inter(13, 450)).foregroundStyle(Brand.inkSoft)
                }
                .padding(16)
            }
            .background(Brand.paper)
            .navigationTitle("Kaart")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) } }
        }
        .presentationDetents([.medium])
    }
}

/// The trip's own settings: its colour, and fetching its photos from Immich again.
struct TripSettingsSheet: View {
    let trip: Trip
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var note: String?

    static let colours = ["#E8613C", "#E34B8A", "#7A5BD6", "#5B8DEF", "#2BB6A8", "#4CAF50", "#D9A441", "#C9772E", "#8D6E63", "#607D8B"]

    private var live: Bool { trip.remoteId != nil }
    private var current: Trip { store.trips.first { $0.id == trip.id } ?? trip }
    private var canEdit: Bool { live && current.ownerId == store.me?.id }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 12) {
                        ForEach(Self.colours, id: \.self) { hex in
                            let colour = Color(hex: UInt32(hex.dropFirst(), radix: 16) ?? 0)
                            let on = current.colorHex?.uppercased() == hex
                            Button { setColour(hex) } label: {
                                Circle().fill(colour)
                                    .frame(width: 44, height: 44)
                                    .overlay { if on { Image(systemName: "checkmark").font(.system(size: 17, weight: .bold)).foregroundStyle(.white) } }
                                    .overlay { Circle().strokeBorder(on ? Brand.ink.opacity(0.35) : .clear, lineWidth: 2).padding(-4) }
                            }
                            .buttonStyle(PressStyle(scale: 0.9))
                            .disabled(!canEdit || busy)
                            .accessibilityLabel("Kleur \(hex)")
                        }
                    }
                    .padding(.vertical, 6)
                } header: {
                    Text("Kleur van de reis")
                } footer: {
                    if !live { Text("In de voorbeelden verander je niets.") }
                    else if !canEdit { Text("Alleen de eigenaar kiest de kleur.") }
                }
                .listRowBackground(Brand.raised)

                Section {
                    Button {
                        guard live else { return }
                        busy = true
                        Task {
                            do { try await Remote.syncPhotos(current); note = "Foto's worden opgehaald" } catch { note = "Ophalen mislukt" }
                            busy = false
                        }
                    } label: {
                        HStack {
                            Label("Foto's opnieuw ophalen uit Immich", systemImage: "arrow.triangle.2.circlepath")
                            Spacer()
                            if busy { CompassSpinner(size: 22) }
                        }
                    }
                    .disabled(!live || busy)
                } footer: {
                    Text(note ?? "Nieuwe foto's komen ook vanzelf binnen; dit haalt ze nu meteen op.")
                }
                .listRowBackground(Brand.raised)
            }
            .scrollContentBackground(.hidden)
            .background(Brand.paper)
            .navigationTitle("Reisinstellingen")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) } }
            .animation(.snappy, value: note)
        }
        .presentationDetents([.medium])
    }

    private func setColour(_ hex: String) {
        guard canEdit else { return }
        busy = true
        Task {
            do { try await Remote.setTripColor(current, hex); await store.load() } catch { note = "Kleur opslaan mislukt" }
            busy = false
        }
    }
}
