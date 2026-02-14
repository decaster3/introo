import { useState, useEffect, useCallback } from 'react';
import { enrichmentApi } from '../lib/api';

export function useEnrichment(refreshData: () => Promise<void>, storeLoading: boolean) {
  const [enriching, setEnriching] = useState(false);
  const [autoEnrichTriggered, setAutoEnrichTriggered] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{
    contacts: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    companies: { total: number; enriched: number; skipped: number; errors: number; done: boolean } | null;
    contactsFree?: { total: number; enriched: number; skipped: number; errors: number; done: boolean; error?: string | null } | null;
  }>({ contacts: null, companies: null, contactsFree: null });
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [enrichStats, setEnrichStats] = useState<{
    contacts: { total: number; enriched: number; notFound?: number };
    companies: { total: number; enriched: number };
    lastEnrichedAt?: string | null;
  } | null>(null);

  // Check if enrichment is running on the server
  const checkEnrichmentRunning = useCallback(() => {
    enrichmentApi.getProgress()
      .then(progress => {
        if (progress.contactsFree && !progress.contactsFree.done) {
          setEnriching(true);
          setEnrichProgress(progress);
        } else if (progress.contactsFree && progress.contactsFree.done) {
          enrichmentApi.getStatus().then(setEnrichStats).catch(() => {});
          refreshData();
        }
      })
      .catch(() => {});
  }, [refreshData]);

  // Fetch enrichment stats on mount + check if enrichment is already running
  useEffect(() => {
    enrichmentApi.getStatus()
      .then(setEnrichStats)
      .catch(() => {});
    checkEnrichmentRunning();
  }, [checkEnrichmentRunning]);

  // Re-check after store finishes loading
  useEffect(() => {
    if (!storeLoading && !enriching) {
      const timer = setTimeout(checkEnrichmentRunning, 2000);
      return () => clearTimeout(timer);
    }
  }, [storeLoading, enriching, checkEnrichmentRunning]);

  // Poll progress when enrichment is running
  useEffect(() => {
    if (!enriching) return;
    let pollCount = 0;
    const interval = setInterval(() => {
      pollCount++;
      enrichmentApi.getProgress()
        .then(progress => {
          setEnrichProgress(progress);

          if (!progress.contactsFree) {
            if (pollCount > 5) {
              setEnriching(false);
              setEnrichError('Enrichment process was lost. Please try again.');
              enrichmentApi.getStatus().then(setEnrichStats).catch(() => {});
              refreshData();
            }
            return;
          }

          if ((progress.contactsFree as any)?.error) {
            setEnrichError((progress.contactsFree as any).error);
          }

          const contactsDone = !progress.contacts || progress.contacts.done;
          const companiesDone = !progress.companies || progress.companies.done;
          const contactsFreeDone = progress.contactsFree.done;
          if (contactsDone && companiesDone && contactsFreeDone) {
            setEnriching(false);
            enrichmentApi.getStatus().then(setEnrichStats).catch(() => {});
            refreshData();
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(interval);
  }, [enriching, refreshData]);

  // Start FREE enrichment
  const startEnrichment = useCallback(async () => {
    if (enriching) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichProgress({ contacts: null, companies: null, contactsFree: null });
    try {
      await enrichmentApi.enrichContactsFree({ force: true });
    } catch (err) {
      console.error('Failed to start free enrichment:', err);
      setEnriching(false);
      setEnrichError('Failed to start enrichment. Please try again.');
    }
  }, [enriching]);

  // Auto-enrich once per week
  useEffect(() => {
    if (autoEnrichTriggered || enriching) return;
    if (!enrichStats) return;
    setAutoEnrichTriggered(true);

    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const lastRun = localStorage.getItem('pods_last_enrich');
    const lastRunTime = lastRun ? parseInt(lastRun, 10) : 0;
    const elapsed = Date.now() - lastRunTime;

    if (elapsed >= WEEK_MS && enrichStats.contacts.enriched < enrichStats.contacts.total) {
      localStorage.setItem('pods_last_enrich', String(Date.now()));
      startEnrichment();
    }
  }, [enrichStats, autoEnrichTriggered, enriching, startEnrichment]);

  return { enriching, enrichProgress, enrichError, enrichStats, startEnrichment };
}
