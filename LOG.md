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

## Week 2 — the API

Built the NestJS/TypeORM backend on top of the week-1 schema: all 8 endpoints (`GET /employees`, `GET /employees/:id`, `POST /leave-requests`, `GET /leave-requests` with filtering, `GET /leave-requests/:id`, and the three `PATCH .../approve|reject|cancel` transitions).

**What I built:**

- `EmployeesModule` and `LeaveRequestsModule`, each with entity + service + controller. The remaining-balance calculation lives in the service (business rule spanning two tables, not a query).
- Business-day counting on `create()`, computed from `startDate`/`endDate` server-side rather than trusted from the client.
- A response interceptor wrapping every successful response as `{ success: true, data }`.
- A Postman collection covering all 8 endpoints, including deliberately-broken cases (not-found ids, filters).

**A real bug I hit:** my first `POST /leave-requests` failed with `null value in column "business_days"` — I'd written `create()` to expect `businessDays` in the request body, but the client only ever sends `employeeId`/`startDate`/`endDate`. Fixed by computing it server-side, which is also the more correct design.

**Known gaps carried into week 3, and closed there:**

- Errors weren't wrapped in the same shape as successes — a database constraint violation (past date, overlap, over-balance) reached the caller as a bare `500` with no message. This week's whole point.
- The day-counting function excluded Sunday/Saturday instead of Friday/Saturday — a real bug, not caught until week 3's business-brief re-read forced a second look at it.
- No dedicated Repository class — still true; services inject `Repository<T>` directly. Not fixed this week either; noted again below.

## Week 3 — rules and validation

### Before writing any rule code

- Branched `week-03-validation` off `main` (not off `week-02-api`), per the instructions — `main` has the week-1 review fixes that `week-02-api` never picked up. Brought the week-2 API code and Postman collection across with `git checkout week-02-api -- leave-api` / `-- postman .postman` rather than a full merge, so the branch ends up with `main`'s corrected schema underneath and week 2's application code on top, without dragging in whatever `week-02-api`'s own README/LOG state was.
- Added `.env.example` and rewrote the README's setup section against what the repo actually contains — the `docker exec` command in the old README referenced a container/user name that didn't match `docker-compose.yml`, which would have stopped a fresh clone cold at that exact step.
- Fixed the day-counting bug from week 2 (see above): `day !== 0 && day !== 6` (excluding Sunday) was wrong; the brief says Friday and Saturday are the weekend. Verified against the brief's own example (Thursday→Sunday = 2 days).
- Finished the exception filter I'd deferred in week 2, so every error now comes back as `{ success: false, error: { statusCode, message } }` — the same shape family as a success, not NestJS's default `{ message, error, statusCode }`.

### The 8 rules, and where each one lives

All 8 are enforced in the service layer, ahead of the database. Full table with status codes and exact messages is in the README. Notes on the ones that needed real thought:

**Rule 3 (balance) lives in `approve()`, not `create()`.** The brief says explicitly the balance is only reduced on approval, not submission — so a request *can* be submitted for more days than the employee has left; it just can't be *approved*. Getting this wrong (checking at submission time instead) would have blocked a legitimate case: two pending requests that would individually fit, submitted before either is decided.

**Rule 4 (overlap) took the most thinking**, as the brief warned it would. Worked through it by naming the "no overlap" case instead of the "overlap" case — there are two ways two ranges *don't* touch (one ends before the other starts, or starts after the other ends), and everything else is an overlap, regardless of which one is longer, which one started first, or whether one fully contains the other. Negating that two-part "no overlap" condition gives one inequality (`existing.end >= new.start AND existing.start <= new.end`) that covers all seven ways I could draw two ranges relative to each other, with no per-case branching in the code. Tested it against a real overlapping pair through the running API, not just reasoned about on paper — created an approved request, then tried to approve a second one that shared a few days with it, and got a 409 naming the conflicting range.

**Rule 7 (who can cancel) needed an assumption**, since there's no login yet. Went with a `requesterId` in the request body, checked against the employee's `manager_id` in the `employee` table — closer to the real rule than a bare `role` field the caller could just claim, and it reuses the manager relationship that's already in the schema rather than inventing a new one. This is explicitly a stopgap: week 5's real auth should replace `requesterId` with whoever the token says is calling, and the check itself doesn't need to change.

### Known gaps still open

- **No dedicated Repository class**, third week running. `LeaveRequestsService` builds its own `createQueryBuilder` chains for filtering and for the overlap/balance checks — query-building that arguably belongs one layer down. Hasn't blocked anything yet, but worth deciding whether to do before week 4 adds more surface area to the service.
- **Rule 4 and the concurrent-approval question.** My check is a read (find an overlapping approved request) followed by a write (save as approved) — two separate statements, not one atomic operation. If two managers approved two different overlapping requests for the same employee at the exact same moment, both reads could run before either write lands, and both would find nothing to object to. The week-1 `GIST EXCLUDE` constraint is what actually closes this gap — it's enforced by Postgres itself, at the database level, in a way a single service-layer check running twice in parallel can't be. Worth confirming on the call whether relying on the DB constraint as the final backstop here (with the service check as the fast/friendly path) is considered sufficient, or whether the approve endpoint needs an explicit lock.
- **`requesterId`/`reviewerId` as plain body fields.** Anyone can currently claim to be anyone. Acceptable as a week-3 stopgap per the brief, not acceptable past week 5.

### Questions I'm bringing to the call

- Is the `requesterId`-in-body approach for rule 7 the right shape to build week 5's auth on top of, or would a different placeholder be less to unwind later?
- For the concurrent-approval race (see above) — is the database constraint an acceptable final backstop, or does this need explicit locking in the service now?
- Rule 4's overlap check currently treats "touching but not sharing a day" as no conflict (e.g., one request ending the 10th and another starting the 10th only overlap because both dates are inclusive) — confirm that inclusive-on-both-ends is actually the intended definition of overlap.

## Week 4 — the user interface

### Before writing any screen code

- Created `week-04-frontend` from `week-03-validation`. The week 4 pull request into `main` is #3, opened on 14-Oct-26 and not merged.
- Did the two API tasks first, because the screens would otherwise send real, messy input to an API that answers every failure with an Internal server error: input checks (`ValidationPipe` and class-validator on the DTOs) and error logging in the exception filter.

### What I built

Three screens (My requests, New request, Approvals) with loading, empty, error and loaded states, an employee menu standing in for login, and one `api.ts` file that is the only place that talks to the API. Every failure leaves that file as one kind of error whose message is already safe to show, and any 500 is turned into a plain sentence there so technical wording can never reach the screen. Screenshots of each state are in `docs/screenshots/`.

### Decisions and what I changed in the API

**The day count on the form comes from the API.** I added `GET /leave-requests/preview`, which calls the same `validateRange` function that `POST /leave-requests` uses. The number the person sees before submitting is therefore the number that gets stored, and the form shows the API's own refusal (weekend only, past date, end before start) in the same place.

**Input checks refuse early, with plain sentences.** A weekend only range now returns a 400 before any query runs (before, it reached the `business_days > 0` constraint and came back as a 500). `stopAtFirstError` stops one bad date from producing the same message twice.

**Error logging keeps the details and hides them from the user.** Unexpected failures are written with method, URL and stack; expected refusals are written as warnings. I also mapped the database's own rule violations (overlap, balance trigger, check and foreign key) to readable messages so the safety net from week 1 no longer shows up as a bare 500. I proved the logging works by stopping the database and reading the log line (`ECONNREFUSED`) while the caller only saw the tidy message.

**Messages written for screens.** Old API messages like `Leave request 5 is APPROVED, cannot approve` or `2026-08-30 to 2026-09-02` were developer language and raw dates. They are now sentences with dates as `dd-MMM-yy`.

**The approvals screen only shows what a manager can act on.** Added a `managerId` filter plus the employee's name to the list endpoint, instead of fetching everything and filtering in the browser, since the browser should not hold other people's requests it does not need.

### Fixes after the week 4 review

1. **My requests showed the wrong person when switching quickly.** The answer for the first person could arrive after the answer for the second and overwrite it. Now each loaded result is kept together with the id of the person it was loaded for, the screen shows "Loading" until the result matches the person chosen, and an effect that has been replaced ignores its late answer (the `cancelled` flag). The same idea is used on New request, where each day count is kept with the dates it was asked for.
2. **Empty box when the server was down.** When the list of people failed to load, My requests returned nothing and the message only appeared in the top bar. All three screens now show the message in the middle of the page with a "Try again" button.
3. **Anyone could approve, even their own request.** The screen only showed the buttons to managers, but the API accepted any `reviewerId`. `approve` and `reject` now check on the server that the reviewer is the manager of the employee who made the request (`assertReviewerManagesEmployee`). That also stops anyone reviewing their own request, because nobody is their own manager. The check runs before the status and the reason, so someone who is not allowed to decide learns nothing about the request. An employee with no manager gets a separate message saying so.
4. **An approval refusal is shown on the request it belongs to,** inside that request's card, not above the list. The success message stays above the list.
5. **`npm run lint` passes** in both `leave-frontend` and `leave-api`. The three frontend errors were all React's rule against calling `setState` directly inside an effect. They are fixed by computing the idle and loading states from what is already known instead of storing them, and on Approvals by splitting the screen in two and giving the inner list a `key` so it starts from scratch when the manager changes. The API had `any` values flagged in the filter, the interceptor and the employees service, which now have real types. `npm run build` passes in both.
6. **`leave-frontend/.env.example` is committed** (the `.gitignore` pattern `.env*` was hiding it, so it now has an exception for that one file) and `leave-frontend/README.md` replaces the default text.
7. **The log said the pull request was opened when it was not.** It is opened now, and the line above reflects the real state.

### Answers to the three questions

**1. Why do I need both `busyRef` and `busyId` on the Approvals page?** They do different jobs. `busyId` is state, so the screen can show it: the clicked button changes to "Approving..." and every approve and reject button is disabled. But state changes only show up after React renders again, so a fast second or third click can arrive before the buttons are disabled. `busyRef` is a plain value that changes immediately, so the action checks it first and ignores any click while another one is running. One tells the user what is happening, the other makes sure it happens only once.

**2. What does the `cancelled` flag in a `useEffect` do?** Each time the effect runs it starts a request and creates its own flag. When the effect runs again (the person was switched) or the screen leaves, React first runs the cleanup of the old one, which sets that flag to true. If the old answer arrives late, it sees its flag and does not write to the state. Without it, a slow answer for the previous person could overwrite the current one, which is the bug on My requests.

**3. Nourhan has no manager, so nobody sees her requests. What would I propose?** The API now refuses to let anyone review them and says why, so nothing slips through, but her requests stay pending forever, which is a business decision and not a technical one. My proposal is that the client names a reviewer for the top of the tree (for example another senior manager or HR), stored in the data as a field on the employee so it is a rule and not code. Until they decide, her requests stay pending and the message explains it.

### Questions from the first brief, still true

**Is the day shown on screen the day stored in the database?** Date columns arrive as `YYYY-MM-DD` strings. `formatDate` splits the string and never builds a `Date`, because `new Date("2026-08-30")` is midnight UTC and reading it back in a browser behind UTC would show the 29th. I checked by comparing screens against the seed (for example 04-Oct-26 and 16-Jul-26 for Sara Youssef match the rows in `seed.sql`). A moment like `createdAt` is different: it is one instant stored in UTC and must be shown in a real timezone. `formatDateTime` uses `Intl` with `Africa/Cairo`, which follows Egypt's clock changes, and replaces an earlier version that added a fixed 3 hours and would have been an hour wrong for half the year. No screen shows a time of day yet, so it is ready but not visible.

**Where does the number of days come from?** From the API (`/leave-requests/preview`), and the API has one counting function, `countBusinessDays`. There is no second copy in the browser, so the day the client adds a public holiday it is changed in one place and the form, the stored value and the balance check all follow.

### Problems I hit

- The balance type in `api.ts` said `year` while the API returns `balanceYear`, so the year was missing from the balance sentence until I matched the two.
- `GET /leave-requests/preview` has to be declared before `GET /leave-requests/:id`, otherwise Nest reads the word "preview" as a request id.
- The frontend and the API both default to port 3000, so the frontend runs on 3001.
- The first navigation used plain links, which reload the page and reset the chosen employee to the first one; switched to Next's `Link`.
- I only ran `lint` and `build` at the very end the first time, so three errors reached the review. They are part of the checklist before every submission now.

### Checked by hand

- Approving or rejecting through the API (Postman) as the employee herself, as a manager of someone else, as the employee's real manager's report, and for an employee with no manager: all return 403 with the right message. Approving as the real manager still works from the Approvals screen.
- The balance on My requests matches the seed (for example 16 of 21 for Sara Youssef after her approved days).
- The overlap refusal shows as a sentence with dates as `dd-MMM-yy`.
- `npm run lint` and `npm run build` pass in both folders.

### Known gaps

- No dedicated Repository class, fourth week running (services still inject `Repository<T>`).
- Who is calling (`reviewerId`, `requesterId`) is still sent in the request body. The server now checks it against the employee's manager, but anyone calling the API directly can still claim to be that manager. Real authentication in week 5 replaces this.
- Nourhan's requests cannot be reviewed by anyone until the client decides who reviews them.
- Employees marked inactive still appear in the person menu.
- `formatDateTime` is not used on any screen yet.
- No automated tests for the screens; everything was checked by hand against the running API.

### Questions I'm bringing to the call

- Who reviews the requests of an employee with no manager?
- Inactive employees: hide them from the menu, or show them marked as inactive?
- Should a public holiday calendar be part of the API now, since the day count already lives in one place?