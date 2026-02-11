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
