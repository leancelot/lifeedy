import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarPlus,
  Check,
  CheckSquare,
  DollarSign,
  Edit3,
  Image as ImageIcon,
  ListChecks,
  Maximize2,
  Mic,
  Pin,
  PinOff,
  Plus,
  Search,
  Square,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { DraftNote, FinanceCategory, TransactionType } from '../../types';
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
import {
  buildDraftSummaryNote,
  extractAmountFromDraftText,
  guessFinanceCategoryFromText,
  matchesDraftSearch,
} from '../../utils/draftConversionUtils';
import { formatLocalDateIso } from '../../utils/dateUtils';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import { DraftAudioPlayer } from './DraftAudioPlayer';

const RichDraftModal = lazyWithRetry(
  () => import('./RichDraftModal').then((m) => ({ default: m.RichDraftModal })),
  'rich-draft-modal'
);

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
    addTransaction,
    addLocalEvent,
  } = useApp();

  const [filterMode, setFilterMode] = useState<'all' | 'pinned' | 'lists' | 'media'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [conversionFeedback, setConversionFeedback] = useState<string | null>(null);

  // Convert to Finance modal state
  const [financeConvertDraft, setFinanceConvertDraft] = useState<DraftNote | null>(null);
  const [convTxType, setConvTxType] = useState<TransactionType>('despesa');
  const [convTxTitle, setConvTxTitle] = useState('');
  const [convTxAmount, setConvTxAmount] = useState('');
  const [convTxCategory, setConvTxCategory] = useState<FinanceCategory>('outros');
  const [convTxDate, setConvTxDate] = useState(() => formatLocalDateIso());

  // Convert to Event modal state
  const [eventConvertDraft, setEventConvertDraft] = useState<DraftNote | null>(null);
  const [convEvTitle, setConvEvTitle] = useState('');
  const [convEvNotes, setConvEvNotes] = useState('');
  const [convEvDate, setConvEvDate] = useState(() => formatLocalDateIso());
  const [convEvTime, setConvEvTime] = useState('09:00');
  const [convEvAllDay, setConvEvAllDay] = useState(false);

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
  const [quickMicDenied, setQuickMicDenied] = useState(false);
  const quickImageInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recStartRef = useRef<number>(0);

  useBackHandler(Boolean(previewImage), () => {
    setPreviewImage(null);
    return true;
  });

  useBackHandler(Boolean(financeConvertDraft), () => {
    setFinanceConvertDraft(null);
    return true;
  });

  useBackHandler(Boolean(eventConvertDraft), () => {
    setEventConvertDraft(null);
    return true;
  });

  const showTempFeedback = (msg: string) => {
    setConversionFeedback(msg);
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null;
      setConversionFeedback(null);
    }, 3200);
  };

  const openFinanceConversion = (draft: DraftNote) => {
    hapticSelection();
    const { title, notes } = buildDraftSummaryNote(draft);
    const fullText = `${draft.title}\n${draft.content}\n${notes}`;
    const detectedAmount = extractAmountFromDraftText(fullText);
    const guessedCategory = guessFinanceCategoryFromText(fullText);

    setConvTxType(guessedCategory === 'salario' || guessedCategory === 'freelance' ? 'receita' : 'despesa');
    setConvTxTitle(title);
    setConvTxAmount(detectedAmount !== null ? detectedAmount.toFixed(2) : '');
    setConvTxCategory(guessedCategory);
    setConvTxDate(formatLocalDateIso());
    setFinanceConvertDraft(draft);
  };

  const handleConfirmFinanceConversion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!financeConvertDraft) return;
    const parsedAmount = parseFloat(convTxAmount.replace(',', '.'));
    if (!convTxTitle.trim() || isNaN(parsedAmount) || parsedAmount <= 0) return;

    const { notes } = buildDraftSummaryNote(financeConvertDraft);
    hapticSuccess();
    addTransaction({
      type: convTxType,
      title: convTxTitle.trim(),
      amount: parsedAmount,
      category: convTxCategory,
      date: convTxDate || formatLocalDateIso(),
      paymentMethod: 'pix',
      notes: notes || undefined,
    });
    setFinanceConvertDraft(null);
    showTempFeedback(`"${convTxTitle.trim()}" lançado em Finanças.`);
  };

  const openEventConversion = (draft: DraftNote) => {
    hapticSelection();
    const { title, notes } = buildDraftSummaryNote(draft);
    setConvEvTitle(title);
    setConvEvNotes(notes);
    setConvEvDate(formatLocalDateIso());
    setConvEvTime('09:00');
    setConvEvAllDay(false);
    setEventConvertDraft(draft);
  };

  const handleConfirmEventConversion = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventConvertDraft || !convEvTitle.trim() || !convEvDate) return;

    if (convEvAllDay) {
      addLocalEvent({
        summary: convEvTitle.trim(),
        description: convEvNotes.trim() || undefined,
        allDay: true,
        date: convEvDate,
        startDateTime: `${convEvDate}T00:00:00Z`,
        endDateTime: `${convEvDate}T23:59:59Z`,
      });
    } else {
      const startDate = new Date(`${convEvDate}T${convEvTime || '09:00'}:00`);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      addLocalEvent({
        summary: convEvTitle.trim(),
        description: convEvNotes.trim() || undefined,
        startDateTime: startDate.toISOString(),
        endDateTime: endDate.toISOString(),
      });
    }

    showTempFeedback(`"${convEvTitle.trim()}" salvo na sua Agenda.`);
    hapticSuccess();
    setEventConvertDraft(null);
  };

  const sortedDrafts = useMemo(() => {
    const base = [...draftNotes]
      .filter((d) => matchesDraftSearch(d, searchQuery))
      .sort((a, b) => {
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
  }, [draftNotes, filterMode, searchQuery]);

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

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) {
        clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = null;
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.onstop = null;
          recorderRef.current.stop();
        } catch {
          // ignore cleanup stop errors
        }
      }
      stopQuickAudioTracks();
    };
  }, []);

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
    setQuickMicDenied(false);
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

    if (isAndroidNativeHealthSupported()) {
      const perm = await requestMediaPermission('microphone');
      if (!perm.granted) {
        setQuickMicDenied(true);
        setQuickMediaError('Permita o uso do microfone nas configurações do app para gravar notas de voz.');
        return;
      }
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
    } catch (err) {
      stopQuickAudioTracks();
      setIsQuickRecording(false);
      setQuickMicDenied(true);
      setQuickMediaError(describeMediaPermissionError(err, 'microphone'));
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

      {/* Busca rápida nos Rascunhos */}
      {draftNotes.length > 0 && (
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar rascunhos ou itens de lista..."
            aria-label="Buscar rascunhos"
            className="w-full h-9 pl-8 pr-8 text-xs rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Limpar busca de rascunhos"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 flex items-center justify-center cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {conversionFeedback && (
        <div className="px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {conversionFeedback}
        </div>
      )}

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
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1 text-xs text-rose-600 dark:text-rose-400">
            <span>{quickMediaError}</span>
            {quickMicDenied && isAndroidNativeHealthSupported() && (
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
                <div className="flex flex-wrap items-center gap-1 pt-1.5 border-t border-zinc-100 dark:border-zinc-800">
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
                    title="Transformar em tarefa"
                    className="pressable h-8 px-2 rounded-lg text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Tarefa</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openFinanceConversion(draft)}
                    title="Lançar em Finanças"
                    className="pressable h-8 px-2 rounded-lg text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    <span>Gasto</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openEventConversion(draft)}
                    title="Agendar evento"
                    className="pressable h-8 px-2 rounded-lg text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                  >
                    <CalendarPlus className="w-3.5 h-3.5" />
                    <span>Evento</span>
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

      {/* Modal Completo (carregado sob demanda) */}
      {isModalOpen && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

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

      {/* Modal: Converter Rascunho em Lançamento Financeiro */}
      {financeConvertDraft && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setFinanceConvertDraft(null);
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3" />
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Lançar em Finanças
              </h3>
              <button
                type="button"
                onClick={() => setFinanceConvertDraft(null)}
                aria-label="Fechar"
                className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmFinanceConversion} className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-1.5 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setConvTxType('despesa')}
                  className={`h-9 rounded-lg text-xs font-semibold cursor-pointer ${
                    convTxType === 'despesa'
                      ? 'bg-white dark:bg-zinc-700 text-rose-600 dark:text-rose-400 shadow-2xs'
                      : 'text-zinc-500'
                  }`}
                >
                  Despesa
                </button>
                <button
                  type="button"
                  onClick={() => setConvTxType('receita')}
                  className={`h-9 rounded-lg text-xs font-semibold cursor-pointer ${
                    convTxType === 'receita'
                      ? 'bg-white dark:bg-zinc-700 text-emerald-600 dark:text-emerald-400 shadow-2xs'
                      : 'text-zinc-500'
                  }`}
                >
                  Receita
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Título
                </label>
                <input
                  type="text"
                  required
                  value={convTxTitle}
                  onChange={(e) => setConvTxTitle(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Valor (R$)
                  </label>
                  <input
                    type="number"
                    required
                    step="0.01"
                    min="0.01"
                    autoFocus={!convTxAmount}
                    placeholder="0,00"
                    value={convTxAmount}
                    onChange={(e) => setConvTxAmount(e.target.value)}
                    className="w-full h-10 px-3 text-sm font-mono tabular-nums rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={convTxDate}
                    onChange={(e) => setConvTxDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Categoria
                </label>
                <select
                  value={convTxCategory}
                  onChange={(e) => setConvTxCategory(e.target.value as FinanceCategory)}
                  className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                >
                  <option value="alimentacao">Alimentação</option>
                  <option value="moradia">Moradia & Contas</option>
                  <option value="transporte">Transporte</option>
                  <option value="saude">Saúde</option>
                  <option value="educacao">Educação</option>
                  <option value="lazer">Lazer & Cultura</option>
                  <option value="salario">Salário</option>
                  <option value="freelance">Freelance</option>
                  <option value="investimentos">Investimentos</option>
                  <option value="outros">Outros</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFinanceConvertDraft(null)}
                  className="min-h-[40px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pressable min-h-[40px] px-4 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  Salvar lançamento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Converter Rascunho em Evento da Agenda */}
      {eventConvertDraft && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEventConvertDraft(null);
          }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet animate-bottom-sheet">
            <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3" />
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                Agendar Evento
              </h3>
              <button
                type="button"
                onClick={() => setEventConvertDraft(null)}
                aria-label="Fechar"
                className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmEventConversion} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                  Título do evento
                </label>
                <input
                  type="text"
                  required
                  value={convEvTitle}
                  onChange={(e) => setConvEvTitle(e.target.value)}
                  className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    required
                    value={convEvDate}
                    onChange={(e) => setConvEvDate(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Horário
                  </label>
                  <input
                    type="time"
                    disabled={convEvAllDay}
                    value={convEvTime}
                    onChange={(e) => setConvEvTime(e.target.value)}
                    className="w-full h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={convEvAllDay}
                  onChange={(e) => setConvEvAllDay(e.target.checked)}
                  className="w-4 h-4 rounded-sm text-indigo-600"
                />
                <span>Dia todo</span>
              </label>

              {convEvNotes && (
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Observações
                  </label>
                  <textarea
                    rows={2}
                    value={convEvNotes}
                    onChange={(e) => setConvEvNotes(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEventConvertDraft(null)}
                  className="min-h-[40px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pressable min-h-[40px] px-4 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  Salvar evento
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
