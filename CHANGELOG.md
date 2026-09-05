# Changelog

## 2026-09-06

### Fixed
- Make approval effects atomic, split promo/paid usage correctly, and guard concurrent task runs and credit calls with expiring reservations.
- Reconcile uncertain payments and refunds with provider queries, idempotency keys, unique ledger entries, and a payment-history retry action; retain monthly quota until refunds settle.
- Mark returned tool errors consistently and keep runs without a completion report blocked without automatic model reviews.
- Require an explicit scope when agents save skills; global skills wait for human approval regardless of the agent's display name.
- Restore mandatory global-skill approval checks and retain scope/approval evidence in evaluation reports.
- Correct mobile and carousel state subscriptions, carousel listener cleanup, accessible labels, and lint errors while retaining documented composite ARIA semantics.

### Validation
- Runtime safety follow-up: 77 tests; lint and production build; all 23 migrations. Live eval suite passed 9/10 initially; the failed approval-gate case passed on targeted retry. One soft wording warning remains.
- 47 tests passed; lint and production build passed.
- All 22 migrations applied to an empty temporary database.
- Live approval evaluation passed: three cards created and three actions queued for approval.
