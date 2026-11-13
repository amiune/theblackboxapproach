/**
 * @typedef {Object} OrderRequest
 * @property {Array<{sku: string, quantity: number, unitPrice: number}>} items
 * @property {string} email
 */

/**
 * @typedef {Object} ValidatedOrder
 * @property {Array<{sku: string, quantity: number, unitPrice: number}>} items
 * @property {string} email
 * @property {number} total
 */

/**
 * @typedef {Object} Reservation
 * @property {string} id
 * @property {string[]} skus
 */

/**
 * @typedef {Object} PaymentReceipt
 * @property {string} id
 * @property {number} amount
 * @property {string} status
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} email
 * @property {number} total
 * @property {string} reservationId
 * @property {string} paymentId
 * @property {string} status
 */

export {};
