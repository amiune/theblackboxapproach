/** @returns {import('./types.js').ValidatedOrder} */
export function validateOrder(request) {
  if (!request || !Array.isArray(request.items) || !request.items.length) {
    throw new Error("An order must contain at least one item.");
  }
  if (typeof request.email !== "string" || !request.email.includes("@")) {
    throw new Error("A contact email is required.");
  }
  const items = request.items.map(item => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.unitPrice < 0) {
      throw new Error("Invalid item quantity or price.");
    }
    return { sku: String(item.sku), quantity: item.quantity, unitPrice: item.unitPrice };
  });
  return { items, email: request.email, total: items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) };
}
