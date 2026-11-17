import React, { useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckSquare,
  Edit3,
  Image as ImageIcon,
  ListChecks,
  Maximize2,
  Mic,
  Pin,
  PinOff,
  Plus,
  Square,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { DraftNote } from '../../types';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';
import {
  blobToDataUrl,
  compressImageToDataUrl,
  formatAudioDuration,
  MAX_DRAFT_AUDIO_SECONDS,
  pickSupportedAudioMimeType,
} from '../../services/mediaUtils';
import { DraftAudioPlayer, RichDraftModal } from './RichDraftModal';

export const DraftsSection: React.FC = () => {
  const {
    draftNotes,
    addDraftNote,
    updateDraftNote,
    deleteDraftNote,
    togglePinDraft,
    toggleDraftChecklistItem,
    addDraftChecklistItem,
    convertDraftToTask,
  } = useApp();

  const [filterMode, setFilterMode] = useState<'all' | 'pinned' | 'lists' | 'media'>('all');

  // Keep-style unified capture bar state
  const [composerMode, setComposerMode] = useState<'idle' | 'text' | 'list'>('idle');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickText, setQuickText] = useState('');
  const [quickListDraft, setQuickListDraft] = useState<string[]>([]);
  const [quickListInput, setQuickListInput] = useState('');

  // Inline checklist addition per card
  const [cardItemInputs, setCardItemInputs] = useState<Record<string, string>>({});

  // Rich Editor Modal state (for mixed/editing)
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<DraftNote | null>(null);
  const [modalInitialMode, setModalInitialMode] = useState<'text' | 'list' | 'image' | 'audio'>(
    'text'
  );

  // Full-screen image preview Lightbox
  const [previewImage, setPreviewImage] = useState<{ dataUrl: string; title: string } | null>(null);

  // One-tap inline audio recording right from the Keep bar
  const [isQuickRecording, setIsQuickRecording] = useState(false);
  const [quickRecordingSec, setQuickRecordingSec] = useState(0);
  const [quickMediaError, setQuickMediaError] = useState<string | null>(null);
  const quickImageInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recStartRef = useRef<number>(0);

  useBackHandler(Boolean(previewImage), () => {
    setPreviewImage(null);
    return true;
  });

  const sortedDrafts = useMemo(() => {
    const base = [...draftNotes].sort((a, b) => {
      if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
        return a.isPinned ? -1 : 1;
      }
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    if (filterMode === 'pinned') return base.filter((d) => d.isPinned);
    if (filterMode === 'lists') {
      return base.filter((d) => (d.checklistItems?.length || 0) > 0);
    }
    if (filterMode === 'media') {
      return base.filter((d) => (d.images?.length || 0) > 0 || (d.audios?.length || 0) > 0);
    }
    return base;
  }, [draftNotes, filterMode]);

  const stopQuickAudioTracks = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const resetComposer = () => {
    setQuickTitle('');
    setQuickText('');
    setQuickListDraft([]);
    setQuickListInput('');
    setComposerMode('idle');
  };

  const handleSaveInlineComposer = (e: React.FormEvent) => {
    e.preventDefault();
    if (composerMode === 'list') {
      const extra = quickListInput.trim();
      const lines = extra ? [...quickListDraft, extra] : quickListDraft;
      if (lines.length === 0) return;
      hapticSuccess();
      addDraftNote({
        title: quickTitle.trim() || lines[0].slice(0, 44) || 'Lista rápida',
        content: '',
        kind: 'list',
        checklistItems: lines.map((text, idx) => ({
          id: `chk-${Date.now()}-${idx}`,
          text,
          completed: false,
        })),
        isPinned: true,
      });
      resetComposer();
      return;
    }

    const content = quickText.trim();
    const title = quickTitle.trim();
    if (!content && !title) return;
    hapticSuccess();
    addDraftNote({
      title: title || content.split('\n')[0].slice(0, 44) || 'Rascunho',
      content: content || title,
      kind: 'text',
      isPinned: true,
    });
    resetComposer();
  };

  const handleQuickImagePick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setQuickMediaError(null);
    try {
      const compressed = await compressImageToDataUrl(files[0]);
      addDraftNote({
        title: quickTitle.trim() || 'Imagem salva',
        content: quickText.trim(),
        kind: 'media',
        images: [
          {
            id: `img-${Date.now()}`,
            dataUrl: compressed.dataUrl,
            width: compressed.width,
            height: compressed.height,
          },
        ],
        isPinned: true,
      });
      resetComposer();
      hapticSuccess();
    } catch (err: any) {
      setQuickMediaError(err?.message || 'Não foi possível anexar a imagem.');
    }
  };

  const handleToggleQuickAudio = async () => {
    setQuickMediaError(null);
    if (isQuickRecording) {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      } else {
        stopQuickAudioTracks();
        setIsQuickRecording(false);
      }
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setQuickMediaError('Microfone não disponível neste navegador.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      recStartRef.current = Date.now();
      setQuickRecordingSec(0);
      setIsQuickRecording(true);
      hapticImpactLight();

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stopQuickAudioTracks();
        setIsQuickRecording(false);
        const durationSec = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
        const usedMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: usedMime });
        chunksRef.current = [];
        if (blob.size < 100) return;
        try {
          const dataUrl = await blobToDataUrl(blob);
          const timeLabel = new Date().toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          });
          addDraftNote({
            title: quickTitle.trim() || `Áudio · ${timeLabel}`,
            content: quickText.trim(),
            kind: 'media',
            audios: [
              {
                id: `aud-${Date.now()}`,
                dataUrl,
                mimeType: usedMime,
                durationSec,
                createdAt: new Date().toISOString(),
              },
            ],
            isPinned: true,
          });
          resetComposer();
          hapticSuccess();
        } catch {
          setQuickMediaError('Não foi possível salvar a gravação de áudio.');
        }
      };

      recorderRef.current = recorder;
      recorder.start(250);
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recStartRef.current) / 1000);
        setQuickRecordingSec(elapsed);
        if (elapsed >= MAX_DRAFT_AUDIO_SECONDS) {
          recorder.stop();
        }
      }, 250);
    } catch {
      stopQuickAudioTracks();
      setIsQuickRecording(false);
      setQuickMediaError('Permita o uso do microfone para gravar notas de voz.');
    }
  };

  const openEditor = (draft: DraftNote | null, mode: 'text' | 'list' | 'image' | 'audio' = 'text') => {
    hapticSelection();
    setEditingDraft(draft);
    setModalInitialMode(mode);
    setIsModalOpen(true);
  };

  const handleSaveFromModal = (
    draftData: Omit<DraftNote, 'id' | 'updatedAt'>,
    existingId?: string
  ) => {
    if (existingId) {
      updateDraftNote(existingId, draftData);
    } else {
      addDraftNote(draftData);
    }
  };

  return (
    <section className="space-y-2.5">
      {/* Cabeçalho compacto */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <StickyNote className="w-4 h-4 text-amber-500 shrink-0" />
          <h2 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            Rascunhos
          </h2>
          {draftNotes.length > 0 && (
            <span className="text-[11px] font-mono tabular-nums text-zinc-400">
              · {draftNotes.length}
            </span>
          )}
        </div>

        {draftNotes.length > 0 && (
          <div className="inline-flex items-center gap-0.5 bg-zinc-100 dark:bg-zinc-800/70 p-0.5 rounded-xl text-[11px] font-medium">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'pinned', label: 'Fixos' },
                { id: 'lists', label: 'Listas' },
                { id: 'media', label: 'Mídia' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  hapticSelection();
                  setFilterMode(tab.id);
                }}
                className={`pressable h-7 px-2 rounded-lg cursor-pointer whitespace-nowrap shrink-0 flex items-center justify-center ${
                  filterMode === tab.id
                    ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-2xs font-semibold'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Barra Única Estilo Google Keep: Digitar direto + Lista, Foto e Áudio à direita */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl p-2.5 space-y-2">
        <input
          ref={quickImageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleQuickImagePick(e.target.files);
            e.target.value = '';
          }}
        />

        {composerMode === 'idle' ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={quickText}
              onFocus={() => setComposerMode('text')}
              onChange={(e) => {
                setQuickText(e.target.value);
                setComposerMode('text');
              }}
              placeholder="Anotar rascunho..."
              className="flex-1 min-w-0 h-10 px-2.5 text-xs sm:text-sm bg-transparent text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setComposerMode('list');
              }}
              title="Nova lista concluível"
              aria-label="Nova lista"
              className="pressable w-10 h-10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center justify-center cursor-pointer shrink-0"
            >
              <ListChecks className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                quickImageInputRef.current?.click();
              }}
              title="Anexar imagem"
              aria-label="Anexar imagem"
              className="pressable w-10 h-10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center cursor-pointer shrink-0"
            >
              <ImageIcon className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleQuickAudio}
              title={isQuickRecording ? 'Parar e salvar áudio' : 'Gravar áudio rápido'}
              aria-label={isQuickRecording ? 'Parar e salvar áudio' : 'Gravar áudio rápido'}
              className={`pressable h-10 rounded-xl flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
                isQuickRecording
                  ? 'px-2.5 bg-rose-600 text-white text-xs font-semibold'
                  : 'w-10 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-rose-600 dark:hover:text-rose-400'
              }`}
            >
              {isQuickRecording ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="font-mono tabular-nums">
                    {formatAudioDuration(quickRecordingSec)}
                  </span>
                </>
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={() => openEditor(null, 'text')}
              title="Abrir rascunho completo"
              aria-label="Abrir rascunho completo"
              className="pressable w-10 h-10 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center cursor-pointer shrink-0"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : composerMode === 'text' ? (
          <form onSubmit={handleSaveInlineComposer} className="space-y-2 p-0.5">
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Título (opcional)"
                className="flex-1 h-9 px-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-zinc-50 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setComposerMode('list')}
                title="Converter em lista"
                aria-label="Converter em lista"
                className="pressable w-9 h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              >
                <ListChecks className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => quickImageInputRef.current?.click()}
                title="Anexar imagem"
                aria-label="Anexar imagem"
                className="pressable w-9 h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleToggleQuickAudio}
                title={isQuickRecording ? 'Parar áudio' : 'Gravar áudio'}
                aria-label={isQuickRecording ? 'Parar áudio' : 'Gravar áudio'}
                className={`pressable h-9 rounded-lg flex items-center justify-center gap-1 cursor-pointer shrink-0 ${
                  isQuickRecording
                    ? 'px-2 bg-rose-600 text-white text-xs font-semibold'
                    : 'w-9 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                }`}
              >
                {isQuickRecording ? (
                  <>
                    <Square className="w-3 h-3 fill-current" />
                    <span className="font-mono tabular-nums">
                      {formatAudioDuration(quickRecordingSec)}
                    </span>
                  </>
                ) : (
                  <Mic className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => openEditor(null, 'text')}
                title="Expandir editor"
                aria-label="Expandir editor"
                className="pressable w-9 h-9 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <textarea
              rows={2}
              autoFocus
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder="Escreva sua nota..."
              className="w-full px-2.5 py-2 text-xs sm:text-sm rounded-lg bg-zinc-50 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none resize-none"
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={resetComposer}
                className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!quickText.trim() && !quickTitle.trim()}
                className="pressable min-h-[36px] px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSaveInlineComposer} className="space-y-2 p-0.5">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder="Título da lista..."
                className="flex-1 h-9 px-2.5 text-xs sm:text-sm font-semibold rounded-lg bg-zinc-50 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => openEditor(null, 'list')}
                title="Expandir editor completo"
                aria-label="Expandir editor completo"
                className="pressable w-9 h-9 rounded-lg text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-center cursor-pointer shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {quickListDraft.length > 0 && (
              <div className="space-y-1">
                {quickListDraft.map((item, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 text-xs text-zinc-700 dark:text-zinc-200"
                  >
                    <span className="truncate">{item}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setQuickListDraft((prev) => prev.filter((_, i) => i !== idx))
                      }
                      aria-label="Remover item"
                      className="text-zinc-400 hover:text-rose-500 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <input
                type="text"
                autoFocus
                value={quickListInput}
                onChange={(e) => setQuickListInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && quickListInput.trim()) {
                    e.preventDefault();
                    setQuickListDraft((prev) => [...prev, quickListInput.trim()]);
                    setQuickListInput('');
                  }
                }}
                placeholder="Item da lista (Enter para adicionar)"
                className="flex-1 h-9 px-2.5 text-xs sm:text-sm rounded-lg bg-zinc-50 dark:bg-zinc-800/70 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  if (!quickListInput.trim()) return;
                  setQuickListDraft((prev) => [...prev, quickListInput.trim()]);
                  setQuickListInput('');
                }}
                aria-label="Adicionar item na lista"
                className="pressable w-9 h-9 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 flex items-center justify-center cursor-pointer"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={resetComposer}
                className="min-h-[36px] px-3 rounded-lg text-xs font-medium text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={quickListDraft.length === 0 && !quickListInput.trim()}
                className="pressable min-h-[36px] px-3.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-40 cursor-pointer"
              >
                Salvar lista
              </button>
            </div>
          </form>
        )}

        {quickMediaError && (
          <p className="text-xs text-rose-600 dark:text-rose-400 px-2">{quickMediaError}</p>
        )}
      </div>

      {/* Cards de Rascunho Compactos e Diretos */}
      {sortedDrafts.length === 0 ? (
        <div className="py-6 text-center bg-white dark:bg-zinc-900/50 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 space-y-1">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {draftNotes.length === 0
              ? 'Nenhum rascunho criado ainda'
              : 'Nenhum rascunho neste filtro'}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Digite acima ou toque nos ícones para criar listas, anexar fotos ou gravar áudio.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {sortedDrafts.map((draft) => {
            const items = draft.checklistItems || [];
            const completedCount = items.filter((i) => i.completed).length;
            const images = draft.images || [];
            const audios = draft.audios || [];
            const inlineInputVal = cardItemInputs[draft.id] || '';

            return (
              <article
                key={draft.id}
                className="p-3 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-2"
              >
                {/* Cabeçalho do card */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate">
                      {draft.title}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400 font-mono tabular-nums">
                      <span>
                        {new Date(draft.updatedAt).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                      {items.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {completedCount}/{items.length}
                          </span>
                        </>
                      )}
                      {images.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{images.length} foto(s)</span>
                        </>
                      )}
                      {audios.length > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{audios.length} áudio(s)</span>
                        </>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      togglePinDraft(draft.id);
                    }}
                    title={draft.isPinned ? 'Desafixar' : 'Fixar no topo'}
                    aria-label={draft.isPinned ? 'Desafixar rascunho' : 'Fixar rascunho'}
                    className={`pressable w-8 h-8 rounded-lg flex items-center justify-center shrink-0 cursor-pointer ${
                      draft.isPinned
                        ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40'
                        : 'text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {draft.isPinned ? <Pin className="w-3.5 h-3.5" /> : <PinOff className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Texto */}
                {draft.content && draft.content !== draft.title && (
                  <p className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                    {draft.content}
                  </p>
                )}

                {/* Checklist Interativo */}
                {items.length > 0 && (
                  <div className="space-y-0.5">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => toggleDraftChecklistItem(draft.id, item.id)}
                        className="w-full min-h-[34px] py-0.5 px-1 -mx-1 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/60 flex items-center gap-2 text-left cursor-pointer transition-colors"
                      >
                        <span
                          className={`w-4 h-4 rounded-sm flex items-center justify-center shrink-0 transition-colors border ${
                            item.completed
                              ? 'bg-emerald-600 border-emerald-600 text-white animate-check-pop'
                              : 'border-zinc-300 dark:border-zinc-600'
                          }`}
                        >
                          {item.completed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </span>
                        <span
                          className={`text-xs leading-snug ${
                            item.completed
                              ? 'line-through text-zinc-400 dark:text-zinc-500'
                              : 'text-zinc-800 dark:text-zinc-100'
                          }`}
                        >
                          {item.text}
                        </span>
                      </button>
                    ))}

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!inlineInputVal.trim()) return;
                        addDraftChecklistItem(draft.id, inlineInputVal);
                        setCardItemInputs((prev) => ({ ...prev, [draft.id]: '' }));
                      }}
                      className="flex items-center gap-1 pt-1"
                    >
                      <input
                        type="text"
                        value={inlineInputVal}
                        onChange={(e) =>
                          setCardItemInputs((prev) => ({ ...prev, [draft.id]: e.target.value }))
                        }
                        placeholder="+ Item..."
                        className="flex-1 h-8 px-2 text-xs rounded-lg bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none"
                      />
                      {inlineInputVal.trim() && (
                        <button
                          type="submit"
                          aria-label="Adicionar item"
                          className="pressable h-8 px-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </form>
                  </div>
                )}

                {/* Miniaturas de Imagens */}
                {images.length > 0 && (
                  <div className="grid grid-cols-3 gap-1.5">
                    {images.slice(0, 3).map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() =>
                          setPreviewImage({ dataUrl: img.dataUrl, title: draft.title })
                        }
                        className="relative aspect-square rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 cursor-pointer group"
                      >
                        <img
                          src={img.dataUrl}
                          alt={draft.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-150"
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* Reprodutor de Áudio */}
                {audios.length > 0 && (
                  <div className="space-y-1">
                    {audios.map((aud) => (
                      <DraftAudioPlayer key={aud.id} audio={aud} />
                    ))}
                  </div>
                )}

                {/* Ações diretas compactas */}
                <div className="flex items-center gap-1 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={() => openEditor(draft, 'text')}
                    className="pressable h-8 px-2 rounded-lg text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => convertDraftToTask(draft)}
                    className="pressable h-8 px-2 rounded-lg text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Virar tarefa</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hapticSelection();
                      deleteDraftNote(draft.id);
                    }}
                    aria-label={`Excluir ${draft.title}`}
                    className="pressable ml-auto w-8 h-8 rounded-lg text-zinc-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center justify-center cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Modal Completo (para mistura de mídia ou edição avançada) */}
      <RichDraftModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingDraft(null);
        }}
        editingDraft={editingDraft}
        initialMode={modalInitialMode}
        onSave={handleSaveFromModal}
      />

      {/* Lightbox de Imagem */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex flex-col items-center justify-center p-4 animate-backdrop-in"
        >
          <div className="w-full max-w-2xl flex items-center justify-between text-white pb-3">
            <span className="text-sm font-semibold truncate">{previewImage.title}</span>
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              aria-label="Fechar visualização"
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <img
            src={previewImage.dataUrl}
            alt={previewImage.title}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80dvh] max-w-full rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </section>
  );
};
