import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForGitHubUpdates,
  compareVersions,
  normalizeGitHubRepo,
  parseSemVer,
} from '../githubUpdateService';

function mockJsonResponse(status: number, body: any): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('githubUpdateService helpers', () => {
  it('normaliza URLs e caminhos de repositório do GitHub', () => {
    expect(normalizeGitHubRepo('https://github.com/souoleandro/meu-vida-organizada/')).toBe(
      'souoleandro/meu-vida-organizada'
    );
    expect(normalizeGitHubRepo('souoleandro/meu-vida-organizada.git')).toBe(
      'souoleandro/meu-vida-organizada'
    );
    expect(normalizeGitHubRepo('  souoleandro/app-teste  ')).toBe('souoleandro/app-teste');
  });

  it('compara versões SemVer e sufixos -build.N corretamente', () => {
    expect(parseSemVer('v1.1.0')).toEqual([1, 1, 0, 0]);
    expect(parseSemVer('v1.1.0-build.14')).toEqual([1, 1, 0, 14]);
    expect(compareVersions('v1.1.0-build.14', 'v1.1.0')).toBe(1);
    expect(compareVersions('v1.1.0-build.14', 'v1.1.0-build.14')).toBe(0);
    expect(compareVersions('v1.2.0', 'v1.1.0-build.99')).toBe(1);
    expect(compareVersions('build-25', 'build-10')).toBe(1);
  });
});

describe('checkForGitHubUpdates', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('detecta APK em pre-release ou release com tag -build.N', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/releases')) {
        return mockJsonResponse(200, [
          {
            id: 1,
            tag_name: 'v1.1.0-build.18',
            name: 'Build #18',
            body: 'APK gerado no Actions',
            published_at: '2026-11-15T10:00:00Z',
            html_url: 'https://github.com/user/repo/releases/tag/v1.1.0-build.18',
            prerelease: true,
            draft: false,
            assets: [
              {
                id: 99,
                name: 'VidaOrganizada-v1.1.0-build.18.apk',
                size: 12_500_000,
                download_count: 1,
                browser_download_url:
                  'https://github.com/user/repo/releases/download/v1.1.0-build.18/app.apk',
                url: 'https://api.github.com/repos/user/repo/releases/assets/99',
                content_type: 'application/vnd.android.package-archive',
              },
            ],
          },
        ]);
      }
      if (url.includes('/actions/runs')) {
        return mockJsonResponse(200, { workflow_runs: [] });
      }
      return mockJsonResponse(200, []);
    }) as typeof fetch;

    const result = await checkForGitHubUpdates('user/repo', undefined, 'v1.1.0', {
      currentBuildNumber: 12,
      currentCommitSha: 'abc1234',
      currentBuiltAt: '2026-11-14T10:00:00Z',
    });

    expect(result.error).toBeUndefined();
    expect(result.hasUpdate).toBe(true);
    expect(result.updateSource).toBe('release');
    expect(result.latestVersion).toBe('v1.1.0-build.18');
    expect(result.apkAsset?.name).toBe('VidaOrganizada-v1.1.0-build.18.apk');
  });

  it('detecta APK compilado no GitHub Actions quando não existe Release publicada', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/releases')) {
        return mockJsonResponse(200, []);
      }
      if (url.endsWith('/artifacts')) {
        return mockJsonResponse(200, {
          artifacts: [
            {
              id: 501,
              name: 'VidaOrganizada-APK',
              size_in_bytes: 14_000_000,
              expired: false,
              archive_download_url:
                'https://api.github.com/repos/user/repo/actions/artifacts/501/zip',
            },
          ],
        });
      }
      if (url.includes('/actions/runs')) {
        return mockJsonResponse(200, {
          workflow_runs: [
            {
              id: 777,
              run_number: 21,
              name: 'Build Android APK',
              conclusion: 'success',
              head_branch: 'main',
              head_sha: 'def5678901234',
              html_url: 'https://github.com/user/repo/actions/runs/777',
              created_at: '2026-11-15T11:00:00Z',
              updated_at: '2026-11-15T11:05:00Z',
            },
          ],
        });
      }
      return mockJsonResponse(200, []);
    }) as typeof fetch;

    const result = await checkForGitHubUpdates('user/repo', undefined, 'v1.1.0', {
      currentBuildNumber: 19,
      currentCommitSha: 'oldsha111',
      currentBuiltAt: '2026-11-14T10:00:00Z',
    });

    expect(result.error).toBeUndefined();
    expect(result.hasUpdate).toBe(true);
    expect(result.updateSource).toBe('actions_artifact');
    expect(result.latestVersion).toBe('Build #21');
    expect(result.latestBuild?.artifactName).toBe('VidaOrganizada-APK');
  });

  it('informa erro claro quando o repositório não existe ou está vazio em vez de dizer atualizado', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/commits')) {
        return mockJsonResponse(409, { message: 'Git Repository is empty.' });
      }
      if (url.includes('/releases')) {
        return mockJsonResponse(200, []);
      }
      return mockJsonResponse(200, { workflow_runs: [] });
    }) as typeof fetch;

    const result = await checkForGitHubUpdates('souoleandro/meu-vida-organizada', undefined, 'v1.1.0');
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toContain('vazio');
  });
});
