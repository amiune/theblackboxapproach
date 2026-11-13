const orders = new Map();

/** @returns {import('./types.js').Order} */
export function saveOrder(order) {
  orders.set(order.id, { ...order });
  return orders.get(order.id);
}
