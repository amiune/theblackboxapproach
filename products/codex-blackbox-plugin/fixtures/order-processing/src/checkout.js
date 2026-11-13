import { validateOrder } from "./validation.js";
import { createOrder } from "./orders.js";

/** @param {import('./types.js').OrderRequest} request */
export function submitOrder(request) {
  const validated = validateOrder(request);
  return createOrder(validated);
}
