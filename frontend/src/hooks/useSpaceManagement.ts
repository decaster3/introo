import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/api';
import type { Space, PendingSpace, PendingMember } from '../types';

export function useSpaceManagement(
  currentUserId: string | undefined,
  refreshNotifications: () => void,
) {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [pendingSpaces, setPendingSpaces] = useState<PendingSpace[]>([]);
  const [pendingMembers, setPendingMembers] = useState<Record<string, PendingMember[]>>({});
  const [loading, setLoading] = useState(true);
  const [showCreateSpace, setShowCreateSpace] = useState(false);
  const [showJoinSpace, setShowJoinSpace] = useState(false);
  const [newSpaceName, setNewSpaceName] = useState('');
  const [newSpaceEmoji, setNewSpaceEmoji] = useState('🫛');
  const [joinCode, setJoinCode] = useState('');
  const [joinStatus, setJoinStatus] = useState<{ type: 'success' | 'error' | 'pending'; message: string } | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const fetchSpacesList = useCallback(async () => {
    try {
      const [spacesRes, pendingRes] = await Promise.all([
        fetch(`${API_BASE}/api/spaces`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/spaces/my-pending`, { credentials: 'include' }),
      ]);
      const data = await spacesRes.json();
      const pendingData = await pendingRes.json().catch(() => []);
      if (Array.isArray(data)) {
        const spacesList = data.map((s: any) => ({
          id: s.id, name: s.name, emoji: s.emoji,
          memberCount: s.members?.length || 0,
          openRequestCount: s._count?.requests || 0,
          description: s.description,
          inviteCode: s.inviteCode,
          ownerId: s.ownerId,
          members: s.members,
        }));
        setSpaces(spacesList);

        const ownedSpaces = spacesList.filter((s: Space) => s.ownerId === currentUserId);
        if (ownedSpaces.length > 0) {
          const pendingResults = await Promise.all(
            ownedSpaces.map((s: Space) =>
              fetch(`${API_BASE}/api/spaces/${s.id}/pending`, { credentials: 'include' })
                .then(r => r.ok ? r.json() : [])
                .then(members => ({ spaceId: s.id, members: members as PendingMember[] }))
                .catch(() => ({ spaceId: s.id, members: [] as PendingMember[] }))
            )
          );
          const pm: Record<string, PendingMember[]> = {};
          pendingResults.forEach(r => { if (r.members.length > 0) pm[r.spaceId] = r.members; });
          setPendingMembers(pm);
        } else {
          setPendingMembers({});
        }
      }
      if (Array.isArray(pendingData)) setPendingSpaces(pendingData);
    } catch (e) { console.error('Failed to fetch spaces:', e); }
  }, [currentUserId]);

  useEffect(() => {
    setLoading(true);
    fetchSpacesList().finally(() => setLoading(false));
  }, [fetchSpacesList]);

  // Refresh spaces & pending members every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => { fetchSpacesList(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchSpacesList]);

  const createSpace = useCallback(async () => {
    if (!newSpaceName.trim()) return;
    try {
      await fetch(`${API_BASE}/api/spaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: newSpaceName, emoji: newSpaceEmoji }),
      });
      setNewSpaceName('');
      setNewSpaceEmoji('🫛');
      setShowCreateSpace(false);
      fetchSpacesList();
    } catch (e) { console.error('Failed to create space:', e); }
  }, [newSpaceName, newSpaceEmoji, fetchSpacesList]);

  const joinSpace = useCallback(async () => {
    if (!joinCode.trim()) return;
    setJoinStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/spaces/join/${joinCode.trim()}`, {
        method: 'POST', credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.pending) {
          setJoinStatus({ type: 'pending', message: 'Request sent! Waiting for owner approval.' });
        } else {
          setJoinStatus({ type: 'success', message: 'Joined successfully!' });
        }
        setJoinCode('');
        fetchSpacesList();
        setTimeout(() => { setJoinStatus(null); setShowJoinSpace(false); }, 2000);
      } else {
        setJoinStatus({ type: 'error', message: data.error || 'Failed to join space' });
      }
    } catch (e) {
      console.error('Failed to join space:', e);
      setJoinStatus({ type: 'error', message: 'Network error. Please try again.' });
    }
  }, [joinCode, fetchSpacesList]);

  const copyInviteCode = useCallback((code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }, []);

  const leaveSpace = useCallback(async (spaceId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/leave`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to leave space:', e); }
  }, [fetchSpacesList]);

  const inviteMemberToSpace = useCallback(async (spaceId: string, email: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to invite member:', e); }
  }, [fetchSpacesList]);

  const approveSpaceMember = useCallback(async (spaceId: string, memberId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members/${memberId}/approve`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to approve member:', e); }
  }, [fetchSpacesList]);

  const rejectSpaceMember = useCallback(async (spaceId: string, memberId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members/${memberId}/reject`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to reject member:', e); }
  }, [fetchSpacesList]);

  const acceptSpaceInvite = useCallback(async (spaceId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/accept-invite`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
      refreshNotifications();
    } catch (e) { console.error('Failed to accept space invite:', e); }
  }, [fetchSpacesList, refreshNotifications]);

  const removeSpaceMember = useCallback(async (spaceId: string, memberId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/members/${memberId}`, {
        method: 'DELETE', credentials: 'include',
      });
      fetchSpacesList();
    } catch (e) { console.error('Failed to remove member:', e); }
  }, [fetchSpacesList]);

  const rejectSpaceInvite = useCallback(async (spaceId: string) => {
    try {
      await fetch(`${API_BASE}/api/spaces/${spaceId}/reject-invite`, {
        method: 'POST', credentials: 'include',
      });
      fetchSpacesList();
      refreshNotifications();
    } catch (e) { console.error('Failed to reject space invite:', e); }
  }, [fetchSpacesList, refreshNotifications]);

  return {
    spaces, pendingSpaces, pendingMembers, loading,
    showCreateSpace, setShowCreateSpace,
    showJoinSpace, setShowJoinSpace,
    newSpaceName, setNewSpaceName,
    newSpaceEmoji, setNewSpaceEmoji,
    joinCode, setJoinCode,
    joinStatus, setJoinStatus, copiedCode,
    fetchSpacesList,
    createSpace, joinSpace, copyInviteCode,
    leaveSpace, inviteMemberToSpace,
    approveSpaceMember, rejectSpaceMember,
    acceptSpaceInvite, removeSpaceMember, rejectSpaceInvite,
  };
}
