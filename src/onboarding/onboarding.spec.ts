import { SUGGESTED_CHECKLIST, dueDateFor } from './onboarding.service';

describe('dueDateFor', () => {
  it('counts days from the joining date, negative = before joining', () => {
    const joining = new Date('2026-10-01T09:30:00Z');
    expect(dueDateFor(joining, 0).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(dueDateFor(joining, -3).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(dueDateFor(joining, 90).toISOString()).toBe('2026-12-30T00:00:00.000Z');
  });
});

describe('SUGGESTED_CHECKLIST', () => {
  it('has tasks for HR, the manager and the new joiner', () => {
    const who = new Set(SUGGESTED_CHECKLIST.map((t) => t.assignee));
    expect([...who].sort()).toEqual(['EMPLOYEE', 'HR', 'MANAGER']);
  });
});
