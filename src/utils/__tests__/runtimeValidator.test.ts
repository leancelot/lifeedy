import { describe, expect, it } from 'vitest';
import {
  MAX_BACKUP_BYTES,
  MAX_IMPORT_COLLECTION_ITEMS,
  MAX_RECEIPT_FILE_BYTES,
  validateAndParseBackupJson,
  validateGitHubRepoSlug,
  validateGitHubUpdateUrl,
  validateReceiptImageFile,
} from '../runtimeValidator';

describe('validateGitHubRepoSlug', () => {
  it('aceita formato owner/repo e normaliza URLs do GitHub', () => {
    expect(validateGitHubRepoSlug('leandro/lifeedy-app')).toEqual({
      ok: true,
      data: 'leandro/lifeedy-app',
    });
    expect(validateGitHubRepoSlug('https://github.com/Leandro-Dev/Lifeedy.git/')).toEqual({
      ok: true,
      data: 'Leandro-Dev/Lifeedy',
    });
  });

  it('rejeita slugs malformados ou com caracteres inválidos', () => {
    expect(validateGitHubRepoSlug('')).toMatchObject({ ok: false });
    expect(validateGitHubRepoSlug('sem-barra')).toMatchObject({ ok: false });
    expect(validateGitHubRepoSlug('owner/repo/extra')).toMatchObject({ ok: false });
    expect(validateGitHubRepoSlug('owner/repo?foo=bar')).toMatchObject({ ok: false });
  });
});

describe('validateGitHubUpdateUrl', () => {
  it('permite URLs HTTPS de domínios oficiais do GitHub', () => {
    expect(
      validateGitHubUpdateUrl('https://github.com/owner/repo/releases/download/v1.0.0/app.apk')
    ).toMatchObject({ ok: true });
    expect(
      validateGitHubUpdateUrl('https://objects.githubusercontent.com/github-production-release-asset/123')
    ).toMatchObject({ ok: true });
    expect(
      validateGitHubUpdateUrl('https://api.github.com/repos/owner/repo/releases/latest')
    ).toMatchObject({ ok: true });
  });

  it('bloqueia HTTP inseguro, domínios externos e URLs inválidas', () => {
    expect(validateGitHubUpdateUrl('')).toMatchObject({ ok: false });
    expect(validateGitHubUpdateUrl('http://github.com/owner/repo/app.apk')).toMatchObject({
      ok: false,
    });
    expect(validateGitHubUpdateUrl('https://evil-cdn.example.com/app.apk')).toMatchObject({
      ok: false,
    });
    expect(validateGitHubUpdateUrl('https://github.com.evil.com/app.apk')).toMatchObject({
      ok: false,
    });
    expect(validateGitHubUpdateUrl('not-a-url')).toMatchObject({ ok: false });
  });
});

describe('validateReceiptImageFile', () => {
  it('aceita imagens JPG, PNG, WEBP e HEIC dentro do limite de tamanho', () => {
    expect(
      validateReceiptImageFile({ name: 'nota.jpg', type: 'image/jpeg', size: 1024 * 500 })
    ).toEqual({ ok: true });
    expect(
      validateReceiptImageFile({ name: 'nota.png', type: 'image/png', size: 1024 })
    ).toEqual({ ok: true });
    expect(
      validateReceiptImageFile({ name: 'foto.webp', type: 'image/webp', size: 2048 })
    ).toEqual({ ok: true });
    expect(
      validateReceiptImageFile({ name: 'foto.heic', type: '', size: 4096 })
    ).toEqual({ ok: true });
  });

  it('rejeita arquivos vazios, gigantes, SVGs e executáveis/MIME não permitidos', () => {
    expect(validateReceiptImageFile({ name: 'vazio.jpg', type: 'image/jpeg', size: 0 })).toMatchObject({
      ok: false,
    });
    expect(
      validateReceiptImageFile({
        name: 'enorme.jpg',
        type: 'image/jpeg',
        size: MAX_RECEIPT_FILE_BYTES + 1,
      })
    ).toMatchObject({ ok: false });
    expect(
      validateReceiptImageFile({ name: 'script.svg', type: 'image/svg+xml', size: 1024 })
    ).toMatchObject({ ok: false });
    expect(
      validateReceiptImageFile({ name: 'payload.apk', type: 'application/vnd.android.package-archive', size: 1024 })
    ).toMatchObject({ ok: false });
    expect(validateReceiptImageFile({ name: 'malware.exe', type: '', size: 1024 })).toMatchObject({
      ok: false,
    });
  });
});

describe('validateAndParseBackupJson', () => {
  it('valida backup válido, calcula checksum e remove chaves de prototype pollution', () => {
    const rawWithProtoPollution = JSON.stringify({
      version: 4,
      userName: 'Maria',
      onboardingCompleted: true,
      tasks: [
        {
          id: 'task-1',
          title: 'Revisar contas',
          completed: false,
          dueDate: '2026-11-20',
          priority: 'high',
          category: 'trabalho',
        },
      ],
      transactions: [],
      financialGoals: [],
      budgetLimits: [],
      draftNotes: [],
    }).replace('"userName":"Maria"', '"__proto__":{"polluted":true},"constructor":{"bad":1},"userName":"Maria"');

    const result = validateAndParseBackupJson(rawWithProtoPollution);
    expect(result.ok).toBe(true);
    expect(result.data?.payload.userName).toBe('Maria');
    expect(result.data?.payload.tasks).toHaveLength(1);
    expect(result.data?.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.data?.payload || {}, 'polluted')).toBe(false);
  });

  it('rejeita JSON vazio, malformado, raiz não-objeto, tipos inválidos ou coleções acima do limite', () => {
    expect(validateAndParseBackupJson('')).toMatchObject({ ok: false });
    expect(validateAndParseBackupJson('{invalido')).toMatchObject({ ok: false });
    expect(validateAndParseBackupJson('[]')).toMatchObject({ ok: false });
    expect(validateAndParseBackupJson(JSON.stringify({ tasks: 'nao-e-array' }))).toMatchObject({
      ok: false,
    });

    const oversizeText = 'a'.repeat(MAX_BACKUP_BYTES + 10);
    expect(validateAndParseBackupJson(oversizeText)).toMatchObject({ ok: false });

    const hugeCollection = JSON.stringify({
      tasks: new Array(MAX_IMPORT_COLLECTION_ITEMS + 1).fill({ id: 't', title: 'x' }),
    });
    expect(validateAndParseBackupJson(hugeCollection)).toMatchObject({ ok: false });
  });
});
