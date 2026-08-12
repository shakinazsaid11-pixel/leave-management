# LOG

## Week 1 — data model

### Entities found in the brief

- **Employee** — id, first name, last name, email, role (employee/manager), their manager (another employee, optional), whether they're still active. Every employee reports to at most one manager, and a manager is also an employee, so this is a self-referencing relationship rather than a separate "manager" table.
- **Leave request** — id, who submitted it, start date, end date, status (pending/approved/rejected/cancelled), who reviewed it, when, and a rejection reason when applicable.
- **Leave balance** (not named explicitly in the brief, but implied by "21 days per year" and "how many days an employee has left") — how many days an employee is entitled to, per year.

### What I built

- Schema with `EMPLOYEE`, `LEAVE_BALANCE`, `LEAVE_REQUEST`.
- Constraints doing as much of the enforcement as Postgres can do on its own: `CHECK` on status values, `CHECK` on date ordering, `CHECK` on start date not being in the past, a `GIST EXCLUDE` constraint stopping two approved requests for the same employee from overlapping, and a trigger stopping an approval from pushing someone over their yearly balance.
- Seed data: 10 employees, 3 managers, 45 leave requests across all four statuses and every month of the year, loaded and verified against a real Postgres instance (not just eyeballed) — the overlap constraint and the balance trigger both actually ran against every row.
- `docker-compose.yml` that brings the whole thing up with one command using Postgres's own init-script mechanism, rather than a custom entrypoint script.

### What confused me, and what I decided

**Where does the 21 days live?** I went back and forth between a stored running balance (a `used_days` counter on the employee, decremented on approval) and a fully calculated balance (sum approved requests on demand). I went with **calculated**, backed by a `leave_balance(employee_id, year)` table that only stores the *entitlement*, not the usage. Reasoning: a stored counter is a second copy of information that already exists in `leave_request` — it can drift out of sync with reality (an approval or cancellation that doesn't correctly adjust the counter), and I'd rather have one source of truth even at the cost of an aggregate query. The counter approach would be faster to read but is a correctness risk for exactly the rule the client cares about most.

Splitting it into a per-year table (rather than a bare constant) was really about the Dec 30 → Jan 3 question: I decided a request is charged against the year of its **start date**, in full — not split across two years. The brief explicitly says reporting and part-days are out of scope for now, so I didn't want to build a system that partially allocates a request across two balances when nobody asked for that level of precision yet. I'm flagging this as an assumption to confirm on the call, not a settled fact.

**Do weekends affect the database design, or is that someone else's problem?** I decided it's partly the database's problem. If `business_days` weren't stored, "does this employee have enough days left" would require recomputing the weekend-exclusion logic every time balance is checked — meaning the *definition* of a weekend would need to live in one place and be called consistently by every query that touches balance. Storing the computed value at submission time sidesteps that: the business logic for *what counts as a business day* only needs to run once, at the point of creation, and everything downstream (balance checks, display) just reads a number. The trade-off I noted explicitly: if the weekend policy changes, already-approved requests keep their old business-day count. I think that's correct behavior (you don't want history rewriting itself), but it's worth saying out loud since it wasn't an obvious choice.

**What stops the database from accepting `end_date < start_date` on its own?** A plain `CHECK (end_date >= start_date)` on the table. This one didn't confuse me, but it's a clean example of the difference between what a `CHECK` can do (a rule about a single row) versus what needs a trigger (a rule about a row compared against other rows, like the balance and overlap rules).

**Reviewer for the one employee with no manager.** The brief doesn't say who approves the top-of-tree employee's own leave. I picked a pragmatic answer for the seed data (another manager reviews it) rather than leaving it unhandled, but this is a real gap in the business rules worth raising on the call — right now nothing in the schema stops a manager's own request from having no valid reviewer if there genuinely isn't anyone senior to them.

### Questions I'm bringing to the call

- Confirm the "request charged to the year of its start_date" assumption for New Year's-spanning leave — is that actually what they want, or should it split?
- Who reviews the request of an employee who has no manager?
- Is a calculated balance (vs. a stored counter) the right trade-off once this scales past ~200 employees, or should I revisit that once there's a read-heavy dashboard?

## Week 1 — follow-up after review

Feedback from the first pass on the schema, and what changed:

- **Removed the `CURRENT_DATE` check on `start_date`.** That rule belongs in application code from week 3 onward — the schema shouldn't refuse to store leave that genuinely happened in the past (history, migrations, reporting). Regenerated the seed data to include real past-dated requests as a result, rather than everything anchored in the future.
- **Fixed the reviewer/status constraint.** It previously forced `reviewer_id`/`reviewed_at` to NULL for any `CANCELLED` request — which is wrong for the case that matters most: a manager cancelling an *already-approved* request. That cancellation must not erase the record of who approved it and when. The constraint now only requires NULL reviewer fields while `PENDING`; `CANCELLED` is unconstrained on those two columns, since it can legitimately arrive from either state (pending → cancelled by employee, or approved → cancelled by manager).
- **`reviewed_at` and `created_at` are now `TIMESTAMPTZ`.** They're moments in time, not dates — `DATE` stays correct for `start_date`/`end_date`, which have no time component.
- **`business_days > 0` — is it intended that a weekend-only range can't be recorded?** Yes, kept it. A range that costs zero leave days isn't really "leave" in the sense the balance/overlap rules care about, so there's nothing meaningful for the row to represent. The trade-off: right now the *only* thing stopping this is a raw constraint violation, which is a poor user-facing error message. Application code should validate and reject this earlier with something readable, using the `CHECK` purely as a last-resort safety net rather than the primary defense.
- **README verification.** Docker isn't available in the environment I'm building in, so I couldn't literally run `docker compose up -d` end-to-end. Instead I replicated Postgres's own init-script behavior directly — same database name, same user, same password, same file order (`1_schema.sql` then `2_seed.sql`) that `docker-compose.yml` specifies — and confirmed the exact `docker exec` command in the README returns the expected row count. Flagging this honestly rather than claiming a Docker run I didn't actually perform; worth a real `docker compose up -d` test on a machine that has Docker before this is treated as fully verified.
