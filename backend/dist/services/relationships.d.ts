export interface MatchResult {
    userId: string;
    userName: string;
    userAvatar: string | null;
    companyId: string;
    companyName: string;
    companyDomain: string;
    companyLogo: string | null;
    strengthScore: number;
    meetingsCount: number;
    lastSeenAt: Date;
}
export declare function findIntroducersForCompany(domain: string, excludeUserId?: string): Promise<MatchResult[]>;
export declare function findIntroducersForIndustry(industry: string, excludeUserId?: string): Promise<MatchResult[]>;
export declare function getCommunityStats(): Promise<{
    members: number;
    companies: number;
    contacts: number;
}>;
//# sourceMappingURL=relationships.d.ts.map