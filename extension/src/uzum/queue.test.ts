import { describe, expect, it } from 'vitest';

import { QueueCancelled, SerialQueue } from './queue';

function harness(gapMs = 10) {
  let time = 0;
  const sleeps: number[] = [];
  const queue = new SerialQueue({
    gapMs,
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
  });
  return { queue, sleeps, clock: () => time };
}

describe('SerialQueue', () => {
  it('runs one at a time, in order, with a gap', async () => {
    const { queue, sleeps } = harness(10);
    const log: string[] = [];
    const job = (name: string) => async () => {
      log.push(`${name}:start`);
      await Promise.resolve();
      log.push(`${name}:end`);
      return name;
    };
    const signal = new AbortController().signal;
    const all = await Promise.all([
      queue.enqueue(signal, job('a')),
      queue.enqueue(signal, job('b')),
      queue.enqueue(signal, job('c')),
    ]);
    expect(all).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(sleeps).toEqual([10, 10]);
  });

  it('holds the lane for Retry-After after a 429', async () => {
    const { queue, sleeps } = harness(0);
    const signal = new AbortController().signal;
    await queue.enqueue(signal, async () => {
      queue.noteOutcome(true, 7_000);
    });
    await queue.enqueue(signal, async () => 'next');
    expect(sleeps).toEqual([7_000]);
  });

  it('widens the pause while 429s keep coming and relaxes on success', async () => {
    const { queue, sleeps } = harness(0);
    const signal = new AbortController().signal;
    queue.noteOutcome(true);
    await queue.enqueue(signal, async () => queue.noteOutcome(true));
    await queue.enqueue(signal, async () => queue.noteOutcome(false));
    await queue.enqueue(signal, async () => 1);
    expect(sleeps[0]).toBe(2_000);
    expect(sleeps[1]).toBe(4_000);
  });

  it('caps an absurd Retry-After', async () => {
    const { queue, sleeps } = harness(0);
    const signal = new AbortController().signal;
    queue.noteOutcome(true, 99_999_999_999);
    await queue.enqueue(signal, async () => 1);
    expect(sleeps[0]).toBe(10 * 60_000);
  });

  it('rejects a waiting request on abort without running it', async () => {
    const { queue } = harness(0);
    const ran: string[] = [];
    const first = new AbortController();
    const second = new AbortController();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));

    const a = queue.enqueue(first.signal, async () => {
      await gate;
      ran.push('a');
    });
    const b = queue.enqueue(second.signal, async () => {
      ran.push('b');
    });
    second.abort();
    await expect(b).rejects.toBeInstanceOf(QueueCancelled);
    release();
    await a;
    expect(ran).toEqual(['a']);
  });

  it('rejects at once when already aborted', async () => {
    const { queue } = harness();
    const controller = new AbortController();
    controller.abort();
    await expect(queue.enqueue(controller.signal, async () => 1)).rejects.toBeInstanceOf(QueueCancelled);
  });
});
