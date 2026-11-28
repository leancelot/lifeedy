import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  QrCode,
  Search,
} from 'lucide-react';
import {
  isAndroidNativeHealthSupported,
  openAndroidPermissionSettings,
  requestMediaPermission,
} from '../../services/appHealthBridge';
import {
  decodeQrFromCanvasImageData,
  recognizeQrFromBase64,
} from '../../services/offlineReceiptOcr';
import { hapticImpactLight, hapticSuccess } from '../../services/hapticsService';

interface QrReceiptScannerViewProps {
  onQrDetected: (rawQr: string) => void;
  onBackToUpload: () => void;
}

export const QrReceiptScannerView: React.FC<QrReceiptScannerViewProps> = ({
  onQrDetected,
  onBackToUpload,
}) => {
  const [cameraStatus, setCameraStatus] = useState<'initializing' | 'active' | 'unavailable'>(
    'initializing'
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [isReadingFileQr, setIsReadingFileQr] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detectedRef = useRef(false);
  const onQrDetectedRef = useRef(onQrDetected);
  onQrDetectedRef.current = onQrDetected;

  const stopCameraStream = () => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        try {
          track.stop();
        } catch {
          // ignore
        }
      }
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    let scanTimer: ReturnType<typeof setInterval> | null = null;
    let isDecodingFrame = false;

    const startCameraAndScan = async () => {
      try {
        if (isAndroidNativeHealthSupported()) {
          const perm = await requestMediaPermission('camera');
          if (!perm.granted) {
            if (!cancelled) {
              setCameraStatus('unavailable');
              setCameraError('Permita o acesso à câmera para escanear o QR Code da nota fiscal.');
            }
            return;
          }
        }

        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          if (!cancelled) {
            setCameraStatus('unavailable');
            setCameraError(
              'Câmera ao vivo indisponível neste navegador. Escolha uma foto ou cole o link/chave abaixo.'
            );
          }
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        streamRef.current = stream;
        const videoEl = videoRef.current;
        if (!videoEl) return;
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});

        if (!cancelled) {
          setCameraStatus('active');
          setCameraError(null);
        }

        const DetectorCtor = (globalThis as unknown as {
          BarcodeDetector?: new (opts?: { formats?: string[] }) => {
            detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
          };
        }).BarcodeDetector;
        const detector = DetectorCtor ? new DetectorCtor({ formats: ['qr_code'] }) : null;

        scanTimer = setInterval(async () => {
          if (cancelled || detectedRef.current || isDecodingFrame) return;
          const activeVideo = videoRef.current;
          if (
            !activeVideo ||
            activeVideo.readyState < 2 ||
            activeVideo.videoWidth === 0 ||
            activeVideo.videoHeight === 0
          ) {
            return;
          }

          isDecodingFrame = true;
          try {
            let decodedValue: string | null = null;

            if (detector) {
              try {
                const hits = await detector.detect(activeVideo);
                decodedValue = hits.find((h) => h.rawValue?.trim())?.rawValue?.trim() || null;
              } catch {
                // fallback to canvas + jsQR below
              }
            }

            if (!decodedValue) {
              if (!canvasRef.current) {
                canvasRef.current = document.createElement('canvas');
              }
              const maxSide = 720;
              const scale = Math.min(
                1,
                maxSide / Math.max(activeVideo.videoWidth, activeVideo.videoHeight)
              );
              const w = Math.max(1, Math.round(activeVideo.videoWidth * scale));
              const h = Math.max(1, Math.round(activeVideo.videoHeight * scale));
              const canvas = canvasRef.current;
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(activeVideo, 0, 0, w, h);
                const imageData = ctx.getImageData(0, 0, w, h);
                decodedValue = await decodeQrFromCanvasImageData(imageData.data, w, h);
              }
            }

            if (decodedValue && !cancelled && !detectedRef.current) {
              detectedRef.current = true;
              hapticSuccess();
              stopCameraStream();
              onQrDetectedRef.current(decodedValue);
            }
          } finally {
            isDecodingFrame = false;
          }
        }, 220);
      } catch (err: unknown) {
        if (!cancelled) {
          setCameraStatus('unavailable');
          const msg = err instanceof Error ? err.message : '';
          setCameraError(
            msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('denied')
              ? 'Acesso à câmera bloqueado. Libere a câmera ou leia o QR Code a partir de uma foto.'
              : 'Não foi possível iniciar a câmera agora. Use uma foto da nota ou cole o link/chave.'
          );
        }
      }
    };

    void startCameraAndScan();

    return () => {
      cancelled = true;
      if (scanTimer) clearInterval(scanTimer);
      stopCameraStream();
    };
  }, []);

  const handleImageQrUpload = async (file: File) => {
    setIsReadingFileQr(true);
    setManualError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo selecionado.'));
        reader.readAsDataURL(file);
      });

      const qrCodes = await recognizeQrFromBase64(dataUrl);
      if (qrCodes.length === 0) {
        setManualError(
          'Nenhum QR Code nítido foi encontrado nesta imagem. Tente aproximar do código ou colar a chave de 44 dígitos.'
        );
        return;
      }

      hapticSuccess();
      stopCameraStream();
      onQrDetected(qrCodes[0]);
    } catch (err: unknown) {
      setManualError(
        err instanceof Error ? err.message : 'Não foi possível ler o QR Code dessa foto.'
      );
    } finally {
      setIsReadingFileQr(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualInput.trim();
    if (!cleaned) {
      setManualError('Cole o link do QR Code da nota ou a chave de acesso de 44 dígitos.');
      return;
    }
    setManualError(null);
    hapticImpactLight();
    stopCameraStream();
    onQrDetected(cleaned);
  };

  return (
    <div className="space-y-4">
      {/* Live Camera Viewfinder */}
      <div className="relative w-full aspect-[4/3] max-h-[260px] rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${
            cameraStatus === 'active' ? 'opacity-100' : 'opacity-0'
          } transition-opacity duration-200`}
        />

        {cameraStatus === 'initializing' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-300">
            <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
            <span className="text-xs font-medium">Iniciando câmera para leitura de QR...</span>
          </div>
        )}

        {cameraStatus === 'active' && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-44 h-44 rounded-2xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.42)] relative">
                <span className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-4 border-l-4 border-emerald-400 rounded-tl-lg" />
                <span className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-4 border-r-4 border-emerald-400 rounded-tr-lg" />
                <span className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-4 border-l-4 border-emerald-400 rounded-bl-lg" />
                <span className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-4 border-r-4 border-emerald-400 rounded-br-lg" />
              </div>
            </div>
            <div className="pointer-events-none absolute bottom-2.5 inset-x-3 flex justify-center">
              <span className="px-3 py-1 rounded-full bg-black/70 text-white text-[11px] font-medium backdrop-blur-xs">
                Aponte para o QR Code da Nota Fiscal (NFC-e)
              </span>
            </div>
          </>
        )}

        {cameraStatus === 'unavailable' && (
          <div className="absolute inset-0 p-5 flex flex-col items-center justify-center text-center gap-2.5 bg-zinc-900 text-zinc-200">
            <Camera className="w-8 h-8 text-zinc-400" />
            <p className="text-xs text-zinc-300 max-w-xs leading-relaxed">
              {cameraError || 'Câmera indisponível no momento.'}
            </p>
            {isAndroidNativeHealthSupported() && (
              <button
                type="button"
                onClick={() => void openAndroidPermissionSettings('appDetails')}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold cursor-pointer"
              >
                Abrir ajustes de câmera
              </button>
            )}
          </div>
        )}
      </div>

      {/* Quick QR-from-Image Fallback */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={isReadingFileQr}
          onClick={() => fileInputRef.current?.click()}
          className="pressable flex-1 flex items-center justify-center gap-2 py-2.5 px-3 min-h-[42px] rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/70 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold cursor-pointer disabled:opacity-60"
        >
          {isReadingFileQr ? (
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
          ) : (
            <ImageIcon className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          )}
          <span>{isReadingFileQr ? 'Lendo QR da imagem...' : 'Ler QR Code de uma Foto'}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            stopCameraStream();
            onBackToUpload();
          }}
          className="pressable py-2.5 px-3.5 min-h-[42px] rounded-2xl border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer whitespace-nowrap"
        >
          Voltar
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void handleImageQrUpload(file);
        }}
      />

      {/* Manual URL / 44-digit Access Key Form */}
      <form
        onSubmit={handleManualSubmit}
        className="p-3.5 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-700/80 space-y-2.5"
      >
        <label className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          <KeyRound className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>Ou cole a URL da NFC-e / chave de 44 dígitos</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={manualInput}
            onChange={(e) => {
              setManualInput(e.target.value);
              if (manualError) setManualError(null);
            }}
            placeholder="https://...fazenda...gov.br/... ou 44 dígitos"
            className="flex-1 min-w-0 px-3 py-2 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
          />
          <button
            type="submit"
            className="pressable px-3.5 py-2 min-h-[38px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Search className="w-3.5 h-3.5" />
            <span>Consultar</span>
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
          <QrCode className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
          <span>Busca loja, valor, itens e categoria direto na SEFAZ e Receita Federal.</span>
        </p>
      </form>

      {manualError && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{manualError}</span>
        </div>
      )}
    </div>
  );
};
