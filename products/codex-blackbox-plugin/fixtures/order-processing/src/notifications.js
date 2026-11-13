export const outbox = [];

/** Records a local confirmation; no message is transmitted. */
export function sendConfirmation(order) {
  outbox.push({ orderId: order.id, recipient: order.email, template: "order-confirmed" });
}
