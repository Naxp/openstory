import { getRealtime } from '@/lib/realtime';
import { createServerFn } from '@tanstack/react-start';
import { zodValidator } from '@tanstack/zod-adapter';
import { z } from 'zod';

const channelInputSchema = z.object({ channel: z.string().min(1) });

/**
 * Fetches the most recent event from an Upstash Realtime channel's history.
 * Used to restore generation progress state after page refresh.
 */
export const getChannelLastEventFn = createServerFn({ method: 'GET' })
  .inputValidator(zodValidator(channelInputSchema))
  .handler(async ({ data }) => {
    const realtime = getRealtime();
    const messages = await realtime.channel(data.channel).history({
      limit: 1,
    });

    if (messages.length === 0) return null;

    const last = messages[messages.length - 1];
    // Serialize data to string — last.data is `unknown` which the framework
    // rejects in return types. The client parses it back.
    return {
      id: last.id,
      event: last.event,
      channel: last.channel,
      data: JSON.stringify(last.data),
    };
  });
