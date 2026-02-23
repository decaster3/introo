import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/api';
import type { DirectConnection, ConnectionCompany } from '../types';

export interface PendingInvite {
  id: string;
  email: string;
  status: string;
  createdAt: string;
}

export function useConnectionManagement(refreshNotifications: () => void) {
  const [connections, setConnections] = useState<DirectConnection[]>([]);
  const [connectionCompanies, setConnectionCompanies] = useState<ConnectionCompany[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [connectEmail, setConnectEmail] = useState('');

  const fetchConnectionsList = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connections`, { credentials: 'include' });
      const data = await res.json();
      if (Array.isArray(data)) setConnections(data);
    } catch (e) { console.error('Failed to fetch connections:', e); }
  }, []);

  const fetchInvites = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/connections/invites`, { credentials: 'include' });
      const data = await res.json();
      if (Array.isArray(data)) setPendingInvites(data);
    } catch (e) { console.error('Failed to fetch invites:', e); }
  }, []);

  useEffect(() => {
    fetchConnectionsList();
    fetchInvites();
  }, [fetchConnectionsList, fetchInvites]);

  // Fetch reach for accepted connections
  useEffect(() => {
    const accepted = connections.filter(c => c.status === 'accepted');
    if (accepted.length === 0) { setConnectionCompanies([]); return; }

    Promise.all(
      accepted.map(c =>
        fetch(`${API_BASE}/api/connections/${c.id}/reach`, { credentials: 'include' })
          .then(r => r.ok ? r.json() : { companies: [] }).catch(() => ({ companies: [] }))
          .then(r => ({ connectionId: c.id, companies: (r.companies || []) as ConnectionCompany[] }))
      )
    ).then(results => {
      const map = new Map<string, ConnectionCompany>();
      results.forEach(({ connectionId, companies }) => {
        companies.forEach(c => {
          c.connectionId = connectionId;
          c.contacts.forEach(ct => { ct.connectionId = connectionId; });
          if (!map.has(c.domain)) {
            map.set(c.domain, c);
          } else {
            const ex = map.get(c.domain)!;
            const ids = new Set(ex.contacts.map(x => x.id));
            c.contacts.forEach(x => { if (!ids.has(x.id)) { ex.contacts.push(x); ex.contactCount++; } });
          }
        });
      });
      setConnectionCompanies(Array.from(map.values()));
    });
  }, [connections]);

  const sendConnectionRequest = useCallback(async (email: string) => {
    if (!email.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to send connection request');
        return;
      }
      setConnectEmail('');
      fetchConnectionsList();
      fetchInvites();
      refreshNotifications();
    } catch (e) { console.error('Failed to send connection:', e); }
  }, [fetchConnectionsList, fetchInvites, refreshNotifications]);

  const acceptConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}/accept`, { method: 'POST', credentials: 'include' });
      fetchConnectionsList();
      refreshNotifications();
    } catch (e) { console.error('Failed to accept connection:', e); }
  }, [fetchConnectionsList, refreshNotifications]);

  const rejectConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}/reject`, { method: 'POST', credentials: 'include' });
      fetchConnectionsList();
      refreshNotifications();
    } catch (e) { console.error('Failed to reject connection:', e); }
  }, [fetchConnectionsList, refreshNotifications]);

  const removeConnection = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/${id}`, { method: 'DELETE', credentials: 'include' });
      fetchConnectionsList();
    } catch (e) { console.error('Failed to remove connection:', e); }
  }, [fetchConnectionsList]);

  const cancelInvite = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/connections/invites/${id}`, { method: 'DELETE', credentials: 'include' });
      fetchInvites();
    } catch (e) { console.error('Failed to cancel invite:', e); }
  }, [fetchInvites]);

  return {
    connections, connectionCompanies, pendingInvites,
    connectEmail, setConnectEmail,
    fetchConnectionsList,
    sendConnectionRequest, acceptConnection, rejectConnection, removeConnection,
    cancelInvite,
  };
}
