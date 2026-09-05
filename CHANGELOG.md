# Changelog

## 2026-09-06

### Fixed
- Correlate API, model, payment and background events with request/run IDs without logging secrets; preserve transport evidence for non-JSON evaluation failures.
- Submit bounded reviews directly, retain usage for incomplete reports, and skip late review/memory/summary writes after their targets disappear.
- Make approval effects atomic, split promo/paid usage correctly, and guard concurrent task runs and credit calls with expiring reservations.
- Reconcile uncertain payments and refunds with provider queries, idempotency keys, unique ledger entries, and a payment-history retry action; retain monthly quota until refunds settle.
- Mark returned tool errors consistently and keep runs without a completion report blocked without automatic model reviews.
- Require an explicit scope when agents save skills; global skills wait for human approval regardless of the agent's display name.
- Restore mandatory global-skill approval checks and retain scope/approval evidence in evaluation reports.
- Correct mobile and carousel state subscriptions, carousel listener cleanup, accessible labels, and lint errors while retaining documented composite ARIA semantics.

### Validation
- Production browser flow verified: Google login, 5,000 KRW sandbox charge, three real model calls costing 10.416 promo credits, and full refund of the unused 500 paid credits. Ledger entries and released holds matched the UI; no runtime error events were observed.
- Auth/billing integration and tracing: 87 tests, lint/build; live Claude eval 10/10 with no warnings. Real session and route integration uses mocked external providers; browser payment verification is reported separately.
- Runtime safety follow-up: 77 tests; lint and production build; all 23 migrations. Live eval suite passed 9/10 initially; the failed approval-gate case passed on targeted retry. One soft wording warning remains.
- 47 tests passed; lint and production build passed.
- All 22 migrations applied to an empty temporary database.
- Live approval evaluation passed: three cards created and three actions queued for approval.
