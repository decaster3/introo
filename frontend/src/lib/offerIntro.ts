/**
 * Opens an email client with a pre-filled intro offer email
 */
export interface OfferIntroParams {
  requesterEmail: string;
  requesterName: string;
  targetCompany: string;
  contactName?: string;
  senderName?: string;
}

export function openOfferIntroEmail({
  requesterEmail,
  requesterName,
  targetCompany,
  contactName,
  senderName = 'Me',
}: OfferIntroParams): void {
  const subject = encodeURIComponent(`I can intro you to someone at ${targetCompany}`);
  
  let body = `Hi ${requesterName},\n\n`;
  if (contactName) {
    body += `I saw your request for an intro to someone at ${targetCompany}. I know ${contactName} there and would be happy to make an introduction.\n\n`;
  } else {
    body += `I saw your request for an intro to someone at ${targetCompany}. I have a contact there and would be happy to make an introduction.\n\n`;
  }
  body += `Let me know if you'd like me to proceed!\n\nBest,\n${senderName}`;
  
  const mailtoUrl = `mailto:${requesterEmail}?subject=${subject}&body=${encodeURIComponent(body)}`;
  window.open(mailtoUrl, '_blank');
}

/**
 * Opens an email client with a double-intro email — introducing the requester
 * to a contact at the target company. Both are on the To line.
 */
export interface DoubleIntroParams {
  requesterEmail: string;
  requesterName: string;
  contactEmail: string;
  contactName: string;
  targetCompany: string;
  senderName?: string;
}

export function openDoubleIntroEmail({
  requesterEmail,
  requesterName,
  contactEmail,
  contactName,
  targetCompany,
  senderName = 'Me',
}: DoubleIntroParams): void {
  const subject = encodeURIComponent(`Introduction: ${requesterName} <> ${contactName} (${targetCompany})`);

  let body = `Hi ${contactName} and ${requesterName},\n\n`;
  body += `I'd like to introduce you to each other.\n\n`;
  body += `${contactName} — ${requesterName} is interested in connecting with someone at ${targetCompany}.\n\n`;
  body += `${requesterName} — ${contactName} is at ${targetCompany} and I thought you two should meet.\n\n`;
  body += `I'll let you both take it from here!\n\nBest,\n${senderName}`;

  const mailtoUrl = `mailto:${contactEmail},${requesterEmail}?subject=${subject}&body=${encodeURIComponent(body)}`;
  window.open(mailtoUrl, '_blank');
}
