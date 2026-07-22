/** Local display preferences (device-scoped, no server round-trip). */

export type MapStyleId = 'positron' | 'bright' | 'liberty';

const MAP_STYLE_KEY = 'mms.mapstyle';

export const MAP_STYLES: { id: MapStyleId; label: string }[] = [
  { id: 'positron', label: 'Licht & minimaal' },
  { id: 'bright', label: 'Helder & kleurrijk' },
  { id: 'liberty', label: 'Klassiek' },
];

export function getMapStyle(): string {
  const id = (localStorage.getItem(MAP_STYLE_KEY) as MapStyleId | null) ?? 'positron';
  return `https://tiles.openfreemap.org/styles/${id}`;
}

export function getMapStyleId(): MapStyleId {
  return (localStorage.getItem(MAP_STYLE_KEY) as MapStyleId | null) ?? 'positron';
}

export function setMapStyleId(id: MapStyleId): void {
  localStorage.setItem(MAP_STYLE_KEY, id);
}
