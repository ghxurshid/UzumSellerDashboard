/**
 * Content-script entry: the Copilot launcher and frame on every seller.uzum.uz
 * page. It must stay free of React, zod and `core/src/ui` — this ships on every
 * page load; everything heavy lives in the panel, which is only opened here.
 * The DOM wiring is in `mount.ts`; the rules are in the pure sibling modules.
 */
import { mount } from './mount';

mount();
