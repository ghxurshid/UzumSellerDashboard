import { describe, expect, it } from 'vitest';

import { hostRequestFor } from './hostAccess';

describe('hostRequestFor', () => {
  it('asks for the origin of an https gateway, without path or port', () => {
    expect(hostRequestFor('https://llm.example.com/v1')).toEqual({
      pattern: 'https://llm.example.com/*',
      label: 'llm.example.com',
    });
    expect(hostRequestFor('https://llm.example.com:8443/v1')).toEqual({
      pattern: 'https://llm.example.com/*',
      label: 'llm.example.com:8443',
    });
  });

  it('allows plain http only for loopback, which the manifest lists as optional', () => {
    expect(hostRequestFor('http://localhost:11434/v1')).toEqual({
      pattern: 'http://localhost/*',
      label: 'localhost:11434',
    });
    expect(hostRequestFor('http://127.0.0.1:8080')?.pattern).toBe('http://127.0.0.1/*');
    expect(hostRequestFor('http://192.168.1.5:8080/v1')).toBeNull();
    expect(hostRequestFor('http://llm.example.com/v1')).toBeNull();
  });

  it('returns null for anything that is not a usable URL', () => {
    expect(hostRequestFor('')).toBeNull();
    expect(hostRequestFor('not a url')).toBeNull();
    expect(hostRequestFor('ftp://example.com')).toBeNull();
    expect(hostRequestFor('  https://x.example/v1  ')?.pattern).toBe('https://x.example/*');
  });
});
