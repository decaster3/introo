import { useState } from 'react';

export interface CompanyLogoProps {
  domain?: string;
  name?: string;
  size?: number;
}

/**
 * Company Logo component with fallback
 * Uses Google Favicons API for logos, falls back to letter initial
 */
export function CompanyLogo({ domain, name, size = 48 }: CompanyLogoProps) {
  const [hasError, setHasError] = useState(false);
  
  const fallbackLetter = name ? name.charAt(0).toUpperCase() : '?';
  
  // If no domain or image failed to load, show letter fallback
  if (!domain || hasError) {
    return (
      <div style={{ 
        width: size, 
        height: size, 
        background: '#1d1d24', 
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#ff6b4a',
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0
      }}>
        {fallbackLetter}
      </div>
    );
  }
  
  return (
    <div style={{ 
      width: size, 
      height: size, 
      background: '#1d1d24', 
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      overflow: 'hidden',
      padding: size > 24 ? '8px' : '2px'
    }}>
      <img 
        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
        alt={name || 'Company'}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={() => setHasError(true)}
      />
    </div>
  );
}
