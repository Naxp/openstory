import { describe, expect, it } from 'vitest';

import {
  getLocalRealtimeHistory,
  recordLocalRealtimeMessage,
  subscribeLocalRealtime,
} from '@/lib/realtime/local-channel';

describe('local realtime channel', () => {
  it('returns copied history entries and increments per-channel ids', () => {
    const channel = `local-realtime-copy-${crypto.randomUUID()}`;

    recordLocalRealtimeMessage(channel, 'alpha', { hello: 'world' });
    recordLocalRealtimeMessage(channel, 'beta', 'ping');

    const history = getLocalRealtimeHistory(channel);
    expect(history).toHaveLength(2);
    expect(history[0]?.id).toBe('1');
    expect(history[0]?.event).toBe('alpha');
    expect(history[0]?.data).toBe('{"hello":"world"}');
    expect(history[1]?.id).toBe('2');
    expect(history[1]?.data).toBe('ping');

    const snapshot = getLocalRealtimeHistory(channel);
    snapshot.push({
      id: 'x',
      event: 'intrusion',
      channel,
      data: 'bad',
    });

    expect(getLocalRealtimeHistory(channel)).toHaveLength(2);
  });

  it('broadcasts live events and removes throwing listeners', () => {
    const channel = `local-realtime-listener-${crypto.randomUUID()}`;
    let goodCalls = 0;
    let badCalls = 0;

    const unsubscribeGood = subscribeLocalRealtime(channel, () => {
      goodCalls += 1;
    });
    const unsubscribeBad = subscribeLocalRealtime(channel, () => {
      badCalls += 1;
      throw new Error('listener-fail');
    });

    recordLocalRealtimeMessage(channel, 'first', { stage: 'boot' });
    expect(goodCalls).toBe(1);
    expect(badCalls).toBe(1);

    recordLocalRealtimeMessage(channel, 'second', { stage: 'ready' });
    expect(goodCalls).toBe(2);
    expect(badCalls).toBe(1);

    unsubscribeGood();
    unsubscribeBad();
  });
});
