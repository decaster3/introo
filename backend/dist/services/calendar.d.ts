export declare function syncCalendarForUser(userId: string): Promise<{
    contactsFound: number;
    companiesFound: number;
    relationshipsCreated: number;
}>;
export declare function getCalendarSyncStatus(userId: string): Promise<{
    isConnected: boolean;
    lastSyncedAt: Date | null | undefined;
}>;
//# sourceMappingURL=calendar.d.ts.map