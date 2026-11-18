import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildErrorReportMailtoUrl,
  clearErrorJournal,
  exportErrorJournalText,
  getErrorJournal,
  recordAppError,
  sanitizeDiagnosticText,
} from '../errorJournalService';

describe('errorJournalService', () => {
  beforeEach(() => {
    clearErrorJournal();
  });

  it('redacts tokens, emails, and monetary values from diagnostic messages', () => {
    const raw =
      'Failed for user@example.com with Bearer ya29.abc123token and ghp_secret999 on R$ 1.250,00';
    const clean = sanitizeDiagnosticText(raw);

    expect(clean).not.toContain('user@example.com');
    expect(clean).not.toContain('ya29.abc123token');
    expect(clean).not.toContain('ghp_secret999');
    expect(clean).not.toContain('1.250,00');
    expect(clean).toContain('[EMAIL]');
    expect(clean).toContain('[TOKEN]');
    expect(clean).toContain('R$ [VALOR]');
  });

  it('records, exports, and builds mailto diagnostics without sensitive data', () => {
    recordAppError('TestSource', new Error('Falha para teste@email.com'), 'screen=finance');
    const list = getErrorJournal();
    expect(list).toHaveLength(1);
    expect(list[0].message).toContain('[EMAIL]');

    const exported = exportErrorJournalText({
      appVersion: 'v1.1.0',
      buildNumber: 42,
      distributionChannel: 'githubApk',
    });
    expect(exported).toContain('LIFEEDY - DIÁRIO DE DIAGNÓSTICO');
    expect(exported).toContain('TestSource');

    const mailto = buildErrorReportMailtoUrl({ appVersion: 'v1.1.0', buildNumber: 42 });
    expect(mailto.startsWith('mailto:?subject=')).toBe(true);
  });
});
