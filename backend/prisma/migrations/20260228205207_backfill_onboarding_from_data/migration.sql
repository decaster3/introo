-- Smart backfill: mark tour complete for users who have contacts (active users)
UPDATE users u
SET "onboardingCompletedAt" = u."createdAt"
WHERE u."onboardingCompletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c."userId" = u.id);

-- Smart backfill: dismiss checklist only for users who completed ALL verifiable steps:
--   1. calendar connected
--   2. has enriched contacts
--   3. opened a company card (company_view_history)
--   4. saved a view (implies they also applied filters)
--   5. has accepted connection (sent or received)
--   6. invited someone (sent connection or pending invite)
--   7. requested an intro
UPDATE users u
SET "onboardingChecklistDismissedAt" = u."createdAt"
WHERE u."onboardingChecklistDismissedAt" IS NULL
  AND u."calendarConnectedAt" IS NOT NULL
  AND EXISTS (SELECT 1 FROM contacts c WHERE c."userId" = u.id AND c."enrichedAt" IS NOT NULL)
  AND EXISTS (SELECT 1 FROM company_view_history cv WHERE cv."userId" = u.id)
  AND EXISTS (SELECT 1 FROM saved_views sv WHERE sv."userId" = u.id)
  AND (
    EXISTS (SELECT 1 FROM direct_connections dc WHERE (dc."fromUserId" = u.id OR dc."toUserId" = u.id) AND dc.status = 'accepted')
  )
  AND (
    EXISTS (SELECT 1 FROM direct_connections dc WHERE dc."fromUserId" = u.id)
    OR EXISTS (SELECT 1 FROM pending_invites pi WHERE pi."fromUserId" = u.id)
  )
  AND EXISTS (SELECT 1 FROM intro_requests ir WHERE ir."requesterId" = u.id);
