import type { NotificationItem } from '../api/types';

/**
 * A bell's worth of examples, for developer options.
 *
 * Ids are plain strings rather than uuids: nothing here ever reaches the
 * server, and the sheet only uses them as React keys. Opened on the real
 * travellers page, from the real bell, so what you are looking at is the
 * screen itself and not a mock-up of it.
 */
export const DEMO_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'demo-request',
    kind: 'ACCESS_REQUESTED',
    createdAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    read: false,
    actor: { id: 'demo-1', displayName: 'Ties', username: 'ties', hasAvatar: false },
    trip: { id: 'demo-trip-1', title: 'Roadtrip' },
    request: { id: 'demo-req-1', status: 'PENDING', message: 'Hoi! Mag ik meekijken?' },
  },
  {
    id: 'demo-added',
    kind: 'TRIP_ADDED',
    createdAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    read: false,
    actor: { id: 'demo-2', displayName: 'Sanne', username: 'sanne', hasAvatar: false },
    trip: { id: 'demo-trip-2', title: 'Interrail 2026' },
    request: null,
  },
  {
    id: 'demo-approved',
    kind: 'ACCESS_APPROVED',
    createdAt: new Date(Date.now() - 30 * 3_600_000).toISOString(),
    read: true,
    actor: { id: 'demo-3', displayName: 'Joris', username: 'joris', hasAvatar: false },
    trip: { id: 'demo-trip-3', title: 'Noorwegen' },
    request: null,
  },
  {
    id: 'demo-denied',
    kind: 'ACCESS_DENIED',
    createdAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
    read: true,
    actor: { id: 'demo-4', displayName: 'Eva', username: 'eva', hasAvatar: false },
    trip: { id: 'demo-trip-4', title: 'Marokko' },
    request: null,
  },
];
