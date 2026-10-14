# Import Dry-Run Report

- Workbook: `fictional-demo.xlsx`
- Mode: **dry-run** (no recruitment data was written)
- Generated: 2026-10-14T08:06:51.718Z
- Totals: rows scanned: 12 · ready: 0 · review required: 12 · skipped: 0

## Issue summary

| Issue code                 | Count |
| -------------------------- | ----- |
| duplicate_candidate_id     | 1     |
| invalid_date               | 1     |
| invalid_email              | 1     |
| invalid_phone              | 1     |
| invalid_score              | 3     |
| missing_required_field     | 2     |
| reused_cv_link             | 1     |
| unknown_position           | 6     |
| unknown_sheet              | 2     |
| unknown_source             | 2     |
| unknown_status             | 9     |
| unmatched_candidate        | 3     |
| unmatched_direct_interview | 2     |
| unmatched_phone_interview  | 2     |

## Sheet: Candidates (Candidates (Tab 1))

Rows scanned: 4

### Rows needing review

| Row | Candidate ID | Issue code             | Explanation                                                                                      |
| --- | ------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| 2   | FAKE-0001    | unknown_position       | "Dummy Automation Tester" has no approved mapping                                                |
| 2   | FAKE-0001    | unknown_source         | "Fictional Job Board" has no approved mapping                                                    |
| 3   | FAKE-0002    | invalid_phone          | stored as a number in the workbook; the leading zero is lost and the restore rule is unconfirmed |
| 3   | FAKE-0002    | unknown_position       | "Unknown Dummy Position" has no approved mapping                                                 |
| 3   | FAKE-0002    | unknown_source         | "Unknown Dummy Source" has no approved mapping                                                   |
| 4   | FAKE-0001    | unknown_position       | "Dummy Automation Tester" has no approved mapping                                                |
| 4   | FAKE-0001    | duplicate_candidate_id | Candidate ID also appears in this workbook at row 2                                              |
| 4   | FAKE-0001    | reused_cv_link         | the same CV link also appears at row 2                                                           |
| 5   | —            | missing_required_field | Candidate ID is empty                                                                            |
| 5   | —            | invalid_email          | not a valid address shape                                                                        |
| 5   | —            | unknown_position       | "Dummy Web Developer" has no approved mapping                                                    |

## Sheet: Phone Screening (Phone interview (Tab 2))

Rows scanned: 2

### Rows needing review

| Row | Candidate ID | Issue code                | Explanation                            |
| --- | ------------ | ------------------------- | -------------------------------------- |
| 2   | FAKE-0001    | unmatched_phone_interview | no existing candidate matches this row |
| 2   | FAKE-0001    | unknown_status            | "Will attend" has no approved mapping  |
| 2   | FAKE-0001    | unknown_status            | "Selected" has no approved mapping     |
| 3   | —            | unmatched_phone_interview | no existing candidate matches this row |

## Sheet: Direct Interviews (Direct interview (Tab 3 / Tab 7))

Rows scanned: 2

### Rows needing review

| Row | Candidate ID | Issue code                 | Explanation                                                                                                        |
| --- | ------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 2   | FAKE-0001    | unmatched_direct_interview | no existing candidate matches this row                                                                             |
| 2   | FAKE-0001    | unknown_status             | "Attended" has no approved mapping                                                                                 |
| 2   | FAKE-0001    | invalid_score              | workbook total (39) does not equal the sum of the five scores (40); the database-calculated total is authoritative |
| 2   | FAKE-0001    | unknown_status             | "Selected" has no approved mapping                                                                                 |
| 3   | FAKE-0002    | unmatched_direct_interview | no existing candidate matches this row                                                                             |
| 3   | FAKE-0002    | invalid_score              | must be a whole number from 0 to 10                                                                                |
| 3   | FAKE-0002    | invalid_score              | the five scores must all be present together or all be empty                                                       |

## Sheet: Offers (Offer (Tab 4))

Rows scanned: 2

### Rows needing review

| Row | Candidate ID | Issue code             | Explanation                                            |
| --- | ------------ | ---------------------- | ------------------------------------------------------ |
| 2   | FAKE-0001    | unmatched_candidate    | no existing candidate matches this row                 |
| 2   | FAKE-0001    | unknown_position       | "Dummy Automation Tester" has no approved mapping      |
| 2   | FAKE-0001    | unknown_status         | "Office" has no approved mapping                       |
| 2   | FAKE-0001    | unknown_status         | "Sent" has no approved mapping                         |
| 3   | FAKE-0002    | unmatched_candidate    | no existing candidate matches this row                 |
| 3   | FAKE-0002    | unknown_position       | "Dummy Web Developer" has no approved mapping          |
| 3   | FAKE-0002    | invalid_date           | day/month order is ambiguous; format must be confirmed |
| 3   | FAKE-0002    | missing_required_field | offer date is required                                 |

## Sheet: Employees (Employee lifecycle (Tab 8))

Rows scanned: 1

### Rows needing review

| Row | Candidate ID  | Issue code          | Explanation                            |
| --- | ------------- | ------------------- | -------------------------------------- |
| 2   | FAKE-EXISTING | unmatched_candidate | no existing candidate matches this row |
| 2   | FAKE-EXISTING | unknown_status      | "Intern" has no approved mapping       |
| 2   | FAKE-EXISTING | unknown_status      | "Evaluation" has no approved mapping   |
| 2   | FAKE-EXISTING | unknown_status      | "Active" has no approved mapping       |

## Sheet: Random Notes (unknown)

Rows scanned: 1

### Structure

- `unknown_sheet`: headers match no area of the data map; every row needs review

### Rows needing review

| Row | Candidate ID | Issue code    | Explanation                          |
| --- | ------------ | ------------- | ------------------------------------ |
| 2   | —            | unknown_sheet | row belongs to an unrecognized sheet |

---

This was a **dry run**: no candidate, interview, offer, employee or notification was created, changed or deleted, and no email was sent.
