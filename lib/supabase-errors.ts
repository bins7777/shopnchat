import type { PostgrestError } from '@supabase/supabase-js';

const ERROR_TEXT_KEYS = ['message', 'details', 'hint'] as const;

const MISSING_COLUMN_PATTERNS = [
  /column\s+(?:"?[\w]+"?\.)?"?([a-zA-Z0-9_]+)"?\s+does not exist/i,
  /missing\s+column\s*[:=\s]\s*"?(?<column>[a-zA-Z0-9_]+)"?/i,
  /unknown\s+column\s*"?(?<column>[a-zA-Z0-9_]+)"?/i,
  /column\s*"?(?<column>[a-zA-Z0-9_]+)"?\s+not\s+found/i,
] as const;

const normaliseErrorParts = (error: unknown): string[] => {
  if (!error || typeof error !== 'object') {
    return [];
  }

  const postgrest = error as Partial<PostgrestError>;

  return ERROR_TEXT_KEYS.reduce<string[]>((parts, key) => {
    const value = postgrest[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        parts.push(trimmed);
      }
    }
    return parts;
  }, []);
};

export const extractMissingColumnName = (error: unknown): string | null => {
  const candidates = normaliseErrorParts(error);

  for (const text of candidates) {
    for (const pattern of MISSING_COLUMN_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const column =
          (match.groups?.column ?? match[1] ?? '').toString().trim().toLowerCase();
        if (column.length > 0) {
          return column;
        }
      }
    }
  }

  return null;
};

export const isMissingColumnError = (error: unknown, column: string): boolean =>
  extractMissingColumnName(error) === column.toLowerCase();
