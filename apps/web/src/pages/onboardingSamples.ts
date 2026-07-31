import type { Trip } from '../api/types';

// Example European trips for the globe demo, shared by both onboarding tours.
// A few realistic multi-city routes plus a city trip and one flight, so the
// globe shows exactly what a filled-in account looks like (dots at the real
// start/end, a flight bow).
// Home airport used for the demo outbound/return flight bows.
const AMS: [number, number] = [4.9, 52.37];

/**
 * The route the "Plan je route" slide builds up: one trip, so the globe's tour
 * frames it straight away and walks its light from stop to stop. Real cities in
 * travel order — the slide is meant to be the app, not a diagram of it.
 */
export const PLAN_TRIP = [
  {
    id: 'p-route',
    title: 'Zuid-Europa',
    anchor: [-4.42, 36.72],
    routePath: [
      [
        [-4.42, 36.72], // Málaga
        [-3.7, 40.42], // Madrid
        [2.17, 41.39], // Barcelona
        [7.69, 45.07], // Turijn
        [2.35, 48.86], // Parijs
      ],
    ],
    flightPath: null,
    distanceKm: 2200,
    startDate: '2025-05-02',
    endDate: '2025-05-20',
    color: '#e8613c',
  },
] as unknown as Trip[];

export const SAMPLE_TRIPS = [
  {
    id: 's-scan',
    title: 'Scandinavië',
    anchor: [11.97, 57.71],
    routePath: [
      [
        [11.97, 57.71], // Gothenburg
        [10.75, 59.91], // Oslo
        [10.4, 63.43], // Trondheim
        [14.4, 67.28], // Bodø (keeps each hop short so no leg reads as a flight)
        [18.96, 69.65], // Tromsø
      ],
    ],
    // Fly out to the start, fly home from the end — no flight mid-route.
    flightPath: [
      [AMS, [11.97, 57.71]],
      [[18.96, 69.65], AMS],
    ],
    distanceKm: 1900,
    startDate: '2025-06-04',
    endDate: '2025-06-18',
    color: '#5a6ee1',
  },
  {
    id: 's-es',
    title: 'Spanje',
    anchor: [2.17, 41.4],
    routePath: [
      [
        [2.17, 41.4], // Barcelona
        [-3.7, 40.4], // Madrid
        [-4.42, 36.72], // Málaga
      ],
    ],
    flightPath: [
      [AMS, [2.17, 41.4]],
      [[-4.42, 36.72], AMS],
    ],
    distanceKm: 1000,
    startDate: '2024-09-01',
    endDate: '2024-09-12',
    color: '#e0993a',
  },
  {
    id: 's-balkan',
    title: 'Balkan',
    anchor: [23.73, 37.98],
    routePath: [
      [
        [23.73, 37.98], // Athens
        [22.94, 40.64], // Thessaloniki
        [23.32, 42.7], // Sofia
      ],
    ],
    flightPath: [
      [AMS, [23.73, 37.98]],
      [[23.32, 42.7], AMS],
    ],
    distanceKm: 750,
    startDate: '2025-04-10',
    endDate: '2025-04-20',
    color: '#4ca05c',
  },
  {
    id: 's-krk',
    title: 'Krakau',
    anchor: [19.94, 50.06],
    routePath: null,
    // City trip: just there and back from home.
    flightPath: [[AMS, [19.94, 50.06]]],
    distanceKm: 0,
    startDate: '2024-11-15',
    endDate: '2024-11-18',
    color: '#c65d8a',
  },
] as unknown as Trip[];
