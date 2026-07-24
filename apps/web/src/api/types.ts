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

export interface TripMember {
  userId: string;
  role: 'OWNER' | 'MEMBER';
  user: { displayName: string; username: string; hasAvatar: boolean };
}

export interface ShareLinkInfo {
  id: string;
  slug: string;
  url: string;
  hasPassword: boolean;
  createdAt: string;
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
  /** Custom trip colour (hex) for the globe/map; null = auto-assigned. */
  color?: string | null;
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
}

export interface ImportedTripSummary {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  pointsImported: number;
}
