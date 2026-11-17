import { z } from 'zod';

import type { ToolSpec } from '@core/tools/contract';
import { compose, header, pairs } from '@core/tools/plaintext';

import { isRaw, show } from './columns';
import type { ExtToolContext } from './context';
import { readCabinet, signedOutResult, statusPart, unrecognised } from './lookup';

/**
 * `notifications.unread` — how many cabinet notifications the seller has not read.
 *
 * An account lookup: it names no shop and needs only the sign-in.
 *
 * Evidence is the thinnest of any lookup here. The GET itself was never
 * recorded: only its preflight was, and a body `{"unreadCount":1}` that the
 * person who captured it attached as the GET's answer. So the route and the
 * field name are known and nothing else is; whether the count is per account or
 * per shop is not. The notifications themselves cannot be read: the one
 * recorded answer of the list route was an empty body.
 */

export const NOTIFICATIONS_UNREAD_ID = 'notifications.unread';

export const notificationsUnread: ToolSpec<ExtToolContext> = {
  route: 'GET /api/v1/seller/notification/unread-count',
  args: '{}',
  summary: [
    'How many cabinet notifications the seller has not read: one number, read live. It takes no arguments.',
    'What the notifications say cannot be read from here.',
  ],
  schema: z.object({}),

  async run(_args, context) {
    if (!context.session.signedIn) return signedOutResult(NOTIFICATIONS_UNREAD_ID);

    const read = await readCabinet(NOTIFICATIONS_UNREAD_ID, context.signal, [], 'notifications.unread', {});
    if (!read.ok) return read.result;
    const { response } = read;

    const data = response.data;
    if (!isRaw(data) || !Object.hasOwn(data, 'unreadCount')) {
      return unrecognised(NOTIFICATIONS_UNREAD_ID, [], response, 'an object holding unreadCount');
    }

    const count = show(data['unreadCount'], 40);

    return {
      routes: [response.route],
      trace: `unreadCount ${count === '' ? 'not stated' : count}`,
      text: compose([
        header(NOTIFICATIONS_UNREAD_ID, [
          count === '' ? 'unreadCount is null: the response states no number' : null,
          `live from ${response.route}`,
          statusPart(response),
        ]),
        "unreadCount is the response's own field, printed as received · whether it counts the whole account or one shop is not recorded · the notifications themselves cannot be read",
        pairs([['unreadCount', count]]),
      ]),
    };
  },
};
