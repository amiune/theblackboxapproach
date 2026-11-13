import { reserveInventory } from "./inventory.js";
import { chargePayment } from "./payments.js";
import { saveOrder } from "./store.js";
import { sendConfirmation } from "./notifications.js";

/** @returns {import('./types.js').Order} */
export function createOrder(validated) {
  const reservation = reserveInventory(validated);
  const receipt = chargePayment(validated);
  const order = saveOrder({
    id: `order-${receipt.id}`,
    email: validated.email,
    total: validated.total,
    reservationId: reservation.id,
    paymentId: receipt.id,
    status: "confirmed"
  });
  sendConfirmation(order);
  return order;
}
