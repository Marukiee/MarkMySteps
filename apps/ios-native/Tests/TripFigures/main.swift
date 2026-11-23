import Foundation

// Checks the pure counting rules of MarkMySteps/TripFigures.swift without the app or a simulator.
// Run: Tests/run-trip-figures.sh

var failures = 0
var passed = 0
func check(_ name: String, _ got: some Equatable, _ want: some Equatable) {
    if "\(got)" == "\(want)" { passed += 1 } else { failures += 1; print("FAIL \(name): got \(got), want \(want)") }
}

let granada = (lat: 37.18, lon: -3.6)
let sevilla = (lat: 37.39, lon: -5.98)
let monachil = (lat: 37.133, lon: -3.537)
let stockholm = (lat: 59.329, lon: 18.068)
let saltsjobaden = (lat: 59.28, lon: 18.31)

check("flag to code", TripFigures.code(ofFlag: "🇲🇦"), Optional("ma"))
check("code stays", TripFigures.code(ofFlag: "ES"), Optional("es"))
check("pin is no country", TripFigures.code(ofFlag: "📍"), String?.none)
check("nil is no country", TripFigures.code(ofFlag: nil), String?.none)

check("unknown is not a second country", TripFigures.countryCount(codes: ["es", nil]), 1)
check("home does not count", TripFigures.countryCount(codes: ["nl", "es"]), 1)
check("only home is none", TripFigures.countryCount(codes: ["NL"]), 0)
check("once per code", TripFigures.countryCount(codes: ["ES", "es", "MA", "", nil]), 2)

check("every route stop counts", TripFigures.stopPlaceCount(route: [granada, sevilla, granada], dayTrips: []), 3)
check("day trip once per place", TripFigures.stopPlaceCount(route: [saltsjobaden], dayTrips: [stockholm, stockholm, stockholm]), 2)
check("nearby places stay two", TripFigures.stopPlaceCount(route: [granada], dayTrips: [monachil]), 2)
check("day trip to a route stop", TripFigures.stopPlaceCount(route: [granada, sevilla], dayTrips: [sevilla]), 2)

print("\(passed) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
