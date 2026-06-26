// Folder-actions — shared types for the four folder sub-routes
// (next-action / attention / payment-request / payment-requests).
//
// The wire DTOs themselves live in the existing libs (ClientNextAction,
// ClientFolderAttention, BusinessPayment); this file only re-exports the
// payments row type used by the repo + service so callers don't reach across
// directories for it.

export type { PaymentRequestRow, BusinessPayment } from '../../../lib/server/payments';
