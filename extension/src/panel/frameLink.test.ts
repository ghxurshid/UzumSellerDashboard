import { describe, expect, it } from 'vitest';

import { applyVisibility, type FrameLinkState } from './frameLink';

const start: FrameLinkState = { open: true, signals: 0, opens: 0 };

describe('applyVisibility', () => {
  it('counts every message as a signal and only shown-messages as opens', () => {
    const shown = applyVisibility(start, true);
    expect(shown).toEqual({ open: true, signals: 1, opens: 1 });

    const hidden = applyVisibility(shown, false);
    expect(hidden).toEqual({ open: false, signals: 2, opens: 1 });

    expect(applyVisibility(hidden, true)).toEqual({ open: true, signals: 3, opens: 2 });
  });
});
