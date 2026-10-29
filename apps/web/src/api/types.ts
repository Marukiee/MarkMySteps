export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * What signing in answers when the account has an authenticator app: the
 * password was right, now the code. The token is only good for sending it back.
 */
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface TwoFactorSetup {
  /** The secret as text, for an app that cannot scan. */
  secret: string;
  /** What the QR code holds. */
  otpauthUri: string;
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
  /** The days they were there, 'YYYY-MM-DD'; null (or missing on an older
   *  server) is from the first day or to the last. */
  fromDate?: string | null;
  toDate?: string | null;
  user: { displayName: string; username: string; hasAvatar: boolean };
}

export interface ShareLinkInfo {
  id: string;
  slug: string;
  url: string;
  hasPassword: boolean;
  /** False for a travel companion: they may pass the link on, not change it. */
  canManage: boolean;
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
  /** Displayed pixel size, EXIF orientation applied. Null on older refs and on
   *  photos that never left the phone; the gallery falls back to a square. */
  width?: number | null;
  height?: number | null;
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
  | 'ACCESS_DENIED'
  | 'SECURITY_LOGIN_ATTEMPTS'
  | 'ACCOUNT_REQUESTED';

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
  /** The whole sentence, for the kinds that are not about a trip. */
  detail?: string | null;
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

/** A comment on one photo or one day's story, from a visitor on the share link or from the trip. */
export interface PhotoComment {
  id: string;
  /** The photo it is about, or null for a comment on a day's story. */
  mediaId: string | null;
  /** yyyy-mm-dd: the day whose story it is about. */
  day: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  /** Written by somebody on the trip, from the app. */
  traveller: boolean;
  /** Only in the app: whether you may take it away (owner, or your own). */
  canDelete?: boolean;
}
