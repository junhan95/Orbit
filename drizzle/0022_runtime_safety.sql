-- D1 batch assertions: failed preconditions abort the entire transaction.
CREATE TABLE transaction_guards (
  id TEXT PRIMARY KEY NOT NULL,
  passed INTEGER NOT NULL CONSTRAINT transaction_guard_passed CHECK (passed = 1)
);
--> statement-breakpoint
CREATE TABLE runtime_leases (
  resource_key TEXT PRIMARY KEY NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX idx_credit_ledger_payment ON credit_ledger (user_id, ref_type, ref_id, kind, bucket)
WHERE ref_type = 'payment';
