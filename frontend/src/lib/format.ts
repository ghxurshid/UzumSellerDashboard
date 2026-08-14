import { readGeneralPreferences } from '@/store/preferences.store';
import type { Language, Tone, Trend } from '@/types/domain';

/**
 * Number, money and time formatting.
 *
 * Thousands are always grouped with a thin space, as the design writes them in
 * all three locales. The decimal separator, the currency suffix and the
 * timezone come from the user's preferences, so those settings change what is
 * on screen rather than merely being stored.
 */
const THIN_SPACE = ' ';

const CURRENCY_SUFFIX: Record<string, Record<Language, string>> = {
  UZS: { uz: "so'm", ru: 'сум', en: "so'm" },
  USD: { uz: '$', ru: '$', en: '$' },
};

function groupDigits(value: number, fractionDigits = 0): string {
  const { numberFormat } = readGeneralPreferences();

  const grouped = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })
    .format(value)
    .replace(/,/g, THIN_SPACE);

  return numberFormat === 'space-comma' ? grouped.replace('.', ',') : grouped;
}

export function formatNumber(value: number, fractionDigits = 0): string {
  return groupDigits(value, fractionDigits);
}

function currencySuffix(language: Language): string {
  const { currency } = readGeneralPreferences();
  return CURRENCY_SUFFIX[currency]?.[language] ?? CURRENCY_SUFFIX['UZS']![language];
}

export function formatMoney(value: number, language: Language): string {
  return `${groupDigits(value)}${THIN_SPACE}${currencySuffix(language)}`;
}

/** Compact money for KPI tiles — "4.97 mln", matching the design's tile width. */
export function formatCompactMoney(value: number, language: Language): string {
  const millions = value / 1_000_000;
  if (Math.abs(millions) >= 1) {
    return `${groupDigits(millions, 2)}${language === 'ru' ? ' млн' : ' mln'}`;
  }
  const thousands = value / 1_000;
  return `${groupDigits(thousands, 1)}${language === 'ru' ? ' тыс' : ' ming'}`;
}

export function formatPercent(value: number, fractionDigits = 1): string {
  return `${groupDigits(value, fractionDigits)}%`;
}

/** Signed delta as the KPI tiles render it: "+12.4%" / "−3.1%". */
export function formatDelta(value: number, fractionDigits = 1): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${groupDigits(Math.abs(value), fractionDigits)}%`;
}

/* ── time ───────────────────────────────────────────────────────────────── */

/**
 * Every timestamp on screen goes through here, in the configured zone.
 *
 * The API returns epoch milliseconds in UTC; a seller in Tashkent reading a
 * browser set to another zone would otherwise see order times that do not match
 * their own cabinet.
 */
function zonedFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const { timezone } = readGeneralPreferences();
  try {
    return new Intl.DateTimeFormat('en-GB', { ...options, timeZone: timezone });
  } catch {
    /* An unknown zone must not take the screen down with it. */
    return new Intl.DateTimeFormat('en-GB', options);
  }
}

/** `12:45` */
export function formatClock(at: number): string {
  return zonedFormatter({ hour: '2-digit', minute: '2-digit' }).format(new Date(at));
}

/** `10.08 12:45` */
export function formatStamp(at: number): string {
  return zonedFormatter({
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(new Date(at))
    .replace(',', '');
}

/** `10.08` */
export function formatDay(at: number): string {
  return zonedFormatter({ day: '2-digit', month: '2-digit' })
    .format(new Date(at))
    .replace('/', '.');
}

/** The hour of `at` in the configured zone, 0–23. */
export function hourInZone(at: number): number {
  const hour = zonedFormatter({ hour: '2-digit', hour12: false }).format(new Date(at));
  const parsed = Number(hour);
  return Number.isFinite(parsed) ? parsed % 24 : new Date(at).getHours();
}

/** Monday-first weekday index of `at` in the configured zone, 0–6. */
export function weekdayInZone(at: number): number {
  const short = zonedFormatter({ weekday: 'short' }).format(new Date(at));
  const index = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short);
  return index === -1 ? (new Date(at).getDay() + 6) % 7 : index;
}

export function formatDate(value: Date, language: Language): string {
  void language;
  return formatDay(value.getTime());
}

export function trendOf(value: number): Trend {
  if (value > 0) return 'up';
  if (value < 0) return 'down';
  return 'flat';
}

/**
 * Trend → tone. Revenue up is good, returns up is not, so callers pass
 * `invert` for metrics where a rise is a regression.
 */
export function toneOfTrend(trend: Trend, invert = false): Tone {
  if (trend === 'flat') return 'neutral';
  const positive = invert ? trend === 'down' : trend === 'up';
  return positive ? 'positive' : 'negative';
}
