const formatUserName = (user) => {
  if (!user) return 'Requester';
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || user.id_number || 'Requester';
};

const formatAdminName = (admin) => admin?.full_name || admin?.username || 'Administrator';

export const buildOrSubmissionTimeline = (submissions, users, admins) => {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const adminsById = new Map(admins.map((admin) => [admin.id, admin]));

  return submissions.flatMap((entry) => ([
    {
      type: 'or_submitted',
      attempt_number: entry.attempt_number,
      or_number: entry.or_number,
      timestamp: entry.submitted_at,
      actor: formatUserName(usersById.get(entry.submitted_by)),
      administrator: null,
      decision: null,
      reason: null
    },
    entry.reviewed_at ? {
      type: entry.decision === 'confirmed' ? 'or_confirmed' : 'or_rejected',
      attempt_number: entry.attempt_number,
      or_number: entry.or_number,
      timestamp: entry.reviewed_at,
      actor: formatAdminName(adminsById.get(entry.reviewed_by)),
      administrator: formatAdminName(adminsById.get(entry.reviewed_by)),
      decision: entry.decision,
      reason: entry.rejection_reason || null
    } : null
  ].filter(Boolean)));
};