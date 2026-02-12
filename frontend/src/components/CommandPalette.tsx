import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

interface Contact {
  id: string;
  name: string;
  email: string;
  title?: string;
  company?: string;
  companyDomain?: string;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  contacts: Contact[];
}

type CommandType = 'navigation' | 'action' | 'contact' | 'company';

interface Command {
  id: string;
  type: CommandType;
  icon: string;
  title: string;
  subtitle?: string;
  action: () => void;
}

export function CommandPalette({ isOpen, onClose, contacts }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Build command list
  const commands = useMemo((): Command[] => {
    const baseCommands: Command[] = [
      {
        id: 'nav-home',
        type: 'navigation',
        icon: '🏠',
        title: 'Go to Home',
        action: () => { navigate('/home'); onClose(); },
      },
      {
        id: 'nav-network',
        type: 'navigation',
        icon: '🌐',
        title: 'Go to Network',
        subtitle: 'View all your connections',
        action: () => { navigate('/network'); onClose(); },
      },
      {
        id: 'nav-spaces',
        type: 'navigation',
        icon: '👥',
        title: 'Go to Spaces',
        subtitle: 'Your communities',
        action: () => { navigate('/spaces'); onClose(); },
      },
      {
        id: 'action-request',
        type: 'action',
        icon: '✨',
        title: 'Request an intro',
        subtitle: 'Ask for a warm introduction',
        action: () => { navigate('/request/new'); onClose(); },
      },
      {
        id: 'action-connect',
        type: 'action',
        icon: '📅',
        title: 'Connect calendar',
        subtitle: 'Sync your meetings',
        action: () => { navigate('/connect'); onClose(); },
      },
    ];

    // Add contact results
    const contactCommands: Command[] = contacts
      .filter(c => {
        if (!query) return false;
        const q = query.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.email.toLowerCase().includes(q) ||
          c.company?.toLowerCase().includes(q)
        );
      })
      .slice(0, 5)
      .map(c => ({
        id: `contact-${c.id}`,
        type: 'contact' as CommandType,
        icon: '👤',
        title: c.name,
        subtitle: c.title ? `${c.title} at ${c.company}` : c.company || c.email,
        action: () => { navigate(`/contact/${c.id}`); onClose(); },
      }));

    // Filter base commands by query
    const filteredBase = query
      ? baseCommands.filter(c => 
          c.title.toLowerCase().includes(query.toLowerCase()) ||
          c.subtitle?.toLowerCase().includes(query.toLowerCase())
        )
      : baseCommands;

    return [...contactCommands, ...filteredBase];
  }, [query, contacts, navigate, onClose]);

  // Keep selected index in bounds
  useEffect(() => {
    if (selectedIndex >= commands.length) {
      setSelectedIndex(Math.max(0, commands.length - 1));
    }
  }, [commands.length, selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, commands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (commands[selectedIndex]) {
          commands[selectedIndex].action();
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="command-palette-input-wrapper">
          <svg className="command-palette-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search people, companies, or actions..."
            className="command-palette-input"
          />
          <kbd className="command-palette-esc">ESC</kbd>
        </div>

        {/* Results */}
        <div className="command-palette-results">
          {commands.length === 0 ? (
            <div className="command-palette-empty">
              <span className="command-palette-empty-icon">🔍</span>
              <span>No results found</span>
            </div>
          ) : (
            commands.map((command, index) => (
              <button
                key={command.id}
                className={`command-palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={command.action}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="command-palette-item-icon">{command.icon}</span>
                <div className="command-palette-item-text">
                  <span className="command-palette-item-title">{command.title}</span>
                  {command.subtitle && (
                    <span className="command-palette-item-subtitle">{command.subtitle}</span>
                  )}
                </div>
                {index === selectedIndex && (
                  <span className="command-palette-item-hint">↵</span>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="command-palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> to navigate</span>
          <span><kbd>↵</kbd> to select</span>
          <span><kbd>esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
