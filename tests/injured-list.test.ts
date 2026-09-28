import { describe, expect, it } from 'vitest';
import { addDays, injuredListReturn, injuredSince } from '../supabase/functions/_shared/core/injured-list.ts';

// Real MLB /transactions entries, trimmed to the fields read.
const judge = [
  { typeCode: 'SC', date: '2026-09-07', effectiveDate: '2026-09-07', description: 'New York Yankees activated RF Aaron Judge from the 60-day injured list.' },
  { typeCode: 'NUM', date: '2026-09-16', effectiveDate: '2026-09-16', description: 'RF Aaron Judge changed number to 99.' },
  {
    typeCode: 'SC',
    date: '2026-09-19',
    effectiveDate: '2026-09-17',
    description: 'New York Yankees placed RF Aaron Judge on the 10-day injured list retroactive to September 17, 2026. Right calf strain.',
  },
];

describe('injuredSince', () => {
  it('is the day his latest placement is backdated to', () => {
    expect(injuredSince(judge)).toBe('2026-09-17');
  });

  it('keeps the first day when he moves from the 15-day to the 60-day list', () => {
    expect(
      injuredSince([
        { typeCode: 'SC', date: '2026-08-01', effectiveDate: '2026-07-30', description: 'Houston Astros placed SS Carlos Correa on the 15-day injured list retroactive to July 30, 2026.' },
        { typeCode: 'SC', date: '2026-08-20', effectiveDate: '2026-08-20', description: 'Houston Astros transferred SS Carlos Correa from the 15-day injured list to the 60-day injured list.' },
      ]),
    ).toBe('2026-07-30');
  });

  it('is null without a placement', () => {
    expect(injuredSince(judge.slice(0, 2))).toBeNull();
    expect(injuredSince([])).toBeNull();
  });
});

describe('injuredListReturn', () => {
  it('counts the list’s days from the day he went on it', () => {
    expect(addDays('2026-09-17', 10)).toBe('2026-09-27');
    expect(addDays('2026-09-09', 60)).toBe('2026-11-08');
    expect(injuredListReturn(10, '2026-09-17', '2026-09-27', '2026-10-31')).toEqual({ returnOn: '2026-09-27', inTime: true });
  });

  it('leaves out a hitter who can’t come off it before the postseason ends', () => {
    expect(injuredListReturn(60, '2026-09-09', '2026-09-27', '2026-10-31')).toEqual({ returnOn: '2026-11-08', inTime: false });
    expect(injuredListReturn(60, '2026-09-01', '2026-09-27', '2026-10-31')).toEqual({ returnOn: '2026-10-31', inTime: true });
  });

  it('counts an unknown start as today', () => {
    expect(injuredListReturn(15, null, '2026-09-27', '2026-10-31')).toEqual({ returnOn: null, inTime: true });
    expect(injuredListReturn(60, null, '2026-09-27', '2026-10-31')).toEqual({ returnOn: null, inTime: false });
  });

  it('takes everyone before the postseason schedule is out', () => {
    expect(injuredListReturn(60, null, '2026-09-27', null).inTime).toBe(true);
  });
});
