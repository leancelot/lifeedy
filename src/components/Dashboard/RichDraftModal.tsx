import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Image as ImageIcon,
  ListChecks,
  Mic,
  Pin,
  PinOff,
  Plus,
  Square,
  StickyNote,
  X,
} from 'lucide-react';
import {
  DraftAudioAttachment,
  DraftChecklistItem,
  DraftImageAttachment,
  DraftKind,
  DraftNote,
} from '../../types';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import {
  blobToDataUrl,
  compressImageToDataUrl,
  formatAudioDuration,
  MAX_DRAFT_AUDIO_SECONDS,
  pickSupportedAudioMimeType,
} from '../../services/mediaUtils';
import {
  describeMediaPermissionError,
  isAndroidNativeHealthSupported,
  openAndroidPermissionSettings,
  requestMediaPermission,
} from '../../services/appHealthBridge';
import { DraftAudioPlayer } from './DraftAudioPlayer';

interface RichDraftModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingDraft?: DraftNote | null;
  initialMode?: 'text' | 'list' | 'image' | 'audio';
  onSave: (draftData: Omit<DraftNote, 'id' | 'updatedAt'>, existingId?: string) => void;
}

export const RichDraftModal: React.FC<RichDraftModalProps> = ({
  isOpen,
  onClose,
  editingDraft,
  initialMode = 'text',
  onSave,
}) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [checklistItems, setChecklistItems] = useState<DraftChecklistItem[]>([]);
  const [newItemText, setNewItemText] = useState('');
  const [images, setImages] = useState<DraftImageAttachment[]>([]);
  const [audios, setAudios] = useState<DraftAudioAttachment[]>([]);
  const [isPinned, setIsPinned] = useState(true);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartMsRef = useRef<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [mediaPermissionDenied, setMediaPermissionDenied] = useState(false);
  const itemInputRef = useRef<HTMLInputElement>(null);

  const stopRecordingStream = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
  };

  useBackHandler(isOpen, () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
    }
    stopRecordingStream();
    onClose();
    return true;
  });

  useEffect(() => {
    if (!isOpen) {
      if (isRecording) {
        try {
          mediaRecorderRef.current?.stop();
        } catch {
          // ignore
        }
      }
      stopRecordingStream();
      setIsRecording(false);
      setRecordingSec(0);
      setMediaError(null);
      return;
    }

    if (editingDraft) {
      setTitle(editingDraft.title || '');
      setContent(editingDraft.content || '');
      setChecklistItems(editingDraft.checklistItems ? [...editingDraft.checklistItems] : []);
      setImages(editingDraft.images ? [...editingDraft.images] : []);
      setAudios(editingDraft.audios ? [...editingDraft.audios] : []);
      setIsPinned(editingDraft.isPinned !== false);
    } else {
      setTitle('');
      setContent('');
      setChecklistItems([]);
      setImages([]);
      setAudios([]);
      setIsPinned(true);
      if (initialMode === 'list') {
        setTimeout(() => itemInputRef.current?.focus(), 120);
      }
    }
    setNewItemText('');
    setMediaError(null);
  }, [isOpen, editingDraft, initialMode]);

  useEffect(() => {
    return () => {
      stopRecordingStream();
    };
  }, []);

  if (!isOpen) return null;

  const handleAddChecklistItem = () => {
    const cleaned = newItemText.trim();
    if (!cleaned) return;
    hapticImpactLight();
    setChecklistItems((prev) => [
      ...prev,
      {
        id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        text: cleaned,
        completed: false,
      },
    ]);
    setNewItemText('');
    itemInputRef.current?.focus();
  };

  const handleImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsProcessingImage(true);
    setMediaError(null);
    try {
      const nextImages: DraftImageAttachment[] = [];
      for (const file of Array.from(files).slice(0, 4)) {
        const compressed = await compressImageToDataUrl(file);
        nextImages.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          dataUrl: compressed.dataUrl,
          width: compressed.width,
          height: compressed.height,
        });
      }
      setImages((prev) => [...prev, ...nextImages]);
      hapticSuccess();
    } catch (err: any) {
      setMediaError(err?.message || 'Não foi possível processar a imagem selecionada.');
    } finally {
      setIsProcessingImage(false);
    }
  };

  const startRecording = async () => {
    setMediaError(null);
    setMediaPermissionDenied(false);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMediaError('Gravação de áudio não suportada neste dispositivo ou navegador.');
      return;
    }

    if (isAndroidNativeHealthSupported()) {
      const perm = await requestMediaPermission('microphone');
      if (!perm.granted) {
        setMediaPermissionDenied(true);
        setMediaError('Permita o acesso ao microfone nas configurações do app para gravar áudio.');
        return;
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      recordingStartMsRef.current = Date.now();
      setRecordingSec(0);
      setIsRecording(true);
      hapticImpactLight();

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunksRef.current.push(ev.data);
        }
      };

      recorder.onstop = async () => {
        stopRecordingStream();
        setIsRecording(false);
        const durationSec = Math.max(
          1,
          Math.round((Date.now() - recordingStartMsRef.current) / 1000)
        );
        const recordedMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: recordedMime });
        chunksRef.current = [];
        if (blob.size < 100) return;

        try {
          const dataUrl = await blobToDataUrl(blob);
          setAudios((prev) => [
            ...prev,
            {
              id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              dataUrl,
              mimeType: recordedMime,
              durationSec,
              createdAt: new Date().toISOString(),
            },
          ]);
          hapticSuccess();
        } catch {
          setMediaError('Não foi possível salvar a gravação de áudio.');
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250);

      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartMsRef.current) / 1000);
        setRecordingSec(elapsed);
        if (elapsed >= MAX_DRAFT_AUDIO_SECONDS) {
          recorder.stop();
        }
      }, 250);
    } catch (err) {
      stopRecordingStream();
      setIsRecording(false);
      setMediaPermissionDenied(true);
      setMediaError(describeMediaPermissionError(err, 'microphone'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      stopRecordingStream();
      setIsRecording(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pendingItem = newItemText.trim();
    const finalChecklist = pendingItem
      ? [
          ...checklistItems,
          {
            id: `chk-${Date.now()}`,
            text: pendingItem,
            completed: false,
          },
        ]
      : checklistItems;

    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();

    if (
      !trimmedTitle &&
      !trimmedContent &&
      finalChecklist.length === 0 &&
      images.length === 0 &&
      audios.length === 0
    ) {
      setMediaError('Adicione um título, texto, item de lista, imagem ou áudio.');
      return;
    }

    const derivedTitle =
      trimmedTitle ||
      trimmedContent.split('\n')[0].slice(0, 48) ||
      finalChecklist[0]?.text.slice(0, 48) ||
      (audios.length > 0 ? 'Nota de áudio' : 'Rascunho com imagem');

    const hasText = Boolean(trimmedContent);
    const hasList = finalChecklist.length > 0;
    const hasMedia = images.length > 0 || audios.length > 0;

    let kind: DraftKind = 'text';
    if ((hasText && hasList) || (hasList && hasMedia) || (hasText && hasMedia)) {
      kind = 'mixed';
    } else if (hasList) {
      kind = 'list';
    } else if (hasMedia) {
      kind = 'media';
    }

    onSave(
      {
        title: derivedTitle,
        content: trimmedContent,
        kind,
        checklistItems: finalChecklist.length > 0 ? finalChecklist : undefined,
        images: images.length > 0 ? images : undefined,
        audios: audios.length > 0 ? audios : undefined,
        isPinned,
      },
      editingDraft?.id
    );
    hapticSuccess();
    onClose();
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRecording) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-lg bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />

        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <StickyNote className="w-5 h-5 text-amber-500" />
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              {editingDraft ? 'Editar Rascunho' : 'Novo Rascunho'}
            </h3>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setIsPinned((prev) => !prev);
              }}
              className={`pressable h-9 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer border ${
                isPinned
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300'
                  : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              {isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
              <span>{isPinned ? 'Fixado' : 'Fixar'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (isRecording) stopRecording();
                onClose();
              }}
              aria-label="Fechar"
              className="pressable w-9 h-9 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Título */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título do rascunho (opcional)"
            className="w-full h-11 px-3.5 text-sm font-semibold rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />

          {/* Texto livre */}
          <textarea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Anote ideias, lembretes ou observações..."
            className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-none"
          />

          {/* Lista / Checklist */}
          <div className="space-y-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 inline-flex items-center gap-1.5">
                <ListChecks className="w-4 h-4 text-indigo-500" />
                Lista de itens
              </span>
              {checklistItems.length > 0 && (
                <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                  {checklistItems.filter((i) => i.completed).length}/{checklistItems.length}
                </span>
              )}
            </div>

            {checklistItems.length > 0 && (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {checklistItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 py-1 px-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        hapticSelection();
                        setChecklistItems((prev) =>
                          prev.map((x) =>
                            x.id === item.id ? { ...x, completed: !x.completed } : x
                          )
                        );
                      }}
                      aria-label={item.completed ? 'Desmarcar item' : 'Concluir item'}
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 cursor-pointer border ${
                        item.completed
                          ? 'bg-emerald-600 border-emerald-600 text-white'
                          : 'border-zinc-300 dark:border-zinc-600'
                      }`}
                    >
                      {item.completed && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </button>
                    <input
                      type="text"
                      value={item.text}
                      onChange={(e) =>
                        setChecklistItems((prev) =>
                          prev.map((x) =>
                            x.id === item.id ? { ...x, text: e.target.value } : x
                          )
                        )
                      }
                      className={`flex-1 bg-transparent text-xs sm:text-sm focus:outline-none ${
                        item.completed
                          ? 'line-through text-zinc-400 dark:text-zinc-500'
                          : 'text-zinc-800 dark:text-zinc-100'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setChecklistItems((prev) => prev.filter((x) => x.id !== item.id))
                      }
                      aria-label="Remover item"
                      className="w-7 h-7 rounded-lg text-zinc-400 hover:text-rose-500 flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={itemInputRef}
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddChecklistItem();
                  }
                }}
                placeholder="Adicionar item à lista..."
                className="flex-1 h-10 px-3 text-xs sm:text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddChecklistItem}
                disabled={!newItemText.trim()}
                className="pressable h-10 px-3 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-zinc-700 dark:text-zinc-200 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Item</span>
              </button>
            </div>
          </div>

          {/* Barra de Mídia: Imagem & Áudio */}
          <div className="space-y-2.5 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleImageFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void handleImageFiles(e.target.files);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessingImage}
                className="pressable min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <ImageIcon className="w-4 h-4 text-indigo-500" />
                <span>{isProcessingImage ? 'Processando...' : 'Galeria'}</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setMediaError(null);
                  setMediaPermissionDenied(false);
                  if (isAndroidNativeHealthSupported()) {
                    const perm = await requestMediaPermission('camera');
                    if (!perm.granted) {
                      setMediaPermissionDenied(true);
                      setMediaError('Permita o acesso à câmera para tirar fotos neste rascunho.');
                      return;
                    }
                  }
                  cameraInputRef.current?.click();
                }}
                disabled={isProcessingImage}
                className="pressable min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Camera className="w-4 h-4 text-amber-500" />
                <span>Foto</span>
              </button>

              {isRecording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="pressable min-h-[40px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono tabular-nums">
                    Parar ({formatAudioDuration(recordingSec)})
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  className="pressable min-h-[40px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-xs font-semibold text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Mic className="w-4 h-4 text-rose-500" />
                  <span>Gravar Áudio</span>
                </button>
              )}
            </div>

            {mediaError && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 rounded-xl px-3 py-2">
                <span>{mediaError}</span>
                {mediaPermissionDenied && isAndroidNativeHealthSupported() && (
                  <button
                    type="button"
                    onClick={() => void openAndroidPermissionSettings('appDetails')}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold shrink-0 cursor-pointer"
                  >
                    Abrir ajustes
                  </button>
                )}
              </div>
            )}

            {/* Prévia das Imagens */}
            {images.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    className="relative aspect-square rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800"
                  >
                    <img
                      src={img.dataUrl}
                      alt={img.caption || 'Anexo de rascunho'}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                      aria-label="Remover imagem"
                      className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/65 text-white flex items-center justify-center cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Lista de Áudios */}
            {audios.length > 0 && (
              <div className="space-y-2">
                {audios.map((aud) => (
                  <DraftAudioPlayer
                    key={aud.id}
                    audio={aud}
                    onRemove={() => setAudios((prev) => prev.filter((x) => x.id !== aud.id))}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                if (isRecording) stopRecording();
                onClose();
              }}
              className="pressable min-h-[44px] px-4 py-2 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isRecording || isProcessingImage}
              className="pressable min-h-[44px] px-5 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 cursor-pointer"
            >
              {editingDraft ? 'Salvar Alterações' : 'Salvar Rascunho'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
