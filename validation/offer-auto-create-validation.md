# Automatic Offer Creation Validation (2026-10-15)

Live verification against the running development app, **fictional data only**: candidate `AUTO-OFFER-TEST-001` ("Auto Offer Testperson", fictional phone) acting as a fictional admin `auto.offer@example.test` (random fictional password, Argon2id). The applied position was an existing active position from the dev database — nothing was seeded.

Flow: create candidate → phone screen **Selected** → direct interview **Selected** → verify the offer.

| Check                                             | Expected                                 | Actual                                                                  | Result |
| ------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Candidate / phone screen / direct interview saves | 201 / 201 / 201                          | 201 / 201 / 201                                                         | PASS   |
| Offer rows after Selected                         | exactly 1, created automatically         | 1                                                                       | PASS   |
| Offer content                                     | candidate + applied position, rest empty | position = applied; date/mode/location/status/joining/attended all NULL | PASS   |
| No salary                                         | nowhere                                  | no salary column, value or audit text exists                            | PASS   |
| Pipeline stage                                    | selected                                 | selected                                                                | PASS   |
| Audit                                             | OFFER_CREATE, source direct_interview    | OFFER_CREATE, details.source = direct_interview                         | PASS   |
| Re-save Selected, edit a score (retry behaviour)  | still exactly 1 offer                    | 1                                                                       | PASS   |
| Offer Tracker list                                | shows the automatic offer                | row with position "HR", status pending                                  | PASS   |
| Candidates 2002 / 2003                            | untouched                                | ids + updated_at identical before and after                             | PASS   |

**Cleanup:** the fictional offer, interview, phone screen, stage history, pipeline row and candidate were deleted; the fictional admin `auto.offer@example.test` was **deactivated, not deleted** — the append-only audit log references it (`actor_user_id` is ON DELETE RESTRICT), the same precedent as `viewer@example.test` and `users-test@example.test`. The audit rows from the run remain, by design.

**Automated:** 7 new backend tests (`backend/tests/offerAutoCreate.test.js`) — one offer with only known values and the audit entry; the offer appears in the list; a decision reached later by editing also creates it; re-save + retry + score edits + second interview (409) never add a second offer; a manual offer afterwards is 409; a refused interview change after the automatic offer rolls back completely (interview, offer and stage all unchanged); a candidate without an applied position gets no invented offer and waits in the tracker. All 116 pre-existing interview/offer tests pass unchanged.

**Mentor confirmation still required:** whether an interview may ever be changed after its offer exists (today it is refused, so the offer is never deleted automatically), and what the offer's fate would be if that is relaxed.

Full suite: **430 backend + 341 frontend = 771 passing**; build/lint/format clean. No migration created; schema untouched.
