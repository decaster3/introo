import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

type ZodSchema = z.ZodTypeAny;

// Validation middleware factory
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          error: 'Validation failed', 
          details: error.issues.map((e: z.ZodIssue) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
        return;
      }
      next(error);
    }
  };
}

// Common schemas
export const schemas = {
  // Request schemas
  createRequest: z.object({
    rawText: z.string().min(1, 'Request text is required').max(5000, 'Request text too long'),
    normalizedQuery: z.record(z.string(), z.unknown()).optional(),
    bidAmount: z.number().nonnegative().optional(),
    currency: z.string().max(10).optional(),
    spaceId: z.string().optional(),
    connectionPeerId: z.string().optional(),
  }),

  updateRequestStatus: z.object({
    status: z.enum(['open', 'accepted', 'completed']),
  }),

  // Offer schemas
  createOffer: z.object({
    requestId: z.string().min(1, 'Request ID is required'),
    message: z.string().max(2000, 'Message too long').optional(),
    connectionStrength: z.enum(['direct', 'indirect', 'weak']).optional(),
  }),

  updateOfferStatus: z.object({
    status: z.enum(['pending', 'accepted', 'rejected', 'completed']),
  }),

  // Space schemas
  createSpace: z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    description: z.string().max(1000, 'Description too long').optional(),
    emoji: z.string().max(10).optional(),
  }),

  updateSpace: z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    emoji: z.string().max(10).optional(),
  }),

  // Signal schemas
  createSignal: z.object({
    name: z.string().min(1, 'Signal name is required').max(100, 'Name too long'),
    type: z.enum(['role_change', 'company_growth', 'news', 'hiring', 'custom']).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    entityType: z.enum(['contact', 'company', 'person']).optional(),
  }),

  updateSignal: z.object({
    name: z.string().min(1).max(100).optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    isActive: z.boolean().optional(),
  }),

  // ID parameter validation
  idParam: z.object({
    id: z.string().min(1, 'Invalid ID format'),
  }),
};

// Helper to validate params
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      schema.parse(req.params);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ 
          error: 'Invalid parameters', 
          details: error.issues.map((e: z.ZodIssue) => ({
            field: e.path.join('.'),
            message: e.message
          }))
        });
        return;
      }
      next(error);
    }
  };
}
