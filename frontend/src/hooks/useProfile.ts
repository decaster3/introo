import { useState, useEffect, useCallback } from 'react';
import { authApi } from '../lib/api';
import { useAppDispatch } from '../store';
import type { User } from '../types';

export function useProfile(currentUser: User | null) {
  const dispatch = useAppDispatch();

  const [profileForm, setProfileForm] = useState({
    name: '', title: '', companyDomain: '', linkedinUrl: '', headline: '', city: '', country: '',
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setProfileForm({
        name: currentUser.name || '',
        title: currentUser.title || '',
        companyDomain: currentUser.companyDomain || '',
        linkedinUrl: currentUser.linkedinUrl || '',
        headline: currentUser.headline || '',
        city: currentUser.city || '',
        country: currentUser.country || '',
      });
      setProfileDirty(false);
    }
  }, [currentUser]);

  const updateProfileField = useCallback((field: string, value: string) => {
    setProfileForm(prev => ({ ...prev, [field]: value }));
    setProfileDirty(true);
  }, []);

  const saveProfile = useCallback(async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const { user } = await authApi.updateProfile(profileForm);
      dispatch({ type: 'SET_AUTH', payload: { isAuthenticated: true, user } });
      setProfileDirty(false);
    } catch (e) {
      console.error('Failed to save profile:', e);
    } finally {
      setProfileSaving(false);
    }
  }, [profileForm, profileSaving, dispatch]);

  return { profileForm, profileSaving, profileDirty, updateProfileField, saveProfile };
}
