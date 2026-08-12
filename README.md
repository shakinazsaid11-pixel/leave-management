# leave-management

Week 1 deliverable: data model for a company leave management system (~200 employees, replacing paper/spreadsheets).

## Contents

- `docs/er-diagram.png` — ER diagram (source: `docs/er-diagram.dot`, Graphviz)
- `db/schema.sql` — table definitions, constraints, and the balance-enforcement trigger
- `db/seed.sql` — 10 employees across 3 managers, 45 leave requests spread across all four statuses and all twelve months
- `docker-compose.yml` — Postgres 16, auto-loads schema + seed on first start

## Running it

```bash
docker compose up -d
```

That's it — one command. Postgres starts, and on the **first** run only, it automatically executes `db/schema.sql` then `db/seed.sql` (Postgres's official image runs anything in `/docker-entrypoint-initdb.d/` once, when the data volume is empty).

Connect with:

```bash
docker exec -it leave_management_db psql -U leave_admin -d leave_management
```

To start completely fresh (re-run the init scripts), drop the volume first:

```bash
docker compose down -v
docker compose up -d
```

## A note on "a request can't start in the past"

That rule is **not** enforced by the database. It moves into application code starting week 3, so the schema can hold real past leave (needed for history, reporting, and this week's seed data). `db/seed.sql` includes genuinely past-dated requests as a result.

## Design decisions worth knowing before the call

These are expanded on in `LOG.md`, but briefly:

- **Leave balance** lives in its own `leave_balance(employee_id, year)` table rather than a running counter on `employee`. The *remaining* balance is calculated on demand (`total_days` minus the sum of that year's approved `business_days`), not stored — so there is one source of truth.
- **Weekends** (Friday/Saturday per the brief) are accounted for once, at submission time, into a stored `business_days` column. It is not recalculated later, so a future change to the weekend policy can't silently rewrite the cost of leave someone already took.
- **Overlap prevention** ("never let two approvals conflict") is enforced by Postgres itself, via a `GIST EXCLUDE` constraint — not application code.
- **Balance enforcement** ("never let someone take leave they don't have") is enforced by a trigger on `leave_request`, since it requires aggregating other rows, which a plain `CHECK` can't do.
- Employees are **soft-deleted** (`is_active`) rather than removed, so a former employee's leave history and manager relationships stay intact.
- **Cancelling an approved request keeps its review history.** `reviewer_id`/`reviewed_at` are only required to be NULL while a request is `PENDING`; a `CANCELLED` request may still carry who approved it and when, since cancellation doesn't erase that it was once approved.
- **`reviewed_at`/`created_at` are `TIMESTAMPTZ`**, not `TIMESTAMP` — they're moments in time, not calendar dates, so the timezone matters. `start_date`/`end_date` stay `DATE`, since a leave day has no time component.
- **`business_days > 0`** means a request falling entirely on a weekend can't be recorded — a deliberate choice, since such a request costs no leave and has nothing to represent. The application layer should reject it earlier with a clear message rather than let the raw constraint violation surface.
