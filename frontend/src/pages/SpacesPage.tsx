import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAppState } from '../store';
import { API_BASE } from '../lib/api';

interface Space {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  isPrivate: boolean;
  inviteCode: string;
  ownerId: string;
  members: {
    id: string;
    role: string;
    user: {
      id: string;
      name: string;
      email: string;
      avatar: string | null;
    };
  }[];
}

export function SpacesPage() {
  const { currentUser } = useAppState();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showInvite, setShowInvite] = useState<string | null>(null);

  // Search and sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'members' | 'name'>('recent');

  // Form state
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceEmoji, setNewSpaceEmoji] = useState('🫛');
  const [newSpaceDesc, setNewSpaceDesc] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');

  useEffect(() => {
    fetchSpaces();
  }, []);

  const fetchSpaces = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, { credentials: 'include' });
      const data = await res.json();
      setSpaces(data);
    } catch (e) {
      console.error('Failed to fetch spaces:', e);
    } finally {
      setLoading(false);
    }
  };

  const createSpace = async () => {
    if (!newSpaceName.trim()) return;
    try {
      await fetch(`${API_BASE}/api/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: newSpaceName,
          emoji: newSpaceEmoji,
          description: newSpaceDesc || null,
        }),
      });
      setNewSpaceName('');
      setNewSpaceEmoji('🫛');
      setNewSpaceDesc('');
      setShowCreate(false);
      fetchSpaces();
    } catch (e) {
      console.error('Failed to create space:', e);
    }
  };

  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);

  const joinSpace = async () => {
    if (!joinCode.trim()) return;
    setJoinError('');
    setJoining(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces/join/${joinCode.trim()}`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error || 'Failed to join space');
        return;
      }
      if (data.pending) {
        setJoinError('Your request is pending approval');
        setJoinCode('');
        return;
      }
      setJoinCode('');
      setShowJoin(false);
      fetchSpaces();
    } catch (e) {
      console.error('Failed to join space:', e);
      setJoinError('Failed to join space. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const inviteMember = async (spaceId: string) => {
    if (!inviteEmail.trim()) return;
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: inviteEmail }),
      });
      setInviteEmail('');
      setShowInvite(null);
      fetchSpaces();
    } catch (e) {
      console.error('Failed to invite member:', e);
    }
  };

  const leaveSpace = async (spaceId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/leave`, {
        method: 'POST',
        credentials: 'include',
      });
      fetchSpaces();
    } catch (e) {
      console.error('Failed to leave space:', e);
    }
  };

  const copyInviteCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  // Filter and sort spaces
  const filteredSpaces = useMemo(() => {
    let result = [...spaces];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(space =>
        space.name.toLowerCase().includes(query) ||
        (space.description?.toLowerCase().includes(query))
      );
    }

    // Sort
    return result.sort((a, b) => {
      if (sortBy === 'members') {
        return b.members.length - a.members.length;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      // Default: recent (by id for now, could be createdAt if available)
      return 0;
    });
  }, [spaces, searchQuery, sortBy]);

  if (loading) {
    return (
      <div className="crm-page">
        <div className="loading-state">Loading spaces...</div>
      </div>
    );
  }

  return (
    <div className="crm-page">
      <div className="crm-header">
        <div className="crm-title">
          <h1>Your Spaces</h1>
          <p className="crm-subtitle">{spaces.length} space{spaces.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => setShowJoin(true)}>
            Join Space
          </button>
          <Link to="/spaces/new" className="btn-primary">
            + Create Space
          </Link>
        </div>
      </div>

      <div className="crm-content">
        {/* Toolbar */}
        <div className="crm-toolbar">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search spaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="sort-controls">
            <button 
              className={`sort-btn ${sortBy === 'recent' ? 'active' : ''}`}
              onClick={() => setSortBy('recent')}
            >
              Recent
            </button>
            <button 
              className={`sort-btn ${sortBy === 'members' ? 'active' : ''}`}
              onClick={() => setSortBy('members')}
            >
              Members
            </button>
            <button 
              className={`sort-btn ${sortBy === 'name' ? 'active' : ''}`}
              onClick={() => setSortBy('name')}
            >
              A-Z
            </button>
          </div>
        </div>

        {/* Spaces Grid */}
        {filteredSpaces.length === 0 ? (
          <div className="empty-network">
            <div className="empty-icon">✨</div>
            <h2>{spaces.length === 0 ? 'No spaces yet' : 'No results'}</h2>
            <p>{spaces.length === 0 ? 'Create a space or join one with an invite code' : 'Try a different search term'}</p>
          </div>
        ) : (
          <div className="spaces-grid">
            {filteredSpaces.map(space => {
              const isOwner = space.ownerId === currentUser?.id;
              return (
                <div key={space.id} className="space-card-simple">
                  <Link to={`/spaces/${space.id}`} className="space-card-header clickable">
                    <span className="space-emoji-large">{space.emoji}</span>
                    <div className="space-card-info">
                      <h3>{space.name}</h3>
                      <p className="space-member-count">{space.members.length} member{space.members.length !== 1 ? 's' : ''}</p>
                    </div>
                    {isOwner && <span className="owner-badge">Owner</span>}
                  </Link>

                  {space.description && (
                    <p className="space-description">{space.description}</p>
                  )}

                  <div className="space-members-row">
                    {space.members.slice(0, 5).map(m => (
                      <div key={m.id} className="member-bubble-small" title={m.user.name}>
                        {m.user.avatar ? (
                          <img src={m.user.avatar} alt="" referrerPolicy="no-referrer" />
                        ) : (
                          <span>{m.user.name.charAt(0)}</span>
                        )}
                      </div>
                    ))}
                    {space.members.length > 5 && (
                      <div className="member-bubble-small more">+{space.members.length - 5}</div>
                    )}
                  </div>

                  <div className="space-card-actions">
                    {isOwner ? (
                      <>
                        <button className="btn-text" onClick={() => setShowInvite(space.id)}>Invite</button>
                        <button className="btn-text" onClick={() => copyInviteCode(space.inviteCode)}>Copy Code</button>
                      </>
                    ) : (
                      <button className="btn-text" onClick={() => leaveSpace(space.id)}>Leave</button>
                    )}
                  </div>

                  {/* Inline invite form */}
                  {showInvite === space.id && (
                    <div className="inline-form">
                      <input
                        type="email"
                        placeholder="Member's email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                      <button className="btn-primary" onClick={() => inviteMember(space.id)}>Add</button>
                      <button className="btn-text" onClick={() => setShowInvite(null)}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create Space Modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-simple" onClick={e => e.stopPropagation()}>
            <h2>Create a Space</h2>
            <div className="form-group">
              <label>Emoji</label>
              <input
                type="text"
                value={newSpaceEmoji}
                onChange={(e) => setNewSpaceEmoji(e.target.value)}
                maxLength={2}
                className="emoji-input"
              />
            </div>
            <div className="form-group">
              <label>Name</label>
              <input
                type="text"
                placeholder="Founders Circle"
                value={newSpaceName}
                onChange={(e) => setNewSpaceName(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Description (optional)</label>
              <textarea
                placeholder="What's this space about?"
                value={newSpaceDesc}
                onChange={(e) => setNewSpaceDesc(e.target.value)}
              />
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              <button className="btn-primary" onClick={createSpace} disabled={!newSpaceName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Join Space Modal */}
      {showJoin && (
        <div className="modal-overlay" onClick={() => { setShowJoin(false); setJoinError(''); }}>
          <div className="modal-simple" onClick={e => e.stopPropagation()}>
            <h2>Join a Space</h2>
            <div className="form-group">
              <label>Invite Code</label>
              <input
                type="text"
                placeholder="Paste invite code"
                value={joinCode}
                onChange={(e) => { setJoinCode(e.target.value); setJoinError(''); }}
              />
            </div>
            {joinError && (
              <div className="form-error" style={{ color: '#ff6b4a', fontSize: '0.875rem', marginBottom: '1rem' }}>
                {joinError}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => { setShowJoin(false); setJoinError(''); }}>Cancel</button>
              <button className="btn-primary" onClick={joinSpace} disabled={!joinCode.trim() || joining}>
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
