import prisma from './prisma.js';
import { sendNotificationEmail } from '../services/email.js';

interface NotifyConnectorsParams {
  requestId: string;
  spaceId: string;
  requesterId: string;
  requesterName: string;
  rawText: string;
  companyId?: string | null;
  companyDomain?: string | null;
  companyName: string;
  spaceName: string;
  spaceEmoji?: string | null;
}

/**
 * Finds space members who have approved contacts at the target company
 * and sends them intro_request notifications.
 */
export async function notifyConnectors(params: NotifyConnectorsParams): Promise<Set<string>> {
  const { requestId, spaceId, requesterId, requesterName, rawText, companyId, companyDomain, companyName, spaceName, spaceEmoji } = params;

  const spaceMembers = await prisma.spaceMember.findMany({
    where: { spaceId, status: 'approved', userId: { not: requesterId } },
    select: { userId: true },
  });
  const memberUserIds = spaceMembers.map(m => m.userId);
  if (memberUserIds.length === 0) return new Set();

  const connectorIds = new Set<string>();

  let resolvedCompanyId = companyId;
  if (!resolvedCompanyId && companyDomain) {
    const company = await prisma.company.findUnique({ where: { domain: companyDomain }, select: { id: true } });
    resolvedCompanyId = company?.id;
  }

  if (resolvedCompanyId) {
    const contacts = await prisma.contact.findMany({
      where: { userId: { in: memberUserIds }, companyId: resolvedCompanyId, isApproved: true },
      select: { userId: true },
    });
    contacts.forEach(c => connectorIds.add(c.userId));
  }

  if (connectorIds.size === 0) return connectorIds;

  const introNotif = {
    type: 'intro_request',
    title: `Intro request: ${companyName}`,
    body: `${requesterName} is looking for an intro to ${companyName}. "${rawText}"`,
  };

  await prisma.notification.createMany({
    data: Array.from(connectorIds).map(connectorUserId => ({
      userId: connectorUserId,
      ...introNotif,
      data: {
        requestId,
        spaceId,
        spaceName,
        spaceEmoji: spaceEmoji || null,
        companyName,
        companyDomain: companyDomain || null,
        companyId: companyId || null,
        requesterId,
        requesterName,
        rawText,
      },
    })),
  });

  for (const connectorUserId of connectorIds) {
    sendNotificationEmail(connectorUserId, introNotif).catch(() => {});
  }

  return connectorIds;
}
