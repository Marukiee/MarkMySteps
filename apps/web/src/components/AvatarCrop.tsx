import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './avatarcrop.css';

/**
 * Square avatar cropper: drag to pan, slider to zoom, exports a 512×512 JPEG.
 * `source` is any image URL (a picked file's object-URL or the current avatar).
 */
export function AvatarCrop({
  source,
  onCancel,
  onCropped,
}: {
  source: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}) {
  const VIEW = 260; // on-screen crop box (px)
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const baseRef = useRef(1); // scale that makes the image cover the box at zoom 1
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      // Cover the box: the smaller side fills VIEW.
      baseRef.current = VIEW / Math.min(img.width, img.height);
      setOffset({ x: 0, y: 0 });
      setZoom(1);
      setReady(true);
    };
    img.src = source;
  }, [source]);

  // Keep the image covering the box (no empty corners) after pan/zoom.
  const clamp = (o: { x: number; y: number }, z: number) => {
    const img = imgRef.current;
    if (!img) return o;
    const s = baseRef.current * z;
    const w = img.width * s;
    const h = img.height * s;
    const maxX = Math.max(0, (w - VIEW) / 2);
    const maxY = Math.max(0, (h - VIEW) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, o.x)),
      y: Math.max(-maxY, Math.min(maxY, o.y)),
    };
  };

  const onDown = (e: ReactPointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setOffset(clamp({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, zoom));
  };
  const onUp = () => (dragRef.current = null);

  const changeZoom = (z: number) => {
    setZoom(z);
    setOffset((o) => clamp(o, z));
  };

  const apply = () => {
    const img = imgRef.current;
    if (!img) return;
    const OUT = 512;
    const canvas = document.createElement('canvas');
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = baseRef.current * zoom;
    // Map the on-screen box back to source pixels.
    const srcSize = VIEW / s;
    const cx = img.width / 2 - offset.x / s;
    const cy = img.height / 2 - offset.y / s;
    ctx.drawImage(img, cx - srcSize / 2, cy - srcSize / 2, srcSize, srcSize, 0, 0, OUT, OUT);
    canvas.toBlob((b) => b && onCropped(b), 'image/jpeg', 0.9);
  };

  const img = imgRef.current;
  const s = img ? baseRef.current * zoom : 1;

  return (
    <div className="avatar-crop-backdrop" onClick={onCancel}>
      <div className="avatar-crop card" onClick={(e) => e.stopPropagation()}>
        <h3>Profielfoto bijsnijden</h3>
        <div
          className="avatar-crop-view"
          style={{ width: VIEW, height: VIEW }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {ready && img && (
            <img
              src={source}
              alt=""
              draggable={false}
              style={{
                width: img.width * s,
                height: img.height * s,
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          )}
          <div className="avatar-crop-ring" />
        </div>
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => changeZoom(Number(e.target.value))}
          aria-label="Zoom"
        />
        <div className="avatar-crop-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Annuleren
          </button>
          <button className="btn btn-primary" onClick={apply} disabled={!ready}>
            <Icon name="check" size={15} /> Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
