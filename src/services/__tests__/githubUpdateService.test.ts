import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkForGitHubUpdates,
  compareVersions,
  DEFAULT_GITHUB_REPO,
  normalizeGitHubRepo,
  parseSemVer,
  resolveInstallableUpdateTarget,
  shouldRunAutoUpdateCheck,
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
  it('usa leancelot/lifeedy como repositório padrão', () => {
    expect(DEFAULT_GITHUB_REPO).toBe('leancelot/lifeedy');
  });

  it('normaliza URLs e caminhos de repositório do GitHub', () => {
    expect(normalizeGitHubRepo('https://github.com/leancelot/lifeedy/')).toBe(
      'leancelot/lifeedy'
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

  it('detecta APK Lifeedy em pre-release ou release com tag -build.N', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/releases')) {
        return mockJsonResponse(200, [
          {
            id: 1,
            tag_name: 'v1.1.0-build.18',
            name: 'Lifeedy Build #18',
            body: 'APK gerado no Actions',
            published_at: '2026-11-15T10:00:00Z',
            html_url: 'https://github.com/leancelot/lifeedy/releases/tag/v1.1.0-build.18',
            prerelease: true,
            draft: false,
            assets: [
              {
                id: 99,
                name: 'Lifeedy-v1.1.0-build.18.apk',
                size: 12_500_000,
                download_count: 1,
                browser_download_url:
                  'https://github.com/leancelot/lifeedy/releases/download/v1.1.0-build.18/app.apk',
                url: 'https://api.github.com/repos/leancelot/lifeedy/releases/assets/99',
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

    const result = await checkForGitHubUpdates('leancelot/lifeedy', undefined, 'v1.1.0', {
      currentBuildNumber: 12,
      currentCommitSha: 'abc1234',
      currentBuiltAt: '2026-11-14T10:00:00Z',
    });

    expect(result.error).toBeUndefined();
    expect(result.hasUpdate).toBe(true);
    expect(result.updateSource).toBe('release');
    expect(result.latestVersion).toBe('v1.1.0-build.18');
    expect(result.apkAsset?.name).toBe('Lifeedy-v1.1.0-build.18.apk');
  });

  it('detecta artefato Lifeedy-APK no GitHub Actions quando não existe Release publicada', async () => {
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
              name: 'Lifeedy-APK',
              size_in_bytes: 14_000_000,
              expired: false,
              archive_download_url:
                'https://api.github.com/repos/leancelot/lifeedy/actions/artifacts/501/zip',
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
              html_url: 'https://github.com/leancelot/lifeedy/actions/runs/777',
              created_at: '2026-11-15T11:00:00Z',
              updated_at: '2026-11-15T11:05:00Z',
            },
          ],
        });
      }
      return mockJsonResponse(200, []);
    }) as typeof fetch;

    const result = await checkForGitHubUpdates('leancelot/lifeedy', undefined, 'v1.1.0', {
      currentBuildNumber: 19,
      currentCommitSha: 'oldsha111',
      currentBuiltAt: '2026-11-14T10:00:00Z',
    });

    expect(result.error).toBeUndefined();
    expect(result.hasUpdate).toBe(true);
    expect(result.updateSource).toBe('actions_artifact');
    expect(result.latestVersion).toBe('Build #21');
    expect(result.latestBuild?.artifactName).toBe('Lifeedy-APK');
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

  it('resolveInstallableUpdateTarget prioriza APK direto da Release e usa Actions zip quando há token', () => {
    const releaseTarget = resolveInstallableUpdateTarget({
      hasUpdate: true,
      repo: 'leancelot/lifeedy',
      currentVersion: 'v1.1.0',
      apkAsset: {
        id: 1,
        name: 'Lifeedy-v1.1.0-build.18.apk',
        size: 12_000_000,
        download_count: 2,
        browser_download_url: 'https://github.com/leancelot/lifeedy/releases/download/v1.1.0-build.18/app.apk',
        api_url: 'https://api.github.com/repos/leancelot/lifeedy/releases/assets/1',
        content_type: 'application/vnd.android.package-archive',
      },
      recentCommits: [],
      repoUrl: 'https://github.com/leancelot/lifeedy',
      actionsUrl: 'https://github.com/leancelot/lifeedy/actions',
      releasesUrl: 'https://github.com/leancelot/lifeedy/releases',
      checkedAt: '2026-11-17T10:00:00Z',
    });
    expect(releaseTarget?.kind).toBe('release_apk');
    expect(releaseTarget?.needsToken).toBe(false);
    expect(releaseTarget?.url).toContain('releases/download');

    const artifactTarget = resolveInstallableUpdateTarget(
      {
        hasUpdate: true,
        repo: 'leancelot/lifeedy',
        currentVersion: 'v1.1.0',
        latestBuild: {
          id: 77,
          runNumber: 22,
          name: 'Build Android APK',
          headBranch: 'main',
          headSha: 'abc1234',
          shortSha: 'abc1234',
          htmlUrl: 'https://github.com/leancelot/lifeedy/actions/runs/77',
          createdAt: '2026-11-17T10:00:00Z',
          updatedAt: '2026-11-17T10:05:00Z',
          artifactName: 'Lifeedy-APK',
          artifactId: 900,
          artifactSize: 13_000_000,
          artifactDownloadUrl: 'https://api.github.com/repos/leancelot/lifeedy/actions/artifacts/900/zip',
        },
        recentCommits: [],
        repoUrl: 'https://github.com/leancelot/lifeedy',
        actionsUrl: 'https://github.com/leancelot/lifeedy/actions',
        releasesUrl: 'https://github.com/leancelot/lifeedy/releases',
        checkedAt: '2026-11-17T10:00:00Z',
      },
      'ghp_token'
    );
    expect(artifactTarget?.kind).toBe('actions_artifact_zip');
    expect(artifactTarget?.needsToken).toBe(true);
    expect(artifactTarget?.fileName).toBe('Lifeedy-APK.zip');
  });

  it('shouldRunAutoUpdateCheck respeita intervalo mínimo entre verificações', () => {
    const now = new Date('2026-11-17T12:00:00Z').getTime();
    expect(shouldRunAutoUpdateCheck(undefined, 30 * 60_000, now)).toBe(true);
    expect(shouldRunAutoUpdateCheck('2026-11-17T11:45:00Z', 30 * 60_000, now)).toBe(false);
    expect(shouldRunAutoUpdateCheck('2026-11-17T11:20:00Z', 30 * 60_000, now)).toBe(true);
  });
});
