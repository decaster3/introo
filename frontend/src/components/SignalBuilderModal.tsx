import { useState } from 'react';

export interface Signal {
  id: string;
  name: string;
  description?: string;
  entityType: 'person' | 'company';
  triggerType: 'field_change' | 'prompt_based';
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  _count?: { matches: number };
}

interface SignalBuilderModalProps {
  signal?: Signal | null;
  onClose: () => void;
  onSaved: () => void;
}

export function SignalBuilderModal({ signal, onClose, onSaved }: SignalBuilderModalProps) {
  const isEditing = !!signal;
  const [step, setStep] = useState(isEditing ? 4 : 1); // Jump to last step for editing
  const [entityType, setEntityType] = useState<'person' | 'company'>(
    (signal?.entityType as 'person' | 'company') || 'person'
  );
  const [triggerType, setTriggerType] = useState<'field_change' | 'prompt_based'>(
    (signal?.triggerType as 'field_change' | 'prompt_based') || 'field_change'
  );
  const [name, setName] = useState(signal?.name || '');
  const [description, setDescription] = useState(signal?.description || '');
  const [config, setConfig] = useState<Record<string, unknown>>(
    (signal?.config as Record<string, unknown>) || {}
  );
  const [isActive, setIsActive] = useState(signal?.isActive ?? true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Field options for person
  const personFieldOptions = [
    { value: 'title', label: 'Job Title Changed', description: 'When someone changes their role or position' },
    { value: 'company', label: 'Company Changed', description: 'When someone moves to a new company' },
  ];

  // Field options for company
  const companyFieldOptions = [
    { value: 'headcount', label: 'Team Size Changed', description: 'When company headcount grows or shrinks' },
    { value: 'new_roles', label: 'New Open Roles', description: 'When new positions are posted (e.g., B2B Sales)' },
    { value: 'key_hires', label: 'Key Hires', description: 'When someone joins as CBDO, Head of Sales, etc.' },
  ];

  // Prompt templates
  const personPromptTemplates = [
    { label: 'Recent Activity', prompt: 'What interesting things happened to this person in the last 3 months?' },
    { label: 'Career Updates', prompt: 'Any significant career developments or achievements?' },
  ];

  const companyPromptTemplates = [
    { label: 'Company News', prompt: 'Any significant news about this company in the last 3 months?' },
    { label: 'Product Updates', prompt: 'How has their product evolved recently?' },
    { label: 'Team Growth', prompt: 'How has the team grown and in which departments?' },
  ];

  const handleSubmit = async () => {
    if (!name.trim()) {
      alert('Please enter a signal name');
      return;
    }
    
    setIsSubmitting(true);
    try {
      const url = isEditing && signal ? `/api/signals/${signal.id}` : '/api/signals';
      const method = isEditing ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          description,
          entityType,
          triggerType,
          config,
          isActive,
        }),
      });
      
      if (res.ok) {
        onSaved();
      } else {
        const error = await res.json().catch(() => ({ error: 'Unknown error' }));
        alert(`Failed to ${isEditing ? 'update' : 'create'} signal: ${error.error || res.statusText}`);
      }
    } catch (e) {
      console.error(`Failed to ${isEditing ? 'update' : 'create'} signal:`, e);
      alert(`Failed to ${isEditing ? 'update' : 'create'} signal. Please check if the server is running.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="signal-builder-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEditing ? 'Edit Signal' : 'Create New Signal'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {/* Progress Steps */}
        <div className="signal-builder-steps">
          <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
            <span className="step-number">1</span>
            <span className="step-label">Type</span>
          </div>
          <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
            <span className="step-number">2</span>
            <span className="step-label">Trigger</span>
          </div>
          <div className={`step ${step >= 3 ? 'active' : ''} ${step > 3 ? 'completed' : ''}`}>
            <span className="step-number">3</span>
            <span className="step-label">Configure</span>
          </div>
          <div className={`step ${step >= 4 ? 'active' : ''}`}>
            <span className="step-number">4</span>
            <span className="step-label">Save</span>
          </div>
        </div>

        <div className="signal-builder-content">
          {/* Step 1: Entity Type */}
          {step === 1 && (
            <div className="step-content">
              <h3>What do you want to track?</h3>
              <p className="step-description">Choose whether to track updates about people or companies in your network.</p>
              
              <div className="entity-type-options">
                <button 
                  className={`entity-option ${entityType === 'person' ? 'selected' : ''}`}
                  onClick={() => setEntityType('person')}
                >
                  <span className="entity-icon">👤</span>
                  <span className="entity-label">People</span>
                  <span className="entity-desc">Track role changes, company moves, and personal updates</span>
                </button>
                <button 
                  className={`entity-option ${entityType === 'company' ? 'selected' : ''}`}
                  onClick={() => setEntityType('company')}
                >
                  <span className="entity-icon">🏢</span>
                  <span className="entity-label">Companies</span>
                  <span className="entity-desc">Track team growth, new hires, news, and product updates</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Trigger Type */}
          {step === 2 && (
            <div className="step-content">
              <h3>How should the signal trigger?</h3>
              <p className="step-description">Choose between tracking specific data changes or using AI to analyze updates.</p>
              
              <div className="trigger-type-options">
                <button 
                  className={`trigger-option ${triggerType === 'field_change' ? 'selected' : ''}`}
                  onClick={() => setTriggerType('field_change')}
                >
                  <span className="trigger-icon">📊</span>
                  <span className="trigger-label">Field Change</span>
                  <span className="trigger-desc">Trigger when a specific data field changes (title, company, headcount)</span>
                </button>
                <button 
                  className={`trigger-option ${triggerType === 'prompt_based' ? 'selected' : ''}`}
                  onClick={() => setTriggerType('prompt_based')}
                >
                  <span className="trigger-icon">🤖</span>
                  <span className="trigger-label">AI Analysis</span>
                  <span className="trigger-desc">Use AI to periodically analyze and surface interesting updates</span>
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Configure */}
          {step === 3 && (
            <div className="step-content">
              <h3>Configure your signal</h3>
              
              {triggerType === 'field_change' ? (
                <>
                  <p className="step-description">Select which field changes to track.</p>
                  <div className="field-options">
                    {(entityType === 'person' ? personFieldOptions : companyFieldOptions).map(option => (
                      <label key={option.value} className="field-option">
                        <input
                          type="radio"
                          name="field"
                          checked={config.field === option.value}
                          onChange={() => setConfig({ ...config, field: option.value })}
                        />
                        <div className="field-option-content">
                          <span className="field-option-label">{option.label}</span>
                          <span className="field-option-desc">{option.description}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="step-description">Choose a prompt template or write your own.</p>
                  <div className="prompt-templates">
                    {(entityType === 'person' ? personPromptTemplates : companyPromptTemplates).map((template, i) => (
                      <button
                        key={i}
                        className={`prompt-template ${config.prompt === template.prompt ? 'selected' : ''}`}
                        onClick={() => setConfig({ ...config, prompt: template.prompt })}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="prompt-input"
                    placeholder="Or write your own prompt..."
                    value={(config.prompt as string) || ''}
                    onChange={(e) => setConfig({ ...config, prompt: e.target.value })}
                    rows={3}
                  />
                </>
              )}
            </div>
          )}

          {/* Step 4: Name & Save */}
          {step === 4 && (
            <div className="step-content">
              <h3>Name your signal</h3>
              <p className="step-description">Give your signal a memorable name.</p>
              
              <div className="form-group">
                <label>Signal Name</label>
                <input
                  type="text"
                  placeholder="e.g., Role Changes, New Sales Hires"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  placeholder="What does this signal track?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>

              {isEditing && (
                <div className="form-group">
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span>Signal is active</span>
                  </label>
                  <p className="form-hint">Inactive signals won't trigger new matches</p>
                </div>
              )}

              <div className="signal-summary">
                <h4>Signal Summary</h4>
                <div className="summary-item">
                  <span className="summary-label">Tracking:</span>
                  <span className="summary-value">{entityType === 'person' ? '👤 People' : '🏢 Companies'}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Trigger:</span>
                  <span className="summary-value">
                    {triggerType === 'field_change' 
                      ? `📊 ${config.field || 'Field'} changes`
                      : '🤖 AI Analysis'}
                  </span>
                </div>
                {typeof config.prompt === 'string' && config.prompt && (
                  <div className="summary-item">
                    <span className="summary-label">Prompt:</span>
                    <span className="summary-value prompt">{config.prompt}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step > 1 && (
            <button className="btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {step < 4 ? (
            <button 
              className="btn-primary" 
              onClick={() => setStep(step + 1)}
              disabled={step === 3 && !config.field && !config.prompt}
            >
              Continue
            </button>
          ) : (
            <button 
              className="btn-primary" 
              onClick={handleSubmit}
              disabled={!name.trim() || isSubmitting}
            >
              {isSubmitting ? (isEditing ? 'Saving...' : 'Creating...') : (isEditing ? 'Save Changes' : 'Create Signal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
