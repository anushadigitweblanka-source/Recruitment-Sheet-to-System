# Offer Management — automatic offer on "Selected" (built 2026-10-15, uncommitted pending review)

The task guide's acceptance checklist requires: _selecting "Selected" in the direct interview must create an offer row automatically._ That now happens. (The rest of Module 4 is documented in `backend/src/modules/offers/README.md`.)

## What happens on Selected

Saving a direct interview with decision **Selected** — on first save or by a later edit — does all of this in **one transaction**:

1. saves the interview,
2. moves the pipeline to **Selected** (through the shared pipeline helper: `pipeline_status`, `stage_history` and the audit log stay in step),
3. creates **exactly one** offer row if the candidate has none.

The automatic row holds only what is already known: the candidate and their **applied position**. Offer date, work mode, location, offer status, onboarding date and attendance stay empty until someone records them. **Nothing is invented, and no salary exists anywhere.** It is audited as `OFFER_CREATE` on the offer, with `details.source = "direct_interview"`.

If any step is refused, the whole save rolls back — an offer can never exist without its interview decision, or the other way round.

## Duplicate protection

- First Selected save → one offer.
- Saving Selected again, editing scores later, or a retried request → still one offer (the outcome only acts when it changes, the creation checks for an existing offer first, and the pipeline row lock serialises concurrent saves).
- Recording a second interview for the candidate → refused (409), still one offer.
- Creating a manual offer afterwards → refused as already existing (409).

## The one edge: no applied position

`offers.position_id` cannot be empty, and a candidate's applied position is optional. A candidate **without** an applied position gets **no automatic row** — choosing a position for them would be inventing data. They land at Selected and appear as **waiting** in the Offer Tracker, where the Create Offer form (which requires choosing a position) covers them exactly as before.

## The offer is never deleted automatically

Once the offer exists, changing the interview's decision away from Selected is **refused** (pre-existing rule, now also covering automatic offers) — so the question "should the offer be deleted if the interview changes?" cannot arise in practice. Whether that refusal should ever be relaxed (and what would happen to the offer) **requires mentor confirmation**; until then the offer stays and the interview is locked.

## Frontend

No structural change was needed: the Offer Tracker already lists every candidate with an offer (the automatic one appears with its position and empty fields) and every Selected candidate still waiting. The interview evaluation screen's hint now says that Selected also creates the offer automatically.
