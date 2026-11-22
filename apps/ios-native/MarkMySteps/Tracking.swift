import SwiftUI

/// Route tracking, phone notifications and your own position, in Voorkeuren. Not built for iPhone yet: each row is
/// greyed and says why when tapped, never a switch that does nothing.
struct TrackingSettings: View {
    var body: some View {
        Section {
            UnavailableRow(title: "Route-tracking", symbol: "location.north.line",
                           reason: "Je route bijhouden op de achtergrond kan nog niet in de iPhone-app. Tot die er is, houd je je route bij met de Android-app of de web-app.")
            UnavailableRow(title: "Eigen locatie op de homepage", symbol: "mappin.and.ellipse",
                           reason: "Je positie als stip op de globe komt samen met route-tracking op de iPhone.")
            UnavailableRow(title: "Meldingen op je telefoon", symbol: "bell",
                           reason: "Meldingen terwijl de app dicht is kunnen nog niet op de iPhone. Nieuwe meldingen zie je bij Reizigers onder de bel.")
        } header: { Text("Onderweg") }
    }
}
