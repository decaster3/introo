import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { syncCalendarForUser, getCalendarSyncStatus, syncCalendarAccount, getCalendarAccounts } from '../services/calendar.js';
import { runEnrichmentForUser } from './enrichment.js';
import prisma from '../lib/prisma.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get all connected calendar accounts
router.get('/accounts', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const accounts = await getCalendarAccounts(userId);
    res.json(accounts);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Get calendar accounts error:', error);
    res.status(500).json({
      error: 'Failed to get calendar accounts',
      message: errorMessage,
    });
  }
});

// Delete a calendar account
router.delete('/accounts/:accountId', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { accountId } = req.params;
    
    // Verify ownership
    const account = await prisma.calendarAccount.findFirst({
      where: { id: accountId, userId },
    });
    
    if (!account) {
      res.status(404).json({ error: 'Calendar account not found' });
      return;
    }
    
    await prisma.calendarAccount.delete({
      where: { id: accountId },
    });
    
    res.json({ success: true });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Delete calendar account error:', error);
    res.status(500).json({
      error: 'Failed to delete calendar account',
      message: errorMessage,
    });
  }
});

// Sync a specific calendar account
router.post('/accounts/:accountId/sync', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const { accountId } = req.params;
    
    console.log('Starting calendar sync for account:', accountId);
    const result = await syncCalendarAccount(userId, accountId);
    console.log('Calendar sync completed:', result);

    runEnrichmentForUser(userId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: number })?.code;
    console.error('Calendar sync error:', errorMessage);
    
    const isAuthError = errorMessage.includes('invalid_grant') || 
                        errorMessage.includes('Token has been expired') ||
                        errorMessage.includes('Request had insufficient authentication scopes') ||
                        errorCode === 401 ||
                        errorCode === 403;
    
    if (isAuthError) {
      res.status(401).json({
        error: 'Calendar access expired',
        message: 'Please reconnect this calendar account',
        needsReauth: true,
      });
      return;
    }
    
    res.status(500).json({
      error: 'Failed to sync calendar',
      message: errorMessage,
    });
  }
});

// Trigger calendar sync (syncs all accounts + legacy primary)
router.post('/sync', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    console.log('Starting calendar sync for user:', userId);
    const result = await syncCalendarForUser(userId);
    console.log('Calendar sync completed:', result);

    runEnrichmentForUser(userId);

    res.json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorCode = (error as { code?: number })?.code;
    console.error('Calendar sync error:', errorMessage);
    console.error('Full error:', error);
    
    // Check for specific Google API errors
    const isAuthError = errorMessage.includes('invalid_grant') || 
                        errorMessage.includes('Token has been expired') ||
                        errorMessage.includes('Request had insufficient authentication scopes') ||
                        errorCode === 401 ||
                        errorCode === 403;
    
    if (isAuthError) {
      res.status(401).json({
        error: 'Calendar access expired',
        message: 'Please sign out and sign in again to grant calendar access',
        needsReauth: true,
      });
      return;
    }
    
    res.status(500).json({
      error: 'Failed to sync calendar',
      message: errorMessage,
    });
  }
});

// Get sync status
router.get('/status', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    const status = await getCalendarSyncStatus(userId);
    res.json(status);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calendar status error:', error);
    res.status(500).json({
      error: 'Failed to get calendar status',
      message: errorMessage,
    });
  }
});

export default router;
