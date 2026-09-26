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
};

export function activityPhrase(eventType: string): string {
  return PHRASES[eventType] ?? eventType.replace(/[._]/g, ' ');
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
