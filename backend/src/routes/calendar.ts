import { Router } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { syncCalendarForUser, getCalendarSyncStatus } from '../services/calendar.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Trigger calendar sync
router.post('/sync', async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).user!.id;
    console.log('Starting calendar sync for user:', userId);
    const result = await syncCalendarForUser(userId);
    console.log('Calendar sync completed:', result);
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
