# Changelog

## 2026-09-06

### Fixed
- Require an explicit scope when agents save skills; global skills wait for human approval regardless of the agent's display name.
- Restore mandatory global-skill approval checks and retain scope/approval evidence in evaluation reports.
- Correct mobile and carousel state subscriptions, carousel listener cleanup, accessible labels, and lint errors while retaining documented composite ARIA semantics.

### Validation
- 47 tests passed; lint and production build passed.
- All 22 migrations applied to an empty temporary database.
- Live approval evaluation passed: three cards created and three actions queued for approval.
