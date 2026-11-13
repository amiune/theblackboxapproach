# Orderflow

A small, synthetic order-processing codebase created for the BlackBox Project plugin
demonstration. All payments, inventory, persistence, and notifications are local
in-memory examples. There are no credentials, network calls, or real customers.

`submitOrder` validates a request, then calls the order service. The service
reserves stock, records a payment receipt, saves an order, and sends a
confirmation. The notification module only appends to a local outbox.

Shared structures are documented as JSDoc types in `src/types.js`.
This fixture demonstrates source inspection; it is not a production service.
