import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppState, useAppDispatch } from '../store';
import { parseRequestText } from '../lib/nlp';
import { findMatches, formatScore } from '../lib/matching';
import type { NormalizedQuery, MatchResult } from '../types';
import { API_BASE } from '../lib/api';

export function NewRequestPage() {
  const { currentUserId, relationships, users, companies } = useAppState();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const initialText = searchParams.get('text') || '';
  const spaceId = searchParams.get('spaceId') || '';

  const [rawText, setRawText] = useState(initialText);
  const [bidAmount, setBidAmount] = useState(100);
  const [currency, setCurrency] = useState('USD');
  const [normalizedQuery, setNormalizedQuery] = useState<NormalizedQuery | null>(null);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [step, setStep] = useState<'compose' | 'preview'>('compose');
  const [, setIsSubmitting] = useState(false);

  const handleAnalyze = () => {
    const query = parseRequestText(rawText);
    setNormalizedQuery(query);

    const matchResults = findMatches({
      query,
      relationships,
      companies,
      users,
      excludeUserId: currentUserId,
    });
    setMatches(matchResults);
    setStep('preview');
  };

  const handleSubmit = async () => {
    if (!normalizedQuery) return;
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rawText,
          normalizedQuery,
          bidAmount,
          currency,
          spaceId: spaceId || undefined,
        }),
      });

      if (!response.ok) throw new Error('Failed to create request');
      
      const data = await response.json();
      
      // Also update local state
      dispatch({
        type: 'ADD_REQUEST',
        payload: {
          id: data.id,
          requesterId: currentUserId,
          rawText,
          normalizedQuery,
          bidAmount,
          currency,
          status: 'open',
          createdAt: new Date().toISOString(),
          spaceId: spaceId || undefined,
        },
      });

      // Navigate to the space page if this was a space request
      if (spaceId) {
        navigate(`/spaces/${spaceId}`);
      } else {
        navigate(`/request/${data.id}`);
      }
    } catch (error) {
      console.error('Error creating request:', error);
      alert('Failed to create request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="new-request-page">
      <header className="page-header">
        <h1>Create Intro Request</h1>
        <p className="subtitle">Describe who you want to meet and we'll find the best introducers.</p>
      </header>

      {step === 'compose' && (
        <div className="compose-form">
          <div className="form-group">
            <label htmlFor="rawText">Who do you want to meet?</label>
            <textarea
              id="rawText"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="e.g., Looking for an intro to someone at stripe.com, ideally in engineering or product. US-based fintech companies 1000+ employees work too."
              rows={5}
            />
            <p className="form-hint">
              Be specific! Mention company domains, industries (saas, fintech, healthcare, security), 
              company size, geography, and roles.
            </p>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="bidAmount">Bounty Amount</label>
              <input
                id="bidAmount"
                type="number"
                value={bidAmount}
                onChange={(e) => setBidAmount(Number(e.target.value))}
                min={0}
              />
            </div>
            <div className="form-group">
              <label htmlFor="currency">Currency</label>
              <select
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
          </div>

          <button
            className="btn-primary btn-large"
            onClick={handleAnalyze}
            disabled={!rawText.trim()}
          >
            Analyze & Find Matches
          </button>
        </div>
      )}

      {step === 'preview' && normalizedQuery && (
        <div className="preview-section">
          <div className="query-analysis">
            <h2>Parsed Query</h2>
            <div className="query-tags">
              {normalizedQuery.targetDomain && (
                <span className="query-tag domain">
                  <strong>Domain:</strong> {normalizedQuery.targetDomain}
                </span>
              )}
              {normalizedQuery.industry && (
                <span className="query-tag industry">
                  <strong>Industry:</strong> {normalizedQuery.industry}
                </span>
              )}
              {normalizedQuery.sizeBucket && (
                <span className="query-tag size">
                  <strong>Size:</strong> {normalizedQuery.sizeBucket}
                </span>
              )}
              {normalizedQuery.geo && (
                <span className="query-tag geo">
                  <strong>Geo:</strong> {normalizedQuery.geo}
                </span>
              )}
              {normalizedQuery.role && (
                <span className="query-tag role">
                  <strong>Role:</strong> {normalizedQuery.role}
                </span>
              )}
              {!normalizedQuery.targetDomain && !normalizedQuery.industry && !normalizedQuery.sizeBucket && !normalizedQuery.geo && !normalizedQuery.role && (
                <span className="query-tag empty">No specific criteria detected</span>
              )}
            </div>
          </div>

          <div className="matches-section">
            <h2>Top Matches ({matches.length})</h2>
            {matches.length === 0 ? (
              <p className="no-matches">No matches found. Try broadening your criteria.</p>
            ) : (
              <div className="matches-list">
                {matches.map((match, index) => (
                  <div key={`${match.userId}-${match.companyId}`} className="match-card">
                    <div className="match-rank">#{index + 1}</div>
                    <div className="match-info">
                      <div className="match-header">
                        <span className="introducer-name">{match.userName}</span>
                        <span className="match-arrow">→</span>
                        <span className="company-name">{match.companyName}</span>
                      </div>
                      <p className="match-explanation">{match.explanation}</p>
                    </div>
                    <div className="match-score">
                      <span className="score-value">{formatScore(match.finalScore)}</span>
                      <span className="score-label">score</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="preview-actions">
            <button className="btn-secondary" onClick={() => setStep('compose')}>
              ← Edit Request
            </button>
            <button className="btn-primary btn-large" onClick={handleSubmit}>
              Submit Request ({bidAmount} {currency})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
