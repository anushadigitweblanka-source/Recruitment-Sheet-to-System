import { describe, expect, test } from 'vitest';
import { calculateTotal, isValidScore } from '../src/modules/interviews/scoring.js';

const scores = (technical, ai, communication, confidence, cultureFit) => ({
  scoreTechnical: technical,
  scoreAi: ai,
  scoreCommunication: communication,
  scoreConfidence: confidence,
  scoreCultureFit: cultureFit,
});

describe('isValidScore', () => {
  test.each([0, 5, 10, '0', '7', '10'])('accepts %j', (value) => {
    expect(isValidScore(value)).toBe(true);
  });

  test.each([-1, 11, 5.5, '', null, undefined, 'abc', '11', '-1'])('rejects %j', (value) => {
    expect(isValidScore(value)).toBe(false);
  });
});

describe('calculateTotal', () => {
  test('adds the five scores', () => {
    expect(calculateTotal(scores(8, 7, 9, 6, 10))).toBe(40);
  });

  test('works with the text values a form produces', () => {
    expect(calculateTotal(scores('8', '7', '9', '6', '10'))).toBe(40);
  });

  test('is 0 when every score is 0, and 50 when every score is 10', () => {
    expect(calculateTotal(scores(0, 0, 0, 0, 0))).toBe(0);
    expect(calculateTotal(scores(10, 10, 10, 10, 10))).toBe(50);
  });

  test('has no total while any score is missing', () => {
    expect(calculateTotal(scores(8, 7, 9, 6, ''))).toBeNull();
    expect(calculateTotal({})).toBeNull();
  });

  test('has no total when any score is out of range', () => {
    expect(calculateTotal(scores(8, 7, 9, 6, 11))).toBeNull();
    expect(calculateTotal(scores(-1, 7, 9, 6, 10))).toBeNull();
  });
});
