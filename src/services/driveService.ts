import { AppDataPayload } from '../types';
import { WorkspaceAuthError } from './googleAuthError';

export const PRIMARY_BACKUP_FILE_NAME = 'Lifeedy_Data.json';
export const LEGACY_BACKUP_FILE_NAME = 'VidaOrganizada_Data.json';

export interface DriveFileInfo {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

/**
 * Selects the best backup file when both new (Lifeedy_Data.json) and legacy (VidaOrganizada_Data.json) exist.
 */
export function selectPreferredBackupFile(files: DriveFileInfo[]): DriveFileInfo | null {
  if (!Array.isArray(files) || files.length === 0) return null;

  const primary = files
    .filter((f) => f.name === PRIMARY_BACKUP_FILE_NAME)
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0];

  const legacy = files
    .filter((f) => f.name === LEGACY_BACKUP_FILE_NAME)
    .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0];

  if (primary && legacy) {
    const primaryMs = new Date(primary.modifiedTime).getTime() || 0;
    const legacyMs = new Date(legacy.modifiedTime).getTime() || 0;
    // Only prefer legacy if it was modified significantly more recently (e.g. another device on older build)
    if (legacyMs > primaryMs + 2000) {
      return legacy;
    }
    return primary;
  }

  return primary || legacy || files[0];
}

/**
 * Searches for the existing backup file (Lifeedy or legacy VidaOrganizada) in Google Drive
 */
export async function findDriveBackupFile(accessToken: string): Promise<DriveFileInfo | null> {
  const query = encodeURIComponent(
    `(name='${PRIMARY_BACKUP_FILE_NAME}' or name='${LEGACY_BACKUP_FILE_NAME}') and trashed=false`
  );
  const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,modifiedTime,size)&spaces=drive&orderBy=modifiedTime desc`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão do Google Drive expirada. Renovando conexão...');
  }

  if (!res.ok) {
    const errorText = await res.text();
    console.warn('Falha ao consultar arquivo no Drive:', res.status, errorText);
    throw new Error(`Falha ao acessar Google Drive (${res.status})`);
  }

  const data = await res.json();
  if (Array.isArray(data.files) && data.files.length > 0) {
    return selectPreferredBackupFile(data.files as DriveFileInfo[]);
  }
  return null;
}

/**
 * Reads content of a file from Google Drive
 */
export async function readDriveFile(accessToken: string, fileId: string): Promise<AppDataPayload> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão do Google Drive expirada. Renovando conexão...');
  }

  if (!res.ok) {
    throw new Error(`Erro ao baixar arquivo do Drive (${res.status})`);
  }

  const content = await res.json();
  return content as AppDataPayload;
}

function buildMultipartBody(
  metadata: Record<string, string>,
  fileContent: string
): { body: string; boundary: string } {
  const boundary = '-------LifeedyBoundary7MA4YWxkTrZu0gW';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    fileContent +
    closeDelimiter;

  return { body, boundary };
}

/**
 * Creates or updates the backup file in Google Drive, migrating legacy files to Lifeedy_Data.json in place.
 */
export async function saveToDrive(
  accessToken: string,
  payload: AppDataPayload,
  existingFileId?: string | null
): Promise<DriveFileInfo> {
  const fileContent = JSON.stringify(payload, null, 2);

  let targetFileId = existingFileId;
  if (!targetFileId) {
    const existing = await findDriveBackupFile(accessToken);
    if (existing) {
      targetFileId = existing.id;
    }
  }

  const metadata = {
    name: PRIMARY_BACKUP_FILE_NAME,
    mimeType: 'application/json',
    description: 'Backup de sincronização do Lifeedy (Agenda, Tarefas e Finanças)',
  };

  if (targetFileId) {
    const { body, boundary } = buildMultipartBody(metadata, fileContent);
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${targetFileId}?uploadType=multipart`;
    const res = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    });

    if (res.status === 401) {
      throw new WorkspaceAuthError('Sessão do Google Drive expirada. Renovando conexão...');
    }

    if (res.status === 404) {
      // Arquivo foi apagado manualmente no Drive; cria um novo abaixo
      targetFileId = null;
    } else if (!res.ok) {
      const err = await res.text();
      console.warn('Falha ao atualizar arquivo no Drive:', res.status, err);
      throw new Error(`Falha ao salvar no Google Drive (${res.status})`);
    } else {
      const updated = await res.json();
      return {
        id: updated.id,
        name: updated.name || PRIMARY_BACKUP_FILE_NAME,
        modifiedTime: new Date().toISOString(),
      };
    }
  }

  // Create new file with multipart upload
  const { body, boundary } = buildMultipartBody(metadata, fileContent);
  const createUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
  const res = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão do Google Drive expirada. Renovando conexão...');
  }

  if (!res.ok) {
    const err = await res.text();
    console.warn('Falha ao criar arquivo no Drive:', res.status, err);
    throw new Error(`Falha ao criar backup no Google Drive (${res.status})`);
  }

  const created = await res.json();
  return {
    id: created.id,
    name: created.name || PRIMARY_BACKUP_FILE_NAME,
    modifiedTime: new Date().toISOString(),
  };
}

/**
 * Deletes backup file from Drive with confirmation
 */
export async function deleteDriveFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    throw new WorkspaceAuthError('Sessão do Google Drive expirada. Renovando conexão...');
  }

  if (!res.ok && res.status !== 404) {
    throw new Error(`Erro ao excluir arquivo no Drive (${res.status})`);
  }
}
