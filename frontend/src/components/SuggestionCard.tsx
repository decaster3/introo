import { PersonAvatar } from './PersonAvatar';

interface Suggestion {
  id: string;
  type: 'help_opportunity' | 'reconnect' | 'pending_ask' | 'ai_insight' | 'network_insight';
  title: string;
  description: string;
  context?: string;
  primaryAction: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  person?: {
    name: string;
    email?: string;
    avatar?: string | null;
    company?: string;
  };
  metadata?: {
    strength?: 'strong' | 'medium' | 'weak';
    timeAgo?: string;
    count?: number;
  };
}

interface SuggestionCardProps {
  suggestion: Suggestion;
}

const typeIcons: Record<Suggestion['type'], string> = {
  help_opportunity: '💡',
  reconnect: '🔄',
  pending_ask: '📬',
  ai_insight: '✨',
  network_insight: '🌐',
};

const typeLabels: Record<Suggestion['type'], string> = {
  help_opportunity: 'You could help',
  reconnect: 'Time to reconnect',
  pending_ask: 'Your asks',
  ai_insight: 'AI suggestion',
  network_insight: 'Your network',
};

export function SuggestionCard({ suggestion }: SuggestionCardProps) {
  return (
    <div className={`suggestion-card suggestion-card--${suggestion.type}`}>
      {/* Type indicator */}
      <div className="suggestion-card-type">
        <span className="suggestion-card-icon">{typeIcons[suggestion.type]}</span>
        <span className="suggestion-card-label">{typeLabels[suggestion.type]}</span>
      </div>

      {/* Content */}
      <div className="suggestion-card-content">
        {/* Person avatar if available */}
        {suggestion.person && (
          <div className="suggestion-card-person">
            <PersonAvatar
              email={suggestion.person.email}
              name={suggestion.person.name}
              avatarUrl={suggestion.person.avatar}
              size={44}
            />
          </div>
        )}

        <div className="suggestion-card-text">
          <h3 className="suggestion-card-title">{suggestion.title}</h3>
          <p className="suggestion-card-description">{suggestion.description}</p>
          
          {suggestion.context && (
            <p className="suggestion-card-context">
              {suggestion.metadata?.strength && (
                <span className={`strength-dot strength-dot--${suggestion.metadata.strength}`} />
              )}
              {suggestion.context}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="suggestion-card-actions">
        <button 
          className="suggestion-action suggestion-action--primary"
          onClick={suggestion.primaryAction.onClick}
        >
          {suggestion.primaryAction.label}
        </button>
        
        {suggestion.secondaryAction && (
          <button 
            className="suggestion-action suggestion-action--secondary"
            onClick={suggestion.secondaryAction.onClick}
          >
            {suggestion.secondaryAction.label}
          </button>
        )}
      </div>
    </div>
  );
}
