import prisma from '../lib/prisma.js';
export async function findIntroducersForCompany(domain, excludeUserId) {
    const company = await prisma.company.findUnique({
        where: { domain },
    });
    if (!company) {
        return [];
    }
    const relationships = await prisma.relationship.findMany({
        where: {
            companyId: company.id,
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        include: {
            user: {
                select: { id: true, name: true, avatar: true },
            },
            company: {
                select: { id: true, name: true, domain: true, logo: true },
            },
        },
        orderBy: { strengthScore: 'desc' },
    });
    return relationships.map((r) => ({
        userId: r.user.id,
        userName: r.user.name,
        userAvatar: r.user.avatar,
        companyId: r.company.id,
        companyName: r.company.name,
        companyDomain: r.company.domain,
        companyLogo: r.company.logo,
        strengthScore: r.strengthScore || 0,
        meetingsCount: r.meetingsCount,
        lastSeenAt: r.lastSeenAt,
    }));
}
export async function findIntroducersForIndustry(industry, excludeUserId) {
    const relationships = await prisma.relationship.findMany({
        where: {
            company: { industry },
            ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
        },
        include: {
            user: {
                select: { id: true, name: true, avatar: true },
            },
            company: {
                select: { id: true, name: true, domain: true, logo: true },
            },
        },
        orderBy: { strengthScore: 'desc' },
        take: 20,
    });
    return relationships.map((r) => ({
        userId: r.user.id,
        userName: r.user.name,
        userAvatar: r.user.avatar,
        companyId: r.company.id,
        companyName: r.company.name,
        companyDomain: r.company.domain,
        companyLogo: r.company.logo,
        strengthScore: r.strengthScore || 0,
        meetingsCount: r.meetingsCount,
        lastSeenAt: r.lastSeenAt,
    }));
}
export async function getCommunityStats() {
    const [usersCount, companiesCount, contactsCount] = await Promise.all([
        prisma.user.count(),
        prisma.company.count(),
        prisma.contact.count(),
    ]);
    return {
        members: usersCount,
        companies: companiesCount,
        contacts: contactsCount,
    };
}
//# sourceMappingURL=relationships.js.map