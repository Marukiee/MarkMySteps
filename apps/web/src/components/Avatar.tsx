import { colorForUser } from '../lib/colors';
import { AuthImage } from './AuthImage';

interface AvatarProps {
  userId: string;
  displayName: string;
  hasAvatar?: boolean;
  size?: number;
  className?: string;
}

/** Round avatar: uploaded image when present, colored initial otherwise. */
export function Avatar({ userId, displayName, hasAvatar, size = 36, className }: AvatarProps) {
  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    objectFit: 'cover',
  } as const;

  if (hasAvatar) {
    return (
      <AuthImage path={`/users/${userId}/avatar`} alt={displayName} className={className} style={style} />
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
