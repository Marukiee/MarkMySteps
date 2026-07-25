/**
 * Curated major-airport list (IATA), bundled — no key, works offline.
 * Not exhaustive; the flight editor always allows a manual flight number
 * and free airport code, so any airport still works.
 */

export interface Airport {
  iata: string;
  name: string;
  city: string;
  country: string;
  lat: number;
  lon: number;
}

// [iata, name, city, country, lat, lon]
const RAW: [string, string, string, string, number, number][] = [
  ['AMS', 'Schiphol', 'Amsterdam', 'NL', 52.3105, 4.7683],
  ['EIN', 'Eindhoven', 'Eindhoven', 'NL', 51.4501, 5.3745],
  ['RTM', 'Rotterdam The Hague', 'Rotterdam', 'NL', 51.9569, 4.4372],
  ['BRU', 'Brussels', 'Brussels', 'BE', 50.9014, 4.4844],
  ['CRL', 'Charleroi', 'Charleroi', 'BE', 50.4592, 4.4538],
  ['LHR', 'Heathrow', 'London', 'GB', 51.47, -0.4543],
  ['LGW', 'Gatwick', 'London', 'GB', 51.1537, -0.1821],
  ['STN', 'Stansted', 'London', 'GB', 51.885, 0.235],
  ['MAN', 'Manchester', 'Manchester', 'GB', 53.3537, -2.275],
  ['DUB', 'Dublin', 'Dublin', 'IE', 53.4213, -6.2701],
  ['CDG', 'Charles de Gaulle', 'Paris', 'FR', 49.0097, 2.5479],
  ['ORY', 'Orly', 'Paris', 'FR', 48.7233, 2.3794],
  ['NCE', 'Nice Côte d’Azur', 'Nice', 'FR', 43.6584, 7.2159],
  ['FRA', 'Frankfurt', 'Frankfurt', 'DE', 50.0379, 8.5622],
  ['MUC', 'Munich', 'Munich', 'DE', 48.3538, 11.7861],
  ['BER', 'Brandenburg', 'Berlin', 'DE', 52.3667, 13.5033],
  ['DUS', 'Düsseldorf', 'Düsseldorf', 'DE', 51.2895, 6.7668],
  ['HAM', 'Hamburg', 'Hamburg', 'DE', 53.6304, 9.9882],
  ['ZRH', 'Zürich', 'Zürich', 'CH', 47.4647, 8.5492],
  ['GVA', 'Geneva', 'Geneva', 'CH', 46.2381, 6.1089],
  ['VIE', 'Vienna', 'Vienna', 'AT', 48.1103, 16.5697],
  ['CPH', 'Copenhagen', 'Copenhagen', 'DK', 55.618, 12.6508],
  ['OSL', 'Oslo Gardermoen', 'Oslo', 'NO', 60.1939, 11.1004],
  ['BGO', 'Bergen', 'Bergen', 'NO', 60.2934, 5.2181],
  ['TOS', 'Tromsø', 'Tromsø', 'NO', 69.6833, 18.9189],
  ['ARN', 'Stockholm Arlanda', 'Stockholm', 'SE', 59.6519, 17.9186],
  ['GOT', 'Göteborg Landvetter', 'Gothenburg', 'SE', 57.6685, 12.2954],
  ['HEL', 'Helsinki', 'Helsinki', 'FI', 60.3172, 24.9633],
  ['KEF', 'Keflavík', 'Reykjavík', 'IS', 63.985, -22.6056],
  ['MAD', 'Barajas', 'Madrid', 'ES', 40.4936, -3.5668],
  ['BCN', 'El Prat', 'Barcelona', 'ES', 41.2971, 2.0785],
  ['AGP', 'Málaga', 'Málaga', 'ES', 36.6749, -4.4991],
  ['PMI', 'Palma de Mallorca', 'Palma', 'ES', 39.5517, 2.7388],
  ['LIS', 'Lisbon', 'Lisbon', 'PT', 38.7742, -9.1342],
  ['OPO', 'Porto', 'Porto', 'PT', 41.2481, -8.6814],
  ['FCO', 'Fiumicino', 'Rome', 'IT', 41.8003, 12.2389],
  ['MXP', 'Malpensa', 'Milan', 'IT', 45.6306, 8.7281],
  ['VCE', 'Venice Marco Polo', 'Venice', 'IT', 45.5053, 12.3519],
  ['NAP', 'Naples', 'Naples', 'IT', 40.886, 14.2908],
  ['ATH', 'Athens', 'Athens', 'GR', 37.9364, 23.9445],
  ['IST', 'Istanbul', 'Istanbul', 'TR', 41.2753, 28.7519],
  ['PRG', 'Václav Havel', 'Prague', 'CZ', 50.1008, 14.26],
  ['WAW', 'Chopin', 'Warsaw', 'PL', 52.1657, 20.9671],
  ['KRK', 'Kraków', 'Kraków', 'PL', 50.0777, 19.7848],
  ['BUD', 'Budapest', 'Budapest', 'HU', 47.4369, 19.2556],
  ['OTP', 'Otopeni', 'Bucharest', 'RO', 44.5711, 26.085],
  ['JFK', 'John F. Kennedy', 'New York', 'US', 40.6413, -73.7781],
  ['EWR', 'Newark', 'New York', 'US', 40.6895, -74.1745],
  ['LAX', 'Los Angeles', 'Los Angeles', 'US', 33.9416, -118.4085],
  ['SFO', 'San Francisco', 'San Francisco', 'US', 37.6213, -122.379],
  ['ORD', "O'Hare", 'Chicago', 'US', 41.9742, -87.9073],
  ['MIA', 'Miami', 'Miami', 'US', 25.7959, -80.287],
  ['YYZ', 'Pearson', 'Toronto', 'CA', 43.6777, -79.6248],
  ['YVR', 'Vancouver', 'Vancouver', 'CA', 49.1967, -123.1815],
  ['GRU', 'Guarulhos', 'São Paulo', 'BR', -23.4356, -46.4731],
  ['MEX', 'Benito Juárez', 'Mexico City', 'MX', 19.4361, -99.0719],
  ['DXB', 'Dubai', 'Dubai', 'AE', 25.2532, 55.3657],
  ['DOH', 'Hamad', 'Doha', 'QA', 25.2731, 51.6081],
  ['CAI', 'Cairo', 'Cairo', 'EG', 30.1219, 31.4056],
  ['CMN', 'Mohammed V', 'Casablanca', 'MA', 33.3675, -7.5899],
  ['RAK', 'Menara', 'Marrakesh', 'MA', 31.6069, -8.0363],
  ['JNB', 'O. R. Tambo', 'Johannesburg', 'ZA', -26.1392, 28.246],
  ['CPT', 'Cape Town', 'Cape Town', 'ZA', -33.9715, 18.6021],
  ['NBO', 'Jomo Kenyatta', 'Nairobi', 'KE', -1.3192, 36.9278],
  ['BKK', 'Suvarnabhumi', 'Bangkok', 'TH', 13.69, 100.7501],
  ['HKT', 'Phuket', 'Phuket', 'TH', 8.1132, 98.3169],
  ['SIN', 'Changi', 'Singapore', 'SG', 1.3644, 103.9915],
  ['KUL', 'Kuala Lumpur', 'Kuala Lumpur', 'MY', 2.7456, 101.7099],
  ['DPS', 'Ngurah Rai', 'Bali', 'ID', -8.7482, 115.1672],
  ['HAN', 'Noi Bai', 'Hanoi', 'VN', 21.2212, 105.8072],
  ['SGN', 'Tan Son Nhat', 'Ho Chi Minh City', 'VN', 10.8188, 106.6519],
  ['HKG', 'Hong Kong', 'Hong Kong', 'HK', 22.308, 113.9185],
  ['NRT', 'Narita', 'Tokyo', 'JP', 35.772, 140.3929],
  ['HND', 'Haneda', 'Tokyo', 'JP', 35.5494, 139.7798],
  ['ICN', 'Incheon', 'Seoul', 'KR', 37.4602, 126.4407],
  ['PEK', 'Capital', 'Beijing', 'CN', 40.0801, 116.5846],
  ['PVG', 'Pudong', 'Shanghai', 'CN', 31.1443, 121.8083],
  ['DEL', 'Indira Gandhi', 'Delhi', 'IN', 28.5562, 77.1],
  ['BOM', 'Chhatrapati Shivaji', 'Mumbai', 'IN', 19.0896, 72.8656],
  ['SYD', 'Kingsford Smith', 'Sydney', 'AU', -33.9399, 151.1753],
  ['MEL', 'Tullamarine', 'Melbourne', 'AU', -37.669, 144.841],
  ['AKL', 'Auckland', 'Auckland', 'NZ', -37.0082, 174.785],
];

export const AIRPORTS: Airport[] = RAW.map(([iata, name, city, country, lat, lon]) => ({
  iata,
  name,
  city,
  country,
  lat,
  lon,
}));

const BY_IATA = new Map(AIRPORTS.map((a) => [a.iata, a]));

export function airportByCode(code?: string | null): Airport | undefined {
  return code ? BY_IATA.get(code.toUpperCase()) : undefined;
}

/** Closest bundled airport to a coordinate, within ~250 km — used to auto-fill
 *  a flight leg's airport from a known city. Returns null if nothing is close. */
export function nearestAirport(lng: number, lat: number): Airport | undefined {
  let best: Airport | undefined;
  let bestKm = Infinity;
  for (const a of AIRPORTS) {
    // Rough equirectangular distance in km (fine at this scale).
    const x = (a.lon - lng) * Math.cos((lat * Math.PI) / 180);
    const km = Math.hypot(x, a.lat - lat) * 111;
    if (km < bestKm) {
      bestKm = km;
      best = a;
    }
  }
  return bestKm <= 250 ? best : undefined;
}

export function searchAirports(query: string, limit = 6): Airport[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return AIRPORTS.filter(
    (a) =>
      a.iata.toLowerCase().includes(q) ||
      a.city.toLowerCase().includes(q) ||
      a.name.toLowerCase().includes(q),
  ).slice(0, limit);
}
