// The approved source-word mappings, mirroring data-maps/status-value-mapping.md.
// NOTHING IS APPROVED YET: every map is empty, so every workbook status word
// goes to review (unknown_status) - never silently normalized. When HR and
// the mentor approve a spelling in the data-map file, it is added here with
// the same wording, lowercased, e.g. phoneResult: { 'selected': 'selected' }.

export function loadApprovedMappings() {
  return {
    companyCvStatus: {},
    phoneResponse: {},
    phoneResult: {},
    attendance: {},
    interviewDecision: {},
    workMode: {},
    offerStatus: {},
    track: {},
    phase: {},
    employeeStatus: {},
    pipelineStage: {},
  };
}
