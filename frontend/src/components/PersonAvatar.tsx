import { useState } from 'react';

export interface PersonAvatarProps {
  email?: string;
  name?: string;
  avatarUrl?: string | null;
  size?: number;
}

/**
 * Person Avatar component with fallback to initials
 * Safari-friendly: avoids third-party image services that may be blocked
 */
export function PersonAvatar({ 
  email, 
  name, 
  avatarUrl: providedAvatarUrl, 
  size = 48 
}: PersonAvatarProps) {
  const [imageError, setImageError] = useState(false);
  
  const initials = name 
    ? name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
    : (email ? email.charAt(0).toUpperCase() : '?');
  
  // Show initials if no avatar URL or image failed to load
  if (!providedAvatarUrl || imageError) {
    return (
      <div style={{ 
        width: size, 
        height: size, 
        background: '#1d1d24', 
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ff6b4a',
        fontWeight: 700,
        fontSize: size * 0.35,
        flexShrink: 0
      }}>
        {initials}
      </div>
    );
  }
  
  return (
    <div style={{ 
      width: size, 
      height: size, 
      borderRadius: '50%',
      flexShrink: 0,
      overflow: 'hidden',
      background: '#1d1d24'
    }}>
      <img 
        src={providedAvatarUrl}
        alt={name || 'Person'}
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={() => setImageError(true)}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
