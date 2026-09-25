// Whose birthday is it on `today` (midnight UTC of the company's local date)?
// Pure, so it can be unit-tested. Someone born on 29 February is
// celebrated on 28 February in years that have no 29th.

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function hasBirthdayOn(dateOfBirth: Date, today: Date): boolean {
  const month = dateOfBirth.getUTCMonth();
  const day = dateOfBirth.getUTCDate();
  if (month === 1 && day === 29 && !isLeapYear(today.getUTCFullYear())) {
    return today.getUTCMonth() === 1 && today.getUTCDate() === 28;
  }
  return today.getUTCMonth() === month && today.getUTCDate() === day;
}

export function birthdayMessage(firstName: string, companyName: string): string {
  return `Happy birthday, ${firstName}! 🎂 Wishing you a wonderful year ahead from everyone at ${companyName}.`;
}

// One automatic post per person per year, however often the feed is loaded.
export function birthdayKey(employeeId: string, today: Date): string {
  return `birthday:${employeeId}:${today.getUTCFullYear()}`;
}
