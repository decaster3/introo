import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
type ZodSchema = z.ZodTypeAny;
export declare function validate(schema: ZodSchema): (req: Request, res: Response, next: NextFunction) => void;
export declare const schemas: {
    createRequest: z.ZodObject<{
        rawText: z.ZodString;
        normalizedQuery: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        bidAmount: z.ZodOptional<z.ZodNumber>;
        currency: z.ZodOptional<z.ZodString>;
        spaceId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    updateRequestStatus: z.ZodObject<{
        status: z.ZodEnum<{
            open: "open";
            accepted: "accepted";
            completed: "completed";
        }>;
    }, z.core.$strip>;
    createOffer: z.ZodObject<{
        requestId: z.ZodString;
        message: z.ZodOptional<z.ZodString>;
        connectionStrength: z.ZodOptional<z.ZodEnum<{
            direct: "direct";
            indirect: "indirect";
            weak: "weak";
        }>>;
    }, z.core.$strip>;
    updateOfferStatus: z.ZodObject<{
        status: z.ZodEnum<{
            accepted: "accepted";
            completed: "completed";
            pending: "pending";
            rejected: "rejected";
        }>;
    }, z.core.$strip>;
    createSpace: z.ZodObject<{
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        emoji: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    updateSpace: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        emoji: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    createSignal: z.ZodObject<{
        name: z.ZodString;
        type: z.ZodOptional<z.ZodEnum<{
            custom: "custom";
            role_change: "role_change";
            company_growth: "company_growth";
            news: "news";
            hiring: "hiring";
        }>>;
        config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        entityType: z.ZodOptional<z.ZodEnum<{
            company: "company";
            contact: "contact";
            person: "person";
        }>>;
    }, z.core.$strip>;
    updateSignal: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        isActive: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    idParam: z.ZodObject<{
        id: z.ZodString;
    }, z.core.$strip>;
};
export declare function validateParams(schema: ZodSchema): (req: Request, res: Response, next: NextFunction) => void;
export {};
//# sourceMappingURL=validation.d.ts.map