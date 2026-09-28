// Pay can't be added up across currencies: a company paying people in PKR
// and AED gets one total per currency. The currency with the most people
// comes first.

export interface CurrencyTotal {
  currency: string;
  people: number;
  gross: number;
  deductions: number;
  net: number;
}

type Money = { toString(): string } | number;

export function totalsByCurrency(
  items: { currency: string; netSalary: Money; grossSalary?: Money; totalDeductions?: Money }[],
): CurrencyTotal[] {
  const byCurrency = new Map<string, CurrencyTotal>();
  for (const item of items) {
    const t = byCurrency.get(item.currency) ?? { currency: item.currency, people: 0, gross: 0, deductions: 0, net: 0 };
    t.people += 1;
    t.gross += Number(item.grossSalary ?? 0);
    t.deductions += Number(item.totalDeductions ?? 0);
    t.net += Number(item.netSalary);
    byCurrency.set(item.currency, t);
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return [...byCurrency.values()]
    .map((t) => ({ ...t, gross: round2(t.gross), deductions: round2(t.deductions), net: round2(t.net) }))
    .sort((a, b) => b.people - a.people || a.currency.localeCompare(b.currency));
}
