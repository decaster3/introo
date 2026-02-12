import { useState, useRef, useEffect } from 'react';

interface PromptBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  isProcessing?: boolean;
  placeholder?: string;
}

export function PromptBar({
  value,
  onChange,
  onSubmit,
  isProcessing = false,
  placeholder = "Who do you want to meet?",
}: PromptBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim() && !isProcessing) {
      onSubmit(value.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="prompt-bar-wrapper">
      <div className={`prompt-bar ${isFocused ? 'focused' : ''} ${isProcessing ? 'processing' : ''}`}>
        {/* Glow effect */}
        <div className="prompt-bar-glow" />
        
        {/* Icon */}
        <div className="prompt-bar-icon">
          {isProcessing ? (
            <div className="prompt-spinner" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          )}
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={isProcessing}
          className="prompt-bar-input"
        />

        {/* Submit button */}
        {value.trim() && (
          <button 
            type="submit" 
            className="prompt-bar-submit"
            disabled={isProcessing}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </div>

      {/* Quick suggestions */}
      {!value && !isProcessing && (
        <div className="prompt-suggestions">
          <button 
            type="button" 
            className="prompt-suggestion"
            onClick={() => onChange("I need an intro to ")}
          >
            🤝 Request an intro
          </button>
          <button 
            type="button" 
            className="prompt-suggestion"
            onClick={() => onChange("Who do I know at ")}
          >
            🔍 Search my network
          </button>
          <button 
            type="button" 
            className="prompt-suggestion"
            onClick={() => onChange("Show me founders in ")}
          >
            👥 Find people
          </button>
        </div>
      )}
    </form>
  );
}
