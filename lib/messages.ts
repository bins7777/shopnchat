type ParsedMessageBody =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'file'; url: string }
  | { kind: 'unknown'; raw: string };

const HTTP_PATTERN = /^https?:\/\//i;

export const parseMessageBody = (body: string | null | undefined): ParsedMessageBody => {
  const payload = (body ?? '').trim();
  if (!payload) {
    return { kind: 'text', text: '' };
  }

  const separatorIndex = payload.indexOf(':');
  if (separatorIndex > 0) {
    const prefix = payload.slice(0, separatorIndex);
    const rest = payload.slice(separatorIndex + 1).trim();

    if (rest && HTTP_PATTERN.test(rest)) {
      if (prefix === 'image') {
        return { kind: 'image', url: rest };
      }
      if (prefix === 'video') {
        return { kind: 'video', url: rest };
      }
      if (prefix === 'file') {
        return { kind: 'file', url: rest };
      }
    }
  }

  return { kind: 'text', text: payload };
};

export const describeMessagePreview = (body: string | null | undefined): string => {
  const parsed = parseMessageBody(body);

  switch (parsed.kind) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Video';
    case 'file':
      return '📎 Attachment';
    case 'text':
      return parsed.text;
    default:
      return parsed.raw ?? '';
  }
};
