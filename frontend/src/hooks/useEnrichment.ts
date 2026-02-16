import { useState, useEffect, useCallback } from 'react';
import { enrichmentApi, type EnrichmentProgress } from '../lib/api';

interface EnrichStats {
  contacts: { total: number; enriched: number; identified?: number; notFound?: number; pending?: number };
  companies: { total: number; enriched: number };
  lastEnrichedAt?: string | null;
}

const POLL_INTERVAL_MS = 2000;
const DETECTION_ATTEMPTS = 5;

export function useEnrichment(refreshData: () => Promise<void>, storeLoading: boolean) {
  const [enriching, setEnriching] = useState(false);
  const [autoEnrichTriggered, setAutoEnrichTriggered] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{
    contacts: EnrichmentProgress | null;
    companies: EnrichmentProgress | null;
    contactsFree?: EnrichmentProgress | null;
  }>({ contacts: null, companies: null, contactsFree: null });
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichStats, setEnrichStats] = useState<EnrichStats | null>(null);
  const refreshStats = useCallback(() => {
    enrichmentApi.getStatus().then(setEnrichStats).catch(() => {});
  }, []);

  // Check if enrichment is running on the server
  const checkEnrichmentRunning = useCallback(() => {
    return enrichmentApi.getProgress()
      .then(progress => {
        if (progress.contactsFree && !progress.contactsFree.done) {
          setEnriching(true);
          setEnrichProgress(progress);
          return true;
        }
        if (progress.contactsFree?.done) {
          refreshStats();
          refreshData();
        }
        return false;
      })
      .catch(() => false);
  }, [refreshData, refreshStats]);

  // Fetch stats on mount + check if enrichment is already running
  useEffect(() => {
    refreshStats();
    checkEnrichmentRunning();
  }, [checkEnrichmentRunning, refreshStats]);

  // After store loads, poll briefly to detect enrichment that may have just started.
  // Also refreshes stats each attempt so auto-enrich can react once contacts exist.
  useEffect(() => {
    if (storeLoading || enriching) return;
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      refreshStats();
      const isRunning = await checkEnrichmentRunning();
      if (isRunning || attempts >= DETECTION_ATTEMPTS) {
        clearInterval(interval);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [storeLoading, enriching, checkEnrichmentRunning, refreshStats]);

  // Poll progress while enrichment is running
  useEffect(() => {
    if (!enriching) return;
    let pollCount = 0;
    const interval = setInterval(() => {
      pollCount++;
      enrichmentApi.getProgress()
        .then(progress => {
          setEnrichProgress(progress);

          if (!progress.contactsFree) {
            if (pollCount > DETECTION_ATTEMPTS) {
              setEnriching(false);
              setEnrichError('Enrichment process was lost. Please try again.');
              refreshStats();
              refreshData();
            }
            return;
          }

          if (progress.contactsFree.error) {
            setEnrichError(progress.contactsFree.error);
          }

          if (progress.contactsFree.done) {
            setEnriching(false);
            refreshStats();
            refreshData();
          }
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [enriching, refreshData, refreshStats]);

  // Start enrichment — only processes never-attempted contacts
  const startEnrichment = useCallback(async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichProgress({ contacts: null, companies: null, contactsFree: null });
    try {
      await enrichmentApi.enrichContactsFree();
    } catch (err) {
      console.error('Failed to start enrichment:', err);
      setEnriching(false);
      setEnrichError('Failed to start enrichment. Please try again.');
    }
  }, [enriching]);

  // Auto-enrich ONLY on genuine first signup (never enriched before, no localStorage stamp).
  // Returning users and page reloads won't re-trigger because pods_last_enrich is set.
  useEffect(() => {
    if (autoEnrichTriggered || enriching || storeLoading || !enrichStats) return;

    // Don't decide yet if contacts haven't loaded (calendar sync still in progress).
    // The effect will re-fire once enrichStats updates with real contact counts.
    if (enrichStats.contacts.total === 0) return;

    setAutoEnrichTriggered(true);

    const pendingCount = enrichStats.contacts.pending ?? 0;
    const hasRunBefore = localStorage.getItem('pods_last_enrich');

    // First-ever signup: no enrichment history at all
    if (pendingCount > 0 && enrichStats.contacts.enriched === 0 && !hasRunBefore) {
      localStorage.setItem('pods_last_enrich', String(Date.now()));
      console.log('[enrichment] First signup: auto-starting enrichment');
      startEnrichment();
    }
  }, [enrichStats, autoEnrichTriggered, enriching, storeLoading, startEnrichment]);

  // Stop enrichment
  const stopEnrichment = useCallback(async () => {
    if (!enriching) return;
    try {
      await enrichmentApi.stopEnrichment();
      setEnriching(false);
      setEnrichError(null);
      refreshStats();
      refreshData();
    } catch (err) {
      console.error('Failed to stop enrichment:', err);
    }
  }, [enriching, refreshData, refreshStats]);

  return { enriching, enrichProgress, enrichError, enrichStats, startEnrichment, stopEnrichment };
}
