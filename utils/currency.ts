const formatterCache = new Map<string, Intl.NumberFormat>();

const getFormatter = (currency: string) => {
  if (!formatterCache.has(currency)) {
    try {
      formatterCache.set(
        currency,
        new Intl.NumberFormat('en-PH', {
          style: 'currency',
          currency,
          minimumFractionDigits: 2,
        }),
      );
    } catch {
      formatterCache.set(
        currency,
        new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
        }),
      );
    }
  }
  return formatterCache.get(currency)!;
};

export const formatCurrency = (valueInCents: number, currency = 'PHP') => {
  const formatter = getFormatter(currency.toUpperCase());
  return formatter.format((valueInCents ?? 0) / 100);
};

const CLEAN_PRICE_PATTERN = /[^0-9.,]/g;

export const parsePriceInput = (value: string): number => {
  if (!value) {
    return 0;
  }

  const cleaned = value.replace(CLEAN_PRICE_PATTERN, '');
  if (!cleaned) {
    return 0;
  }

  const normalised = cleaned.replace(/,/g, '');
  const parsed = Number.parseFloat(normalised);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed * 100));
};
