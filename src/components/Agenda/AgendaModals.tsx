import React from 'react';
import { Cake, CheckSquare, Edit3, MapPin, Trash2, X } from 'lucide-react';
import { hapticSelection } from '../../services/hapticsService';
import { CalendarEventCategory, LocalCalendarEvent } from '../../types';

interface AgendaEventCreateModalProps {
  isOpen: boolean;
  eventSummary: string;
  setEventSummary: (v: string) => void;
  eventDescription: string;
  setEventDescription: (v: string) => void;
  eventLocation: string;
  setEventLocation: (v: string) => void;
  eventAllDay: boolean;
  setEventAllDay: (v: boolean) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  eventStartTime: string;
  setEventStartTime: (v: string) => void;
  eventEndTime: string;
  setEventEndTime: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const AgendaEventCreateModal: React.FC<AgendaEventCreateModalProps> = ({
  isOpen,
  eventSummary,
  setEventSummary,
  eventDescription,
  setEventDescription,
  eventLocation,
  setEventLocation,
  eventAllDay,
  setEventAllDay,
  eventDate,
  setEventDate,
  eventStartTime,
  setEventStartTime,
  eventEndTime,
  setEventEndTime,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          hapticSelection();
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-lg bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
          <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Novo Compromisso</h3>
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onClose();
            }}
            className="pressable p-2 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Título do Compromisso *
            </label>
            <input
              type="text"
              required
              placeholder="Título do compromisso"
              value={eventSummary}
              onChange={(e) => setEventSummary(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Descrição
            </label>
            <textarea
              rows={2}
              placeholder="Detalhes do compromisso"
              value={eventDescription}
              onChange={(e) => setEventDescription(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
              Localização ou Link
            </label>
            <input
              type="text"
              placeholder="Local ou link"
              value={eventLocation}
              onChange={(e) => setEventLocation(e.target.value)}
              className="w-full px-3.5 py-2 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="unifiedAllDayCheckbox"
              checked={eventAllDay}
              onChange={(e) => setEventAllDay(e.target.checked)}
              className="w-4 h-4 rounded text-indigo-600 cursor-pointer"
            />
            <label
              htmlFor="unifiedAllDayCheckbox"
              className="text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer"
            >
              Evento de dia inteiro
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className={eventAllDay ? 'sm:col-span-3' : 'sm:col-span-1'}>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                Data *
              </label>
              <input
                type="date"
                required
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            {!eventAllDay && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Início *
                  </label>
                  <input
                    type="time"
                    required
                    value={eventStartTime}
                    onChange={(e) => setEventStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 mb-1">
                    Fim *
                  </label>
                  <input
                    type="time"
                    required
                    value={eventEndTime}
                    onChange={(e) => setEventEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
                  />
                </div>
              </>
            )}
          </div>

          <div className="pt-4 flex items-center justify-end gap-3 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onClose();
              }}
              className="pressable min-h-[40px] px-4 py-2 rounded-xl text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="pressable min-h-[40px] px-5 py-2 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 cursor-pointer"
            >
              Salvar Compromisso
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface AgendaEventDetailModalProps {
  selectedEvent: LocalCalendarEvent | null;
  isEditingEvent: boolean;
  setIsEditingEvent: (v: boolean) => void;
  editEventSummary: string;
  setEditEventSummary: (v: string) => void;
  editEventDate: string;
  setEditEventDate: (v: string) => void;
  editEventAllDay: boolean;
  setEditEventAllDay: (v: boolean) => void;
  editEventStartTime: string;
  setEditEventStartTime: (v: string) => void;
  editEventEndTime: string;
  setEditEventEndTime: (v: string) => void;
  editEventLocation: string;
  setEditEventLocation: (v: string) => void;
  renderCategoryIcon: (category?: CalendarEventCategory) => React.ReactNode;
  getEventDateStr: (ev: LocalCalendarEvent) => string;
  getEventTimeStr: (ev: LocalCalendarEvent) => string;
  onClose: () => void;
  onSaveEdit: (e: React.FormEvent) => void;
  onCreateTaskFromEvent: (ev: LocalCalendarEvent) => void;
  onDeleteEvent: (id: string) => void;
}

export const AgendaEventDetailModal: React.FC<AgendaEventDetailModalProps> = ({
  selectedEvent,
  isEditingEvent,
  setIsEditingEvent,
  editEventSummary,
  setEditEventSummary,
  editEventDate,
  setEditEventDate,
  editEventAllDay,
  setEditEventAllDay,
  editEventStartTime,
  setEditEventStartTime,
  editEventEndTime,
  setEditEventEndTime,
  editEventLocation,
  setEditEventLocation,
  renderCategoryIcon,
  getEventDateStr,
  getEventTimeStr,
  onClose,
  onSaveEdit,
  onCreateTaskFromEvent,
  onDeleteEvent,
}) => {
  if (!selectedEvent) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />

        <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
              {renderCategoryIcon(selectedEvent.eventCategory)}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate">
                {selectedEvent.summary || 'Compromisso'}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {selectedEvent.eventCategory === 'birthday'
                  ? 'Aniversário'
                  : selectedEvent.eventCategory === 'holiday'
                  ? 'Feriado'
                  : selectedEvent.eventCategory === 'commemorative'
                  ? 'Data comemorativa'
                  : selectedEvent.calendarSummary || 'Agenda'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="pressable w-9 h-9 rounded-full text-zinc-400 hover:text-zinc-600 flex items-center justify-center cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isEditingEvent ? (
          <form onSubmit={onSaveEdit} className="mt-4 space-y-3">
            <input
              type="text"
              required
              value={editEventSummary}
              onChange={(e) => setEditEventSummary(e.target.value)}
              placeholder="Título do evento"
              className="w-full h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <input
              type="date"
              required
              value={editEventDate}
              onChange={(e) => setEditEventDate(e.target.value)}
              className="w-full h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={editEventAllDay}
                onChange={(e) => setEditEventAllDay(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span>Dia todo</span>
            </label>
            {!editEventAllDay && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={editEventStartTime}
                  onChange={(e) => setEditEventStartTime(e.target.value)}
                  className="h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
                <input
                  type="time"
                  value={editEventEndTime}
                  onChange={(e) => setEditEventEndTime(e.target.value)}
                  className="h-10 px-3 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}
            <input
              type="text"
              value={editEventLocation}
              onChange={(e) => setEditEventLocation(e.target.value)}
              placeholder="Local (opcional)"
              className="w-full h-10 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingEvent(false)}
                className="min-h-[40px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
              >
                Voltar
              </button>
              <button
                type="submit"
                className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 text-white text-xs font-semibold cursor-pointer"
              >
                Salvar
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="space-y-2 text-xs sm:text-sm text-zinc-600 dark:text-zinc-300">
              <p className="font-mono tabular-nums text-zinc-800 dark:text-zinc-200">
                Data: {getEventDateStr(selectedEvent)} · {getEventTimeStr(selectedEvent)}
              </p>
              {selectedEvent.location && (
                <p className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-zinc-400 shrink-0" />
                  <span>{selectedEvent.location}</span>
                </p>
              )}
              {selectedEvent.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {selectedEvent.description}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  onCreateTaskFromEvent(selectedEvent);
                  onClose();
                }}
                className="pressable min-h-[44px] w-full px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckSquare className="w-4 h-4" />
                <span>Criar tarefa para esta data</span>
              </button>

              {(selectedEvent.source === 'local' || selectedEvent.source === 'ics_import') &&
                selectedEvent.editable !== false && (
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setIsEditingEvent(true)}
                      className="pressable min-h-[42px] px-3 rounded-xl border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Editar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const id = selectedEvent.id;
                        onClose();
                        onDeleteEvent(id);
                      }}
                      className="pressable min-h-[42px] px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Excluir</span>
                    </button>
                  </div>
                )}

              {selectedEvent.source === 'local_special' && (
                <button
                  type="button"
                  onClick={() => {
                    const id = selectedEvent.id;
                    onClose();
                    onDeleteEvent(id);
                  }}
                  className="pressable min-h-[42px] w-full px-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remover data salva</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

interface AgendaSpecialDateModalProps {
  isOpen: boolean;
  specialTitle: string;
  setSpecialTitle: (v: string) => void;
  specialCategory: 'birthday' | 'commemorative' | 'holiday';
  setSpecialCategory: (v: 'birthday' | 'commemorative' | 'holiday') => void;
  specialDate: string;
  setSpecialDate: (v: string) => void;
  specialRecurring: boolean;
  setSpecialRecurring: (v: boolean) => void;
  specialNotes: string;
  setSpecialNotes: (v: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const AgendaSpecialDateModal: React.FC<AgendaSpecialDateModalProps> = ({
  isOpen,
  specialTitle,
  setSpecialTitle,
  specialCategory,
  setSpecialCategory,
  specialDate,
  setSpecialDate,
  specialRecurring,
  setSpecialRecurring,
  specialNotes,
  setSpecialNotes,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-backdrop-in keyboard-modal-backdrop"
    >
      <div className="w-full sm:max-w-md bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-6 keyboard-modal-sheet overflow-y-auto animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />
        <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Cake className="w-5 h-5 text-violet-500" />
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
              Novo Aniversário ou Data
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="pressable w-9 h-9 rounded-full text-zinc-400 hover:text-zinc-600 flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="text"
            required
            autoFocus
            value={specialTitle}
            onChange={(e) => setSpecialTitle(e.target.value)}
            placeholder="Nome (ex: Aniversário da Maria)"
            className="w-full h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
          />

          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { id: 'birthday', label: 'Aniversário' },
                { id: 'commemorative', label: 'Comemorativa' },
                { id: 'holiday', label: 'Feriado local' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  hapticSelection();
                  setSpecialCategory(cat.id);
                }}
                className={`min-h-[40px] px-2 rounded-xl text-xs font-semibold border cursor-pointer ${
                  specialCategory === cat.id
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <input
            type="date"
            required
            value={specialDate}
            onChange={(e) => setSpecialDate(e.target.value)}
            className="w-full h-11 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
          />

          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={specialRecurring}
              onChange={(e) => setSpecialRecurring(e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <span>Repetir todos os anos</span>
          </label>

          <input
            type="text"
            value={specialNotes}
            onChange={(e) => setSpecialNotes(e.target.value)}
            placeholder="Observação ou ideia de presente (opcional)"
            className="w-full h-10 px-3.5 text-sm rounded-xl bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 focus:outline-none"
          />

          <div className="pt-2 flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl text-xs font-medium text-zinc-600 dark:text-zinc-300 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!specialTitle.trim()}
              className="pressable min-h-[44px] px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              Salvar Data
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
