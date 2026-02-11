import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { API_BASE } from '../lib/api';

const emojiOptions = ['🚀', '💡', '🔥', '⭐', '🎯', '💎', '🌟', '🎨', '🛠️', '📈', '🤝', '🌍'];

export function CreateSpacePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🚀');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    
    setIsCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: name.trim(),
          emoji,
          description: description.trim() || null,
        }),
      });
      
      if (res.ok) {
        navigate('/spaces');
      } else {
        const error = await res.json();
        console.error('Failed to create space:', error);
        alert(`Failed to create space: ${error.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Failed to create space:', e);
      alert('Failed to create space. Check console for details.');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="create-space-page">
      <div className="create-space-header">
        <Link to="/spaces" className="back-link">← Back to Spaces</Link>
      </div>

      <div className="create-space-card">
        <div className="create-space-preview">
          <span className="preview-emoji">{emoji}</span>
          <h2 className="preview-name">{name || 'Your Space Name'}</h2>
          {description && <p className="preview-desc">{description}</p>}
        </div>

        <div className="create-space-form">
          <div className="form-section">
            <label>Choose an emoji</label>
            <div className="emoji-picker">
              {emojiOptions.map(e => (
                <button
                  key={e}
                  type="button"
                  className={`emoji-option ${emoji === e ? 'selected' : ''}`}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label htmlFor="space-name">Space name</label>
            <input
              id="space-name"
              type="text"
              placeholder="e.g., Founder CY, Innovators, YC Alumni"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-section">
            <label htmlFor="space-desc">Description <span className="optional">(optional)</span></label>
            <textarea
              id="space-desc"
              placeholder="What's this space about? Who should join?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="create-space-actions">
            <Link to="/spaces" className="btn-secondary">Cancel</Link>
            <button 
              className="btn-primary" 
              onClick={handleCreate}
              disabled={!name.trim() || isCreating}
            >
              {isCreating ? 'Creating...' : 'Create Space'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
