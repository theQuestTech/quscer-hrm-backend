import { jurisdictionOf } from './jurisdiction';

describe('jurisdictionOf', () => {
  const branch = { countryCode: 'PK', regionCode: 'SD' };

  it("uses the employee's own country and province/state", () => {
    expect(jurisdictionOf({ countryCode: 'PK', regionCode: 'PB', branch })).toEqual({ countryCode: 'PK', regionCode: 'PB' });
  });

  it("takes the branch's province/state when the employee has none", () => {
    expect(jurisdictionOf({ countryCode: 'PK', regionCode: null, branch })).toEqual({ countryCode: 'PK', regionCode: 'SD' });
  });

  it('never mixes a region from another country', () => {
    expect(jurisdictionOf({ countryCode: 'AE', regionCode: null, branch })).toEqual({ countryCode: 'AE', regionCode: null });
  });

  it('falls back to the branch entirely', () => {
    expect(jurisdictionOf({ countryCode: null, regionCode: null, branch })).toEqual(branch);
  });

  it('has nothing without either', () => {
    expect(jurisdictionOf({ countryCode: null, regionCode: null, branch: null })).toEqual({ countryCode: null, regionCode: null });
  });
});
