import { expect, test } from "@playwright/test";
import { approvedBudget, type ModelChange } from "../src/modules/model-change/domain/model-change";

// Only the fields approvedBudget reads; the rest of the resource does not take part in the sum.
function change(status: ModelChange["status"], estimate?: { currency: string; total: number; complete: boolean }): ModelChange {
  return { status, report: estimate ? { estimate: { ...estimate, lines: [] } } : null } as unknown as ModelChange;
}

test("El presupuesto suma solo los cambios aplicados con estimación completa", () => {
  expect(approvedBudget([
    change("APPLIED", { currency: "COP", total: 1000, complete: true }),
    change("APPLIED", { currency: "COP", total: 250, complete: true }),
    change("APPLIED", { currency: "COP", total: 99, complete: false }),
    change("RESTORED", { currency: "COP", total: 5000, complete: true }),
    change("DISCARDED", { currency: "COP", total: 7000, complete: true }),
    change("READY", { currency: "COP", total: 9000, complete: true }),
  ])).toEqual({ currency: "COP", total: 1250, counted: 2, missing: 1, otherCurrency: 0 });
  expect(approvedBudget([])).toEqual({ currency: "COP", total: 0, counted: 0, missing: 0, otherCurrency: 0 });
});

test("El presupuesto no mezcla monedas: la primera fija la del total y las demás se informan aparte", () => {
  expect(approvedBudget([
    change("APPLIED", { currency: "USD", total: 10, complete: true }),
    change("APPLIED", { currency: "COP", total: 40000, complete: true }),
    change("APPLIED", { currency: "USD", total: 5, complete: true }),
  ])).toEqual({ currency: "USD", total: 15, counted: 2, missing: 0, otherCurrency: 1 });
});
