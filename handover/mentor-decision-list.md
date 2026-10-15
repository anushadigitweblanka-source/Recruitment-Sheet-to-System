# Mentor Decision List (consolidated, 2026-10-15)

Every open question in one place. For each: what we need decided, and what it unblocks. Nothing below has been implemented by guesswork — the system refuses input or omits the feature until the decision lands. (A ready-to-use conversation prompt for items 1–5 exists in `prompts/module6-mentor-decisions-continuation.md`, kept local.)

**Scope note (mentor-approved):** the current internship task uses dummy/test data only. Items 1–15 affect the current dummy-data completion scope. Items 16–17 are **future / go-live decisions — not required for the current internship completion** — and are kept at the end for the record.

> **Stage 11 correction (2026-10-15).** The official task guide settles several items below. See `validation/stage11-mentor-blocked-readiness.md` and `handover/mentor-approval-checklist.md` for the current list. Settled by the guide and implemented: 1 (recipients), 3 (template types), 4 (Auto / One-click modes), 5 (CV pending trigger), 10 (roles and permissions), 11 (salary design). Still requiring confirmation: 2 (retry), 6, 7, 8, 9, 12, 13, 14, 15.

## Notifications (Module 6)

1. **Reminder recipients** — who receives each reminder type (per phase gate, interview, offer, cv_pending)? _Unblocks: automatic notification creation (the sending machinery is done and tested) and the scheduled weekly report email._
2. **Retry policy for failed sends** — retry automatically (how often, how many times) or manual resend only (today's behaviour)?
3. **Final template-type list** — the approved set of template types (today the type is a free label).
4. **Manual send_mode behaviour** — what should "review before send" mean in practice? The column exists; manual sending does not.
5. **cv_pending trigger** — when is a CV-pending reminder created, and for which candidates?

## Field value lists

6. **Phone-screen `response` values** — the approved list. Today the field refuses every value.
7. **Interview `recommendation` values** and **offer `work_mode` list** — only `office` is approved for work mode (temporary, migration 007); recommendation accepts nothing yet.

## Lifecycle rules

8. **Junior 9-month rule** — _Implemented on the project owner's decision (2026-10-15):_ 9 months counted from the day junior starts, using `junior_months`. **HR confirmation is still pending** and is not a formal sign-off. If HR chooses "from joining" instead, the helper `juniorPhaseEnd` already supports it.
9. **Discontinued vs Terminated definitions** — confirm (or correct) the guide's working definition as implemented: Discontinue at any gate with reason + exit date; Terminate only after probation.

## Roles, salary, offers

10. **Final role list and permissions** (HR, Team Lead, Intern) — names, codes and the permission each holds; may roles be edited in the app afterwards? _Unblocks: role editing/seeding behind the read-only Roles & Permissions view._
11. **Salary design** — where it is stored, who may view/edit, and how access is logged. _Nothing salary-related exists anywhere until this is approved._
12. **"Offer Rejected"** — is it a pipeline stage (decision 3)? Today an offer is Sent/Accepted/empty only.
13. **Offer locked after creation** — confirm: once the (automatic) offer exists, the interview decision can no longer be changed, and the offer is never auto-deleted. If a correction path is ever needed, what happens to the offer? Related: should a candidate be required to have an applied position before being Selected, so the automatic offer can never be skipped?

## Candidates

14. **Candidate ID format** — the official format and who/what generates new IDs (decision 11). Today it is typed, unique, format-free.
15. **Which matches count as a duplicate** — confirm the warning triggers (same phone, same email, same name+position).

---

## FUTURE / GO-LIVE DECISIONS — NOT REQUIRED FOR CURRENT INTERNSHIP COMPLETION

Kept for the record; these matter only if the mentor later extends the scope to real data and go-live.

16. **Real-data import approvals** — the real workbook (tabs, headers, ID format), approved position/source lists + merge mappings, approved status-word mappings, and the import migrations (`is_historical`, `applied_on`, import batch/review tables, `position_aliases`). _Would unblock: the real-data import phase (dry-run framework is ready)._
17. **Mail provider** — which provider, and its credentials policy. _Would unblock: real email delivery (today: development mode, nothing leaves the machine)._
