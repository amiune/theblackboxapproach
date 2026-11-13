let nextReservation = 1;

/** @returns {import('./types.js').Reservation} */
export function reserveInventory(validated) {
  return { id: `reservation-${nextReservation++}`, skus: validated.items.map(item => item.sku) };
}
