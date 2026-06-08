const crypto = require('crypto');

const tickets = new Map();

/**
 * Creates a one-time use ticket for WebSocket authentication.
 * @param {string} userId
 * @returns {string} The ticket
 */
exports.createTicket = (userId) => {
  const ticket = crypto.randomBytes(16).toString('hex');
  // Expires in 30 seconds
  const expires = Date.now() + 30000;
  tickets.set(ticket, { userId, expires });

  // Cleanup
  const cleanupTimeout = setTimeout(() => tickets.delete(ticket), 30000);
  if (typeof cleanupTimeout.unref === 'function') cleanupTimeout.unref();
  return ticket;
};

/**
 * Verifies and consumes a ticket.
 * @param {string} ticket
 * @returns {string|null} userId if valid, null otherwise
 */
exports.verifyTicket = (ticket) => {
  const data = tickets.get(ticket);
  if (!data) {
    console.log(`[DEBUG] Verifying ticket: ${ticket}. Found: false (Missing)`);
    return null;
  }

  if (Date.now() > data.expires) {
    console.log(`[DEBUG] Verifying ticket: ${ticket}. Found: true (Expired)`);
    tickets.delete(ticket);
    return null;
  }

  console.log(`[DEBUG] Verifying ticket: ${ticket}. Found: true (Valid)`);
  // Consume the ticket immediately to ensure single-use
  tickets.delete(ticket);
  return data.userId;
};
