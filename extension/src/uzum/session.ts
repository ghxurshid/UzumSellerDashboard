/**
 * What the cabinet's own `localStorage` says about the signed-in seller.
 *
 * Evidence: ONE sample of the `state` key, with secrets replaced. In it the
 * keys of `user.permissions` are the shop ids the account can act on and each
 * value is that shop's permission codes. `tokens.accessExpiration` has an
 * unknown unit and meaning, so nothing here reads it — a stale token shows up
 * as a 401 from the API, which is the honest signal.
 *
 * `SellerSession` is the part the panel may know. The token is parsed in the
 * same pass but returned separately, and only the content script ever holds it.
 * This file imports nothing, so it can sit in the content script.
 */

export interface SellerSession {
  readonly signedIn: boolean;
  readonly shopIds: readonly number[];
  /** The shop the cabinet page is showing, when the URL names one of shopIds; otherwise null. */
  readonly currentShopId: number | null;
  readonly sellerId: number | null;
  readonly accountId: number | null;
  readonly permissions: Readonly<Record<number, readonly string[]>>;
}

export interface CabinetState {
  readonly session: SellerSession;
  /** Never leaves the content script. */
  readonly token: string | null;
}

/** The cabinet's storage key (from the one sample). */
export const CABINET_STATE_KEY = 'state';

export const SIGNED_OUT: SellerSession = Object.freeze({
  signedIn: false,
  shopIds: Object.freeze([] as number[]),
  currentShopId: null,
  sellerId: null,
  accountId: null,
  permissions: Object.freeze({}),
});

const ID_PATTERN = /^[1-9]\d*$/;
/* Visible ASCII only: a space or newline would make `fetch` throw on the header,
   and an already-prefixed "Bearer x" must not be sent twice. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function currentShopFromPath(pathname: string, shopIds: readonly number[]): number | null {
  for (const segment of pathname.split('/')) {
    if (!ID_PATTERN.test(segment)) continue;
    const candidate = Number(segment);
    if (shopIds.includes(candidate)) return candidate;
  }
  return null;
}

/**
 * Read the raw `state` string. Anything unreadable — missing key, bad JSON, no
 * `user`, no usable token — is "signed out": the safe answer, because every
 * request would be refused for lack of a token anyway.
 */
export function parseCabinetState(raw: string | null, pathname: string): CabinetState {
  const signedOut: CabinetState = { session: SIGNED_OUT, token: null };
  if (raw === null || raw === '') return signedOut;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return signedOut;
  }

  const user = asRecord(asRecord(parsed)?.['user']);
  if (user === null) return signedOut;

  const access = asRecord(user['tokens'])?.['access'];
  if (typeof access !== 'string' || !TOKEN_PATTERN.test(access)) return signedOut;

  const permissions: Record<number, string[]> = {};
  const shopIds: number[] = [];
  const rawPermissions = asRecord(user['permissions']);
  if (rawPermissions !== null) {
    for (const [key, value] of Object.entries(rawPermissions)) {
      /* Non-numeric keys are not shops; whatever they hold is ignored. */
      if (!ID_PATTERN.test(key)) continue;
      const shopId = Number(key);
      if (!Number.isSafeInteger(shopId)) continue;
      shopIds.push(shopId);
      permissions[shopId] = Array.isArray(value)
        ? value.filter((code): code is string => typeof code === 'string')
        : [];
    }
  }
  shopIds.sort((a, b) => a - b);

  return {
    token: access,
    session: {
      signedIn: true,
      shopIds,
      /* Assumption: a numeric path segment naming one of the account's shops
         means that shop is on screen. The cabinet's URL scheme is not recorded. */
      currentShopId: currentShopFromPath(pathname, shopIds),
      sellerId: asId(user['sellerId']),
      accountId: asId(user['accountId']),
      permissions,
    },
  };
}

/** Read fresh from storage on every call; a refreshed token is picked up without a reload. */
export function readCabinetState(
  storage: { getItem(key: string): string | null },
  pathname: string,
): CabinetState {
  let raw: string | null;
  try {
    raw = storage.getItem(CABINET_STATE_KEY);
  } catch {
    /* Storage can throw (blocked, sandboxed frame); that is just "no session". */
    raw = null;
  }
  return parseCabinetState(raw, pathname);
}
