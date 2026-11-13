let nextReceipt = 1;

/** @returns {import('./types.js').PaymentReceipt} */
export function chargePayment(validated) {
  return { id: `receipt-${nextReceipt++}`, amount: validated.total, status: "recorded" };
}
