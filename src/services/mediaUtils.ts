export const MAX_DRAFT_AUDIO_SECONDS = 90;

export function formatAudioDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function pickSupportedAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return '';
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Não foi possível converter o arquivo para Data URL.'));
      }
    };
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de mídia.'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageToDataUrl(
  file: File,
  maxDimension = 960,
  quality = 0.72
): Promise<{ dataUrl: string; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível carregar a imagem selecionada.'));
      el.src = objectUrl;
    });

    let targetW = img.naturalWidth || img.width || maxDimension;
    let targetH = img.naturalHeight || img.height || maxDimension;

    if (targetW > maxDimension || targetH > maxDimension) {
      const ratio = Math.min(maxDimension / targetW, maxDimension / targetH);
      targetW = Math.max(1, Math.round(targetW * ratio));
      targetH = Math.max(1, Math.round(targetH * ratio));
    }

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallback = await blobToDataUrl(file);
      return { dataUrl: fallback, width: targetW, height: targetH };
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    let dataUrl = canvas.toDataURL('image/webp', quality);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }

    return {
      dataUrl,
      width: targetW,
      height: targetH,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
