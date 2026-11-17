export interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
  api_url?: string;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface GitHubWorkflowBuild {
  id: number;
  runNumber: number;
  name: string;
  headBranch: string;
  headSha: string;
  shortSha: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  artifactName?: string;
  artifactSize?: number;
  artifactId?: number;
  artifactDownloadUrl?: string;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  authorAvatar?: string;
  date: string;
  url: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  updateSource?: 'release' | 'actions_artifact';
  repo: string;
  currentVersion: string;
  currentBuildNumber?: number;
  latestVersion?: string;
  latestRelease?: GitHubRelease;
  apkAsset?: GitHubReleaseAsset;
  latestBuild?: GitHubWorkflowBuild;
  recentCommits: GitHubCommit[];
  repoUrl: string;
  actionsUrl: string;
  releasesUrl: string;
  checkedAt: string;
  error?: string;
}

export interface CheckGitHubUpdatesOptions {
  currentBuildNumber?: number;
  currentCommitSha?: string;
  currentBuiltAt?: string;
}

export const CURRENT_APP_VERSION = 'v1.1.0';

const ENV_GITHUB_REPO = (
  (import.meta as any).env?.VITE_GITHUB_REPO as string | undefined
)?.trim() || '';

export const DEFAULT_GITHUB_REPO = ENV_GITHUB_REPO || 'leancelot/lifeedy';

export const CURRENT_BUILD_NUMBER = (() => {
  const raw = ((import.meta as any).env?.VITE_APP_BUILD_NUMBER as string | undefined) || '';
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
})();

export const CURRENT_COMMIT_SHA = (
  ((import.meta as any).env?.VITE_APP_COMMIT_SHA as string | undefined) || ''
).trim();

export const CURRENT_BUILT_AT = (
  ((import.meta as any).env?.VITE_APP_BUILT_AT as string | undefined) || ''
).trim();

const STORAGE_KEYS = {
  REPO: 'vo_github_repo',
  TOKEN: 'vo_github_token',
  AUTO_CHECK: 'vo_github_auto_check',
  LAST_RESULT: 'vo_github_last_result',
  DISMISSED_VERSION: 'vo_dismissed_update_version',
  LAST_NATIVE_BUILD: 'vo_last_seen_native_build',
};

export interface InstallableUpdateTarget {
  kind: 'release_apk' | 'actions_artifact_zip' | 'external_page';
  url: string;
  fileName: string;
  size: number;
  needsToken: boolean;
}

export const AUTO_UPDATE_INTERVAL_MS = 30 * 60 * 1000;

export function normalizeGitHubRepo(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .slice(0, 2)
    .join('/');
}

export function getStoredGitHubConfig() {
  if (typeof localStorage === 'undefined') {
    return {
      repo: DEFAULT_GITHUB_REPO,
      token: '',
      autoCheck: true,
      lastResult: null,
    };
  }
  try {
    const storedRepo = normalizeGitHubRepo(localStorage.getItem(STORAGE_KEYS.REPO) || '');
    const lowerStored = storedRepo.toLowerCase();
    const isLegacyDefault =
      lowerStored === 'souoleandro/meu-vida-organizada' ||
      lowerStored === 'leancelot/meu-vida-organizada';
    const resolvedRepo =
      storedRepo && !isLegacyDefault ? storedRepo : DEFAULT_GITHUB_REPO;
    const rawLastResult = loadLastResult();
    const lastResult =
      rawLastResult &&
      (rawLastResult.repo?.toLowerCase() === 'souoleandro/meu-vida-organizada' ||
        rawLastResult.repo?.toLowerCase() === 'leancelot/meu-vida-organizada')
        ? null
        : rawLastResult;

    return {
      repo: resolvedRepo,
      token: localStorage.getItem(STORAGE_KEYS.TOKEN) || '',
      autoCheck: localStorage.getItem(STORAGE_KEYS.AUTO_CHECK) !== 'false',
      lastResult,
    };
  } catch {
    return {
      repo: DEFAULT_GITHUB_REPO,
      token: '',
      autoCheck: true,
      lastResult: null,
    };
  }
}

export function saveGitHubConfig(repo: string, token: string, autoCheck: boolean) {
  if (typeof localStorage === 'undefined') return;
  try {
    const clean = normalizeGitHubRepo(repo) || DEFAULT_GITHUB_REPO;
    localStorage.setItem(STORAGE_KEYS.REPO, clean);
    if (token.trim()) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token.trim());
    } else {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
    }
    localStorage.setItem(STORAGE_KEYS.AUTO_CHECK, String(autoCheck));
  } catch (err) {
    console.warn('Erro ao salvar configuração do GitHub:', err);
  }
}

function loadLastResult(): UpdateCheckResult | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_RESULT);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLastResult(result: UpdateCheckResult) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_RESULT, JSON.stringify(result));
  } catch (err) {
    console.warn('Erro ao salvar resultado da verificação de atualização:', err);
  }
}

/**
 * Normalizes version strings (e.g. "v1.2.0", "v1.1.0-build.14" -> [1, 1, 0, 14])
 */
export function parseSemVer(version: string): number[] {
  const clean = version.trim();
  const buildMatch = clean.match(/(?:-build\.?|\+build\.?|build[-_.]|#)(\d+)/i);
  const buildNum = buildMatch ? parseInt(buildMatch[1], 10) : 0;

  const semverMatch = clean.match(/v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  if (!semverMatch) {
    return [0, 0, 0, isNaN(buildNum) ? 0 : buildNum];
  }

  // If the entire string was only "build-14" and semverMatch grabbed "14" from build-, keep [0,0,0,14]
  if (/^build[-_.#]?\d+$/i.test(clean)) {
    return [0, 0, 0, isNaN(buildNum) ? 0 : buildNum];
  }

  return [
    parseInt(semverMatch[1] || '0', 10) || 0,
    parseInt(semverMatch[2] || '0', 10) || 0,
    parseInt(semverMatch[3] || '0', 10) || 0,
    isNaN(buildNum) ? 0 : buildNum,
  ];
}

/**
 * Compare two semver+build strings
 * Returns: 1 if vA > vB, -1 if vA < vB, 0 if equal
 */
export function compareVersions(vA: string, vB: string): number {
  const [majA, minA, patchA, buildA] = parseSemVer(vA);
  const [majB, minB, patchB, buildB] = parseSemVer(vB);

  if (majA !== majB) return majA > majB ? 1 : -1;
  if (minA !== minB) return minA > minB ? 1 : -1;
  if (patchA !== patchB) return patchA > patchB ? 1 : -1;
  if (buildA !== buildB) return buildA > buildB ? 1 : -1;
  return 0;
}

function mapRelease(data: any, releasesUrl: string): GitHubRelease {
  return {
    id: data.id,
    tag_name: data.tag_name || '',
    name: data.name || data.tag_name || 'Atualização',
    body: data.body || '',
    published_at: data.published_at || data.created_at || '',
    html_url: data.html_url || `${releasesUrl}/tag/${data.tag_name}`,
    prerelease: Boolean(data.prerelease),
    assets: Array.isArray(data.assets)
      ? data.assets.map((a: any) => ({
          id: a.id,
          name: a.name,
          size: a.size,
          download_count: a.download_count,
          browser_download_url: a.browser_download_url,
          api_url: a.url,
          content_type: a.content_type,
        }))
      : [],
  };
}

function isApkArtifactName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes('apk') || lower.includes('lifeedy') || lower.includes('vidaorganizada');
}

/**
 * Queries GitHub REST API for Releases (including pre-releases), GitHub Actions APK builds/artifacts, and recent commits.
 */
export async function checkForGitHubUpdates(
  repoPath: string,
  token?: string,
  currentVersion: string = CURRENT_APP_VERSION,
  options?: CheckGitHubUpdatesOptions
): Promise<UpdateCheckResult> {
  const cleanRepo = normalizeGitHubRepo(repoPath);
  const effectiveBuildNumber = options?.currentBuildNumber ?? CURRENT_BUILD_NUMBER;
  const effectiveCommitSha = (options?.currentCommitSha ?? CURRENT_COMMIT_SHA).trim();
  const effectiveBuiltAt = (options?.currentBuiltAt ?? CURRENT_BUILT_AT).trim();

  const repoUrl = cleanRepo ? `https://github.com/${cleanRepo}` : 'https://github.com';
  const actionsUrl = `${repoUrl}/actions`;
  const releasesUrl = `${repoUrl}/releases`;
  const now = new Date().toISOString();

  if (!cleanRepo || !cleanRepo.includes('/')) {
    const invalidResult: UpdateCheckResult = {
      hasUpdate: false,
      repo: cleanRepo,
      currentVersion,
      currentBuildNumber: effectiveBuildNumber || undefined,
      recentCommits: [],
      repoUrl,
      actionsUrl,
      releasesUrl,
      checkedAt: now,
      error:
        'Formato de repositório inválido. Use "usuario/nome-do-repositorio" (ex.: leancelot/lifeedy).',
    };
    saveLastResult(invalidResult);
    return invalidResult;
  }

  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
  };
  if (token && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }

  const effectiveCurrentComparable =
    effectiveBuildNumber > 0 && !/build/i.test(currentVersion)
      ? `${currentVersion}-build.${effectiveBuildNumber}`
      : currentVersion;

  let latestRelease: GitHubRelease | undefined;
  let apkAsset: GitHubReleaseAsset | undefined;
  let latestBuild: GitHubWorkflowBuild | undefined;
  let hasUpdate = false;
  let updateSource: UpdateCheckResult['updateSource'];
  let latestVersion: string | undefined;
  let errorMsg: string | undefined;
  const recentCommits: GitHubCommit[] = [];

  try {
    const [releasesSettled, runsSettled, commitsSettled] = await Promise.allSettled([
      fetch(`https://api.github.com/repos/${cleanRepo}/releases?per_page=10`, {
        headers,
        cache: 'no-store',
      }),
      fetch(`https://api.github.com/repos/${cleanRepo}/actions/runs?status=completed&per_page=8`, {
        headers,
        cache: 'no-store',
      }),
      fetch(`https://api.github.com/repos/${cleanRepo}/commits?per_page=6`, {
        headers,
        cache: 'no-store',
      }),
    ]);

    let releaseStatus = 0;
    let runsStatus = 0;
    let commitsStatus = 0;

    // 1. Evaluate Releases (supports official releases, pre-releases, and -build.N tags)
    if (releasesSettled.status === 'fulfilled') {
      const releaseRes = releasesSettled.value;
      releaseStatus = releaseRes.status;

      if (releaseRes.ok) {
        const list = await releaseRes.json();
        if (Array.isArray(list)) {
          const nonDrafts = list
            .filter((r: any) => !r.draft)
            .map((r: any) => mapRelease(r, releasesUrl));

          // Prefer newest release that has an APK asset, otherwise newest release
          const releaseWithApk = nonDrafts.find((r) =>
            r.assets.some((a) => a.name.toLowerCase().endsWith('.apk'))
          );
          latestRelease = releaseWithApk || nonDrafts[0];

          if (latestRelease) {
            apkAsset = latestRelease.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
            const cmp = compareVersions(latestRelease.tag_name, effectiveCurrentComparable);
            const [maj, min, patch] = parseSemVer(latestRelease.tag_name);
            const isTagPureBuildOnly = maj === 0 && min === 0 && patch === 0;
            const releaseBuildNum = parseSemVer(latestRelease.tag_name)[3];

            const publishedMs = latestRelease.published_at
              ? new Date(latestRelease.published_at).getTime()
              : 0;
            const builtMs = effectiveBuiltAt ? new Date(effectiveBuiltAt).getTime() : 0;
            const publishedAfterCurrentBuild =
              publishedMs > 0 && builtMs > 0 && publishedMs > builtMs + 60_000;

            if (cmp > 0) {
              hasUpdate = true;
            } else if (isTagPureBuildOnly && releaseBuildNum > effectiveBuildNumber) {
              hasUpdate = true;
            } else if (
              apkAsset &&
              effectiveBuildNumber === 0 &&
              isTagPureBuildOnly &&
              (publishedAfterCurrentBuild || !effectiveBuiltAt)
            ) {
              hasUpdate = true;
            }

            if (hasUpdate) {
              updateSource = 'release';
              latestVersion = latestRelease.tag_name || latestRelease.name;
            }
          }
        }
      }
    }

    // 2. Evaluate GitHub Actions Workflow Runs & APK Artifacts
    if (runsSettled.status === 'fulfilled') {
      const runsRes = runsSettled.value;
      runsStatus = runsRes.status;

      if (runsRes.ok) {
        const data = await runsRes.json();
        const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : [];
        const successfulRuns = runs.filter((r: any) => r.conclusion === 'success');

        const preferredRun =
          successfulRuns.find(
            (r: any) =>
              String(r.name || '').toLowerCase().includes('apk') ||
              String(r.path || '').toLowerCase().includes('build-apk')
          ) || successfulRuns[0];

        if (preferredRun) {
          let matchedArtifact: any = null;
          try {
            const artRes = await fetch(
              `https://api.github.com/repos/${cleanRepo}/actions/runs/${preferredRun.id}/artifacts`,
              { headers, cache: 'no-store' }
            );
            if (artRes.ok) {
              const artData = await artRes.json();
              const artifacts = Array.isArray(artData?.artifacts) ? artData.artifacts : [];
              matchedArtifact =
                artifacts.find((a: any) => !a.expired && isApkArtifactName(String(a.name || ''))) ||
                artifacts.find((a: any) => !a.expired);
            }
          } catch {
            // Keep run metadata even if artifacts endpoint fails
          }

          latestBuild = {
            id: preferredRun.id,
            runNumber: preferredRun.run_number,
            name: preferredRun.name || 'Build Android APK',
            headBranch: preferredRun.head_branch || 'main',
            headSha: preferredRun.head_sha || '',
            shortSha: String(preferredRun.head_sha || '').slice(0, 7),
            htmlUrl: preferredRun.html_url || actionsUrl,
            createdAt: preferredRun.created_at || '',
            updatedAt: preferredRun.updated_at || preferredRun.created_at || '',
            artifactName: matchedArtifact?.name,
            artifactSize: matchedArtifact?.size_in_bytes,
            artifactId: matchedArtifact?.id,
            artifactDownloadUrl: matchedArtifact?.archive_download_url,
          };

          // If no newer GitHub Release was already found, check if an Actions APK artifact is newer
          if (!hasUpdate && matchedArtifact) {
            const sameCommit =
              Boolean(effectiveCommitSha) &&
              Boolean(latestBuild.headSha) &&
              latestBuild.headSha.toLowerCase() === effectiveCommitSha.toLowerCase();

            const runUpdatedMs = latestBuild.updatedAt
              ? new Date(latestBuild.updatedAt).getTime()
              : 0;
            const builtMs = effectiveBuiltAt ? new Date(effectiveBuiltAt).getTime() : 0;

            const isNewerByRunNumber =
              effectiveBuildNumber > 0 && latestBuild.runNumber > effectiveBuildNumber && !sameCommit;
            const isNewerBySha =
              effectiveBuildNumber === 0 &&
              Boolean(effectiveCommitSha) &&
              !sameCommit &&
              (builtMs === 0 || runUpdatedMs > builtMs + 60_000);
            const isAvailableForLegacyApk =
              effectiveBuildNumber === 0 && !effectiveCommitSha;

            if (isNewerByRunNumber || isNewerBySha || isAvailableForLegacyApk) {
              hasUpdate = true;
              updateSource = 'actions_artifact';
              latestVersion = `Build #${latestBuild.runNumber}`;
            }
          }
        }
      }
    }

    // 3. Evaluate Recent Commits
    if (commitsSettled.status === 'fulfilled') {
      const commitsRes = commitsSettled.value;
      commitsStatus = commitsRes.status;

      if (commitsRes.ok) {
        const data = await commitsRes.json();
        if (Array.isArray(data)) {
          for (const item of data) {
            recentCommits.push({
              sha: item.sha,
              shortSha: item.sha.substring(0, 7),
              message: item.commit?.message?.split('\n')[0] || 'Atualização de código',
              authorName: item.commit?.author?.name || item.author?.login || 'Autor',
              authorAvatar: item.author?.avatar_url,
              date: item.commit?.author?.date || '',
              url: item.html_url,
            });
          }
        }
      }
    }

    // 4. Diagnose clear errors instead of falsely reporting "up to date"
    const networkRejected =
      releasesSettled.status === 'rejected' &&
      runsSettled.status === 'rejected' &&
      commitsSettled.status === 'rejected';

    if (networkRejected) {
      errorMsg = 'Não foi possível conectar ao GitHub. Verifique sua conexão com a internet.';
    } else if (releaseStatus === 401 || runsStatus === 401 || commitsStatus === 401) {
      errorMsg = 'Token de acesso do GitHub inválido ou expirado. Atualize ou remova o token nas configurações.';
    } else if (releaseStatus === 403 || runsStatus === 403 || commitsStatus === 403) {
      errorMsg =
        'Limite de consultas da API pública do GitHub atingido. Aguarde alguns minutos ou informe um Personal Access Token.';
    } else if (releaseStatus === 404 && (runsStatus === 404 || commitsStatus === 404)) {
      errorMsg = `Repositório "${cleanRepo}" não encontrado ou é privado. Confira o nome (usuario/repositorio) ou adicione um Token de acesso.`;
    } else if (commitsStatus === 409 && !latestRelease && !latestBuild) {
      errorMsg = `O repositório "${cleanRepo}" ainda está vazio no GitHub (nenhum commit, build ou release encontrado).`;
    }
  } catch (err) {
    console.warn('Erro ao consultar atualizações no GitHub:', err);
    errorMsg = 'Não foi possível conectar à API do GitHub. Verifique sua conexão com a internet.';
  }

  const result: UpdateCheckResult = {
    hasUpdate,
    updateSource,
    repo: cleanRepo,
    currentVersion,
    currentBuildNumber: effectiveBuildNumber || undefined,
    latestVersion: latestVersion || latestRelease?.tag_name || (latestBuild ? `Build #${latestBuild.runNumber}` : undefined),
    latestRelease,
    apkAsset,
    latestBuild,
    recentCommits,
    repoUrl,
    actionsUrl,
    releasesUrl,
    checkedAt: now,
    error: errorMsg,
  };

  saveLastResult(result);
  return result;
}

/**
 * Downloads an authenticated GitHub Actions artifact (.zip containing the APK) when a token is configured.
 */
export async function downloadActionsArtifactWithToken(
  artifactId: number,
  repoPath: string,
  token: string,
  artifactName = 'Lifeedy-APK'
): Promise<void> {
  const cleanRepo = normalizeGitHubRepo(repoPath);
  const url = `https://api.github.com/repos/${cleanRepo}/actions/artifacts/${artifactId}/zip`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.trim()}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Não foi possível baixar o artefato (${res.status}). Verifique as permissões do token.`);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${artifactName}.zip`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Resolves the best installable download target from an UpdateCheckResult.
 * Prefers direct GitHub Release .apk asset, falls back to authenticated Actions artifact .zip,
 * and lastly external release/build web URL.
 */
export function resolveInstallableUpdateTarget(
  result: UpdateCheckResult | null | undefined,
  token?: string
): InstallableUpdateTarget | null {
  if (!result || !result.hasUpdate) return null;
  const cleanToken = (token || '').trim();

  if (result.apkAsset) {
    const useApiAsset = Boolean(cleanToken && result.apkAsset.api_url);
    return {
      kind: 'release_apk',
      url: useApiAsset ? result.apkAsset.api_url! : result.apkAsset.browser_download_url,
      fileName: result.apkAsset.name || 'Lifeedy-update.apk',
      size: result.apkAsset.size || 0,
      needsToken: useApiAsset,
    };
  }

  if (result.latestBuild?.artifactDownloadUrl && cleanToken) {
    return {
      kind: 'actions_artifact_zip',
      url: result.latestBuild.artifactDownloadUrl,
      fileName: `${result.latestBuild.artifactName || 'Lifeedy-APK'}.zip`,
      size: result.latestBuild.artifactSize || 0,
      needsToken: true,
    };
  }

  const externalUrl =
    result.latestRelease?.html_url || result.latestBuild?.htmlUrl || result.releasesUrl;
  if (externalUrl) {
    return {
      kind: 'external_page',
      url: externalUrl,
      fileName: 'Lifeedy-update.apk',
      size: 0,
      needsToken: false,
    };
  }

  return null;
}

/**
 * Determines whether an automatic background update check should run now.
 */
export function shouldRunAutoUpdateCheck(
  lastCheckedAt?: string | null,
  minIntervalMs: number = AUTO_UPDATE_INTERVAL_MS,
  nowMs: number = Date.now()
): boolean {
  if (!lastCheckedAt) return true;
  const parsed = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(parsed)) return true;
  return nowMs - parsed >= minIntervalMs;
}

export function getDismissedUpdateVersion(): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(STORAGE_KEYS.DISMISSED_VERSION) || '';
  } catch {
    return '';
  }
}

export function dismissUpdateVersion(version: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (version.trim()) {
      localStorage.setItem(STORAGE_KEYS.DISMISSED_VERSION, version.trim());
    }
  } catch {
    // ignore storage errors
  }
}

export function clearDismissedUpdateVersion(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEYS.DISMISSED_VERSION);
  } catch {
    // ignore storage errors
  }
}

export function getLastSeenNativeBuild(): number {
  if (typeof localStorage === 'undefined') return 0;
  try {
    const val = parseInt(localStorage.getItem(STORAGE_KEYS.LAST_NATIVE_BUILD) || '0', 10);
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

export function setLastSeenNativeBuild(build: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (build > 0) {
      localStorage.setItem(STORAGE_KEYS.LAST_NATIVE_BUILD, String(build));
    }
  } catch {
    // ignore storage errors
  }
}

/**
 * Forces clear of PWA Service Worker caches and hard reloads the application
 */
export async function refreshAppCache(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    }

    if ('caches' in window) {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        await caches.delete(name);
      }
    }
  } catch (err) {
    console.warn('Erro ao limpar cache:', err);
  } finally {
    window.location.reload();
  }
}
