import { useState, useEffect, useCallback, useRef } from 'react';

export interface TourStep {
  target: string;          // CSS selector for the element to highlight
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
  icon: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    target: '.u-grid',
    title: 'Your network, mapped',
    description: 'Every company and person from your calendar meetings appears here as a card. We automatically detect who you\'ve met, how often, and how strong the connection is.',
    position: 'top',
    icon: '📇',
  },
  {
    target: '.sb',
    title: 'Smart filters & AI search',
    description: 'Filter by industry, company size, funding stage, connection strength, and more. Use AI search to describe what you\'re looking for in plain English -- like "B2B fintech in NYC".',
    position: 'right',
    icon: '🔍',
  },
  {
    target: '.u-network-btn',
    title: 'Network & Spaces',
    description: 'Create private Spaces with your team, investors, or community. Pool your collective networks and see who your circle can reach. Connect 1:1 with trusted peers to share contacts.',
    position: 'bottom',
    icon: '🤝',
  },
  {
    target: '.u-grid',
    title: 'Your contacts & companies',
    description: 'Click any company card to see every person you\'ve met there, meeting history, and enriched company data. Tag companies, track relationships, and use this as your personal CRM.',
    position: 'top',
    icon: '📋',
  },
  {
    target: '.u-settings-btn',
    title: 'Settings & calendars',
    description: 'Connect multiple Google Calendar accounts to capture your full network. We also auto-enrich every contact with company data, LinkedIn profiles, and funding information.',
    position: 'bottom',
    icon: '⚙️',
  },
  {
    target: '.u-network-btn',
    title: 'Better together',
    description: 'Introo multiplies with every connection. Create a Space and invite a colleague to pool your networks — you\'ll both see warm paths to companies neither could reach alone.',
    position: 'bottom',
    icon: '🚀',
  },
];

const STORAGE_KEY = 'introo_onboarding_complete';

interface OnboardingTourProps {
  forceShow?: boolean;
  onComplete?: () => void;
}

export function OnboardingTour({ forceShow, onComplete }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const tooltipRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  // Decide if tour should show
  useEffect(() => {
    if (forceShow) {
      setVisible(true);
      return;
    }
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done) {
      // Small delay so the page renders first
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, [forceShow]);

  // Position the spotlight and tooltip for the current step
  const positionStep = useCallback(() => {
    if (!visible) return;
    const currentStep = TOUR_STEPS[step];
    const el = document.querySelector(currentStep.target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    setSpotlightRect(rect);

    // Calculate tooltip position after a tick so we have dimensions
    requestAnimationFrame(() => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      const tw = tooltip.offsetWidth;
      const th = tooltip.offsetHeight;
      const gap = 16;
      let top = 0;
      let left = 0;

      switch (currentStep.position) {
        case 'bottom':
          top = rect.bottom + gap;
          left = rect.left + rect.width / 2 - tw / 2;
          break;
        case 'top':
          top = rect.top - th - gap;
          left = rect.left + rect.width / 2 - tw / 2;
          break;
        case 'right':
          top = rect.top + rect.height / 2 - th / 2;
          left = rect.right + gap;
          break;
        case 'left':
          top = rect.top + rect.height / 2 - th / 2;
          left = rect.left - tw - gap;
          break;
      }

      // Clamp to viewport
      left = Math.max(16, Math.min(left, window.innerWidth - tw - 16));
      top = Math.max(16, Math.min(top, window.innerHeight - th - 16));

      setTooltipStyle({ top, left });
    });
  }, [visible, step]);

  useEffect(() => {
    positionStep();
    // Re-position on scroll/resize
    const handler = () => {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(positionStep);
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      cancelAnimationFrame(animRef.current);
    };
  }, [positionStep]);

  const handleNext = useCallback(() => {
    if (step < TOUR_STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      // Complete
      localStorage.setItem(STORAGE_KEY, 'true');
      setVisible(false);
      onComplete?.();
    }
  }, [step, onComplete]);

  const handlePrev = useCallback(() => {
    if (step > 0) setStep(s => s - 1);
  }, [step]);

  const handleSkip = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
    onComplete?.();
  }, [onComplete]);

  if (!visible) return null;

  const current = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;
  const pad = 8; // padding around spotlight

  return (
    <div className="tour-overlay">
      {/* Dark overlay with spotlight cutout via SVG */}
      <svg className="tour-mask" width="100%" height="100%">
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {spotlightRect && (
              <rect
                x={spotlightRect.left - pad}
                y={spotlightRect.top - pad}
                width={spotlightRect.width + pad * 2}
                height={spotlightRect.height + pad * 2}
                rx="12"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.65)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>

      {/* Spotlight border glow */}
      {spotlightRect && (
        <div
          className="tour-spotlight-ring"
          style={{
            top: spotlightRect.top - pad,
            left: spotlightRect.left - pad,
            width: spotlightRect.width + pad * 2,
            height: spotlightRect.height + pad * 2,
          }}
        />
      )}

      {/* Tooltip card */}
      <div className="tour-tooltip" ref={tooltipRef} style={tooltipStyle}>
        <div className="tour-tooltip-header">
          <span className="tour-tooltip-icon">{current.icon}</span>
          <h3 className="tour-tooltip-title">{current.title}</h3>
          <button className="tour-tooltip-close" onClick={handleSkip} title="Skip tour">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="tour-tooltip-desc">{current.description}</p>
        <div className="tour-tooltip-footer">
          <div className="tour-tooltip-dots">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={`tour-dot ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} />
            ))}
          </div>
          <div className="tour-tooltip-actions">
            {step > 0 && (
              <button className="tour-btn tour-btn--back" onClick={handlePrev}>
                Back
              </button>
            )}
            <button className="tour-btn tour-btn--next" onClick={handleNext}>
              {isLast ? 'Get started' : 'Next'}
              {!isLast && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="tour-tooltip-progress">
          <div className="tour-tooltip-progress-bar" style={{ width: `${((step + 1) / TOUR_STEPS.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}

/** Utility: reset onboarding so it shows again */
export function resetOnboarding() {
  localStorage.removeItem(STORAGE_KEY);
}
