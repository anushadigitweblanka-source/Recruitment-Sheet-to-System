import { useState } from 'react';
import { useParams } from 'react-router';
import FormField, { FormGrid } from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { INTERVIEW_HEADER_FIELDS, INTERVIEW_OUTCOME_FIELDS } from './fields.js';
import { MAX_SCORE, MAX_TOTAL, MIN_SCORE, SCORE_CRITERIA, calculateTotal } from './scoring.js';

export default function InterviewEvaluationPage({ page }) {
  const { id } = useParams();
  // Kept in the browser only, to show the total. Nothing is saved.
  const [scores, setScores] = useState({});
  const total = calculateTotal(scores);

  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <Notice>
        Feature not connected yet. The total is worked out on screen, but nothing typed here is
        saved.
      </Notice>

      <FormPanel cancelTo={`/interviews/${id}`}>
        <FormGrid fields={INTERVIEW_HEADER_FIELDS} />

        <fieldset className="form-section">
          <legend>
            Scores ({MIN_SCORE}–{MAX_SCORE} each)
          </legend>
          <div className="form-grid form-grid--scores">
            {SCORE_CRITERIA.map((criterion) => (
              <FormField
                key={criterion.name}
                name={criterion.name}
                label={criterion.label}
                type="number"
                min={MIN_SCORE}
                max={MAX_SCORE}
                step={1}
                inputMode="numeric"
                value={scores[criterion.name] ?? ''}
                onChange={(event) => setScores({ ...scores, [criterion.name]: event.target.value })}
              />
            ))}
          </div>
          <p className="score-total">
            Total: <output>{total ?? '--'}</output> / {MAX_TOTAL}
            <span className="score-total__note">
              Calculated automatically once all five scores are between {MIN_SCORE} and {MAX_SCORE}.
            </span>
          </p>
        </fieldset>

        <FormGrid fields={INTERVIEW_OUTCOME_FIELDS} />
      </FormPanel>
    </>
  );
}
