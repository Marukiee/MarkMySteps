export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  role: 'ADMIN' | 'USER';
  mustChangePassword: boolean;
  hasAvatar: boolean;
}

export interface LiveFix {
  userId: string;
  displayName: string;
  hasAvatar: boolean;
  latitude: number;
  longitude: number;
  recordedAt: string;
  accuracy: number | null;
}

export type TripRole = 'OWNER' | 'MEMBER' | 'GUEST';

export interface TripMember {
  userId: string;
  role: TripRole;
  canTrack: boolean;
  user: { displayName: string; username: string; hasAvatar: boolean };
}

export interface ShareLinkInfo {
  id: string;
  slug: string;
  url: string;
  hasPassword: boolean;
  createdAt: string;
}

/** A poster made from a trip; the images themselves are fetched per page. */
export interface TripSummaryInfo {
  id: string;
  tripId: string;
  title: string;
  template: string;
  scopeLabel: string;
  spec: unknown;
  createdAt: string;
  createdBy: { id: string; displayName: string };
  pages: { index: number; width: number; height: number }[];
}

export interface Trip {
  id: string;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  coverMediaId: string | null;
  resolvedCoverId: string | null;
  anchor: [number, number] | null;
  /** Every planned stop with coordinates, day trips included, in travel order. */
  stopPoints?: [number, number][];
  /**
   * The trip's legs in the order they were travelled. Absent for a trip with a
   * tracked route, and on older servers.
   */
  journey?: { flight: boolean; points: [number, number][] }[];
  /** Custom trip colour (hex) for the globe/map; null = auto-assigned. */
  color?: string | null;
  /** Manual globe-marker position ([lng,lat]); null = auto (route start/end). */
  markerLng?: number | null;
  markerLat?: number | null;
  distanceKm?: number;
  routePath?: [number, number][][];
  flightPath?: [number, number][][];
  autoTrack: boolean;
  ownerId: string;
  members: TripMember[];
}

export interface MediaItem {
  id: string;
  userId: string;
  immichAssetId: string;
  assetType: 'IMAGE' | 'VIDEO';
  takenAt: string;
  latitude: number | null;
  longitude: number | null;
}

export interface RouteFeature {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: { userId: string; displayName: string; pointCount: number };
}

export interface RouteCollection {
  type: 'FeatureCollection';
  features: RouteFeature[];
}

export interface ConnectionStatus {
  serverUrl: string;
  publicUrl: string | null;
  apiKeyPreview: string;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export interface SyncResult {
  tripId: string;
  usersSynced: number;
  assetsFound: number;
  assetsAdded: number;
  /** Local gallery only: false when the photos came in without coordinates
   *  because ACCESS_MEDIA_LOCATION was refused. */
  hasLocation?: boolean;
}

export interface ImportedTripSummary {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  pointsImported: number;
}

/** What the bell carries. Kinds the app does not know are simply not drawn. */
export type NotificationKind =
  | 'TRIP_ADDED'
  | 'ACCESS_REQUESTED'
  | 'ACCESS_APPROVED'
  | 'ACCESS_DENIED';

export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  createdAt: string;
  read: boolean;
  actor: { id: string; displayName: string; username: string; hasAvatar: boolean } | null;
  trip: { id: string; title: string } | null;
  /** Present on ACCESS_REQUESTED — the question you can answer from the list. */
  request: { id: string; status: AccessRequestStatus; message: string | null } | null;
}

/** All a trip you cannot open will say about itself. */
export interface TripAccessPreview {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  owner: { id: string; displayName: string; username: string; hasAvatar: boolean };
  status: 'NONE' | 'PENDING' | 'APPROVED' | 'DENIED' | 'MEMBER';
}
