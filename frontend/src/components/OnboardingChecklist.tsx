import { useState, useEffect, useCallback, useMemo } from 'react';
import { authApi } from '../lib/api';

const DISMISSED_KEY = 'introo_onboarding_dismissed';

export type StepKey =
  | 'connectCalendar'
  | 'enrichContacts'
  | 'openCard'
  | 'applyFilter'
  | 'saveView'
  | 'acceptConnection'
  | 'inviteFriend'
  | 'requestIntro';

export type ChecklistProgress = Record<StepKey, boolean>;
export type ChecklistActions = Record<StepKey, () => void>;

interface Step { key: StepKey; icon: string; label: string }

const STEPS: Step[] = [
  { key: 'connectCalendar', icon: '📅', label: 'Connect Calendar' },
  { key: 'enrichContacts', icon: '✨', label: 'Enrich your contacts' },
  { key: 'openCard', icon: '🏢', label: 'Open a company card' },
  { key: 'applyFilter', icon: '📊', label: 'Apply a filter' },
  { key: 'saveView', icon: '📌', label: 'Save a View' },
  { key: 'acceptConnection', icon: '🤝', label: 'Accept a connection' },
  { key: 'inviteFriend', icon: '👋', label: 'Invite a friend' },
  { key: 'requestIntro', icon: '✉️', label: 'Request an intro' },
];

const TOTAL = STEPS.length;

interface Props {
  progress: ChecklistProgress;
  actions: ChecklistActions;
  isDismissed?: boolean;
}

export function OnboardingChecklist({ progress, actions, isDismissed }: Props) {
  const [dismissed, setDismissed] = useState(() => !!isDismissed || !!localStorage.getItem(DISMISSED_KEY));
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const done = useMemo(() => STEPS.filter(s => progress[s.key]), [progress]);
  const todo = useMemo(() => STEPS.filter(s => !progress[s.key]), [progress]);
  const count = done.length;
  const allDone = count === TOTAL;

  useEffect(() => {
    if (allDone && !dismissed) {
      setTimeout(() => setOpen(true), 600);
    }
  }, [allDone, dismissed]);

  useEffect(() => {
    if (isDismissed) setDismissed(true);
  }, [isDismissed]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setOpen(false);
    localStorage.setItem(DISMISSED_KEY, 'true');
    authApi.updateOnboarding({ checklistDismissed: true }).catch(() => {});
  }, []);

  const fire = useCallback((key: StepKey) => {
    actions[key]();
    setOpen(false);
  }, [actions]);

  if (dismissed) return null;

  return (
    <div className="ob-float">
      {open && (
        <>
          <div className="ob-float-backdrop" onClick={() => setOpen(false)} />
          <div className={`ob-float-panel ${allDone ? 'ob-float-panel--done' : ''}`}>
            <div className="ob-float-panel-header">
              <span className="ob-float-panel-title">
                {allDone ? '🎉 You\'re all set!' : '🚀 Get started'}
              </span>
              <div className="ob-float-panel-header-right">
                <span className={`ob-float-panel-progress ${allDone ? 'ob-float-panel-progress--done' : ''}`}>{count}/{TOTAL}</span>
                <button className="ob-float-panel-close" onClick={() => setOpen(false)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>

            <div className="ob-float-panel-bar-wrap">
              <div className={`ob-float-panel-bar ${allDone ? 'ob-float-panel-bar--done' : ''}`} style={{ width: `${(count / TOTAL) * 100}%` }} />
            </div>

            <div className="ob-float-panel-body">
              {todo.map(step => (
                <button key={step.key} className="ob-step" onClick={() => fire(step.key)}>
                  <span className="ob-step-ring" />
                  <span className="ob-step-icon">{step.icon}</span>
                  <span className="ob-step-label">{step.label}</span>
                  <svg className="ob-step-go" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 18 6-6-6-6" /></svg>
                </button>
              ))}

              {done.length > 0 && (
                <button className="ob-done-row" onClick={() => setShowDone(!showDone)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <span>{done.length} completed</span>
                  <svg className={`ob-done-chevron ${showDone ? 'ob-done-chevron--open' : ''}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              )}

              {showDone && done.map(step => (
                <div key={step.key} className="ob-step ob-step--done">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34c759" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  <span className="ob-step-icon">{step.icon}</span>
                  <span className="ob-step-label ob-step-label--done">{step.label}</span>
                </div>
              ))}
            </div>

            {allDone && (
              <div className="ob-float-panel-footer">
                <button className="ob-float-dismiss-btn" onClick={handleDismiss}>Done — hide checklist</button>
              </div>
            )}
          </div>
        </>
      )}

      <button
        className={`ob-float-trigger ${allDone ? 'ob-float-trigger--done' : ''} ${open ? 'ob-float-trigger--open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Onboarding progress"
      >
        <span className="ob-float-trigger-text">Onboarding {count}/{TOTAL}</span>
        <span className="ob-float-trigger-bar">
          <span className="ob-float-trigger-bar-fill" style={{ width: `${(count / TOTAL) * 100}%` }} />
        </span>
      </button>
    </div>
  );
}

export function resetChecklist() {
  localStorage.removeItem(DISMISSED_KEY);
  ['introo_explored_company', 'introo_enriched_contacts', 'introo_applied_filter'].forEach(
    k => localStorage.removeItem(k)
  );
  authApi.updateOnboarding({ checklistDismissed: false }).catch(() => {});
}
