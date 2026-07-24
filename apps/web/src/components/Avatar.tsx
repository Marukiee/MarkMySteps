import { useEffect, useState } from 'react';
import { colorForUser } from '../lib/colors';
import { AuthImage, evictImage } from './AuthImage';

/** Force all avatars for a user to reload (after they change their photo). */
export function bumpAvatar(userId: string): void {
  evictImage(`/users/${userId}/avatar`);
  window.dispatchEvent(new CustomEvent('mms-avatar', { detail: userId }));
}

interface AvatarProps {
  userId: string;
  displayName: string;
  hasAvatar?: boolean;
  size?: number;
  className?: string;
}

/** Round avatar: uploaded image when present, colored initial otherwise. */
export function Avatar({ userId, displayName, hasAvatar, size = 36, className }: AvatarProps) {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === userId) setVer((v) => v + 1);
    };
    window.addEventListener('mms-avatar', on);
    return () => window.removeEventListener('mms-avatar', on);
  }, [userId]);

  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover',
  } as const;

  if (hasAvatar) {
    return (
      <AuthImage
        path={`/users/${userId}/avatar${ver ? `?v=${ver}` : ''}`}
        alt={displayName}
        className={className}
        style={style}
      />
    );
  }
  return (
    <span
      className={className}
      style={{
        ...style,
        background: colorForUser(userId),
        color: '#fff',
        display: 'grid',
        placeContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.42,
      }}
    >
      {displayName[0]?.toUpperCase()}
    </span>
  );
}
