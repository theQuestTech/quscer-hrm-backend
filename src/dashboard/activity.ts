// Turns audit log entries into short sentences for the HR dashboard's
// "Recent activity". Unknown event types fall back to a readable version
// of the event name, so a new event never breaks the list.

const PHRASES: Record<string, string> = {
  'employee.created': 'added a new employee',
  'employee.updated': 'updated an employee profile',
  'employee.self_updated': 'updated their own profile',
  'employee.login_granted': 'gave an employee login access',
  'employee.document_uploaded': 'uploaded a document',
  'attendance.marked': 'marked attendance',
  'attendance.correction_approved': 'approved a time correction',
  'attendance.correction_rejected': 'rejected a time correction',
  'leave.first_approved': 'gave a leave request its first approval',
  'leave.approved': 'approved a leave request',
  'leave.rejected': 'rejected a leave request',
  'leave.cancelled': 'cancelled a leave request',
  'leave.allocation_set': 'changed a leave balance',
  'payroll.submitted': 'sent payroll for approval',
  'payroll.approved': 'approved payroll',
  'payroll.locked': 'marked payroll as paid',
  'payroll.draft_deleted': 'deleted a draft payroll',
  'payroll.bank_file_exported': 'downloaded the bank payment file',
  'settlement.drafted': 'started a final settlement',
  'settlement.recalculated': 'recalculated a final settlement',
  'settlement.approved': 'approved a final settlement',
  'settlement.paid': 'marked a final settlement as paid',
  'settlement.deleted': 'deleted a draft final settlement',
  'user.added': 'gave someone access to the company',
  'user.roles_changed': "changed someone's roles",
  'user.updated': "changed someone's access",
  'user.password_reset': "reset someone's password",
  'user.password_changed': 'changed their password',
  'feed.post_removed': 'removed a feed post',
  'feed.comment_removed': 'removed a feed comment',
  'organization.created': 'set up this company',
  'performance.cycle_launched': 'started a performance review cycle',
  'performance.cycle_closed': 'closed a performance review cycle',
  'performance.goals_shared': 'shared performance goals',
  'performance.self_submitted': 'submitted a self-review',
  'performance.review_completed': 'completed a performance review',
  'recruitment.job_created': 'created a job opening',
  'recruitment.job_open': 'published a job on the careers page',
  'recruitment.job_closed': 'closed a job opening',
  'recruitment.applied': 'applied for a job',
  'recruitment.candidate_added': 'added a candidate',
  'recruitment.stage_changed': 'moved a candidate',
  'recruitment.interview_scheduled': 'scheduled an interview',
  'recruitment.feedback_given': 'gave interview feedback',
  'recruitment.offer_saved': 'prepared a job offer',
  'recruitment.offer_sent': 'sent a job offer',
  'recruitment.offer_accepted': 'recorded an accepted offer',
  'recruitment.offer_declined': 'recorded a declined offer',
  'recruitment.hired': 'hired a new employee',
  'onboarding.started': 'started onboarding for a new joiner',
  'onboarding.completed': 'finished an onboarding checklist',
  'user.password_reset_by_email': 'reset their password by email',
  'training.course_created': 'added a training course',
  'training.session_planned': 'planned a training session',
  'training.session_cancelled': 'cancelled a training session',
  'training.enrolled': 'enrolled people in training',
  'training.session_completed': 'marked a training session complete',
  'training.recorded': 'recorded completed training',
  'training.requested': 'asked for training',
  'training.request_approved': 'approved a training request',
  'training.request_rejected': 'turned down a training request',
  'recruitment.job_draft': 'moved a job back to draft',
  'attendance.device_added': 'added an attendance machine',
  'attendance.device_key_replaced': "replaced an attendance machine's key",
  'attendance.machine_id_linked': 'linked a machine ID to an employee',
  'attendance.punches_imported': 'imported punches from an attendance machine',
  'attendance.checkin_blocked': 'was stopped from checking in',
  'user.password_reset_requested': 'asked for a password reset link',
  'support.company.suspended': 'switched this company off',
  'support.company.resumed': 'switched this company back on',
  'support.user.reset_link_sent': 'sent a password reset link',
  'support.user.welcome_resent': 'resent the welcome email',
  'support.user.viewed': 'viewed Quscer People as {subject}, read-only',
};

export function activityPhrase(eventType: string): string {
  return PHRASES[eventType] ?? eventType.replace(/[._]/g, ' ');
}

// The areas people filter the activity history by.
export const ACTIVITY_AREAS = {
  payroll: ['payroll.', 'settlement.'],
  leave: ['leave.'],
  people: ['employee.', 'onboarding.', 'feed.'],
  attendance: ['attendance.'],
  recruitment: ['recruitment.'],
  training: ['training.'],
  performance: ['performance.'],
  access: ['user.', 'organization.'],
  support: ['support.'],
} as const;
export type ActivityArea = keyof typeof ACTIVITY_AREAS;

export function activityArea(eventType: string): ActivityArea | 'other' {
  for (const [area, prefixes] of Object.entries(ACTIVITY_AREAS)) {
    if (prefixes.some((p) => eventType.startsWith(p))) return area as ActivityArea;
  }
  return 'other';
}

// Rough grouping for the icon shown next to each line.
export function activityKind(eventType: string): 'leave' | 'attendance' | 'payroll' | 'document' | 'people' | 'other' {
  if (eventType.startsWith('leave.')) return 'leave';
  if (eventType.startsWith('attendance.')) return 'attendance';
  if (eventType.startsWith('payroll.') || eventType.startsWith('settlement.')) return 'payroll';
  if (eventType.includes('document')) return 'document';
  if (eventType.startsWith('employee.') || eventType.startsWith('user.') || eventType.startsWith('performance.') || eventType.startsWith('recruitment.') || eventType.startsWith('onboarding.') || eventType.startsWith('training.')) return 'people';
  return 'other';
}

// Who did it, when it wasn't someone in the company.
export function actorFallback(e: { eventType: string; metadata: unknown }): string {
  if (e.eventType.startsWith('support.')) {
    const agent = (e.metadata as { supportAgent?: unknown } | null)?.supportAgent;
    return `${typeof agent === 'string' ? agent : 'Quscer'} (Quscer support)`;
  }
  if (e.eventType === 'recruitment.applied') return 'A candidate';
  return 'Someone';
}
