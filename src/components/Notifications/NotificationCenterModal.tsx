import React from 'react';
import {
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  Cake,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  HardDrive,
  Lock,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { useFinance, usePlanner, useWorkspace } from '../../context/AppContext';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticSelection, hapticSuccess } from '../../services/hapticsService';
import { LocalCalendarEvent } from '../../types';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenAgenda?: () => void;
  onOpenFinance?: () => void;
  onOpenBackupSettings?: () => void;
  isFinanceLocked?: boolean;
}

const toLocalDateStr = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(
    2,
    '0'
  )}`;

const getEventDateKey = (ev: LocalCalendarEvent): string => {
  if (ev.start?.date) return ev.start.date.slice(0, 10);
  if (ev.start?.dateTime) return toLocalDateStr(new Date(ev.start.dateTime));
  return '';
};

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  onOpenAgenda,
  onOpenFinance,
  onOpenBackupSettings,
  isFinanceLocked = false,
}) => {
  const { backupHealth } = useWorkspace();
  const {
    pendingBankNotifications,
    hideValues,
    formatMoney,
    financeLockEnabled,
  } = useFinance();
  const {
    notificationsList,
    notificationPermission,
    enableNotifications,
    triggerTestNotification,
    dismissNotification,
    clearAllNotifications,
    tasks,
    toggleTaskCompletion,
    calendarEvents,
  } = usePlanner();

  useBackHandler(isOpen, () => {
    onClose();
    return true;
  });

  if (!isOpen) return null;

  const todayStr = toLocalDateStr(new Date());
  const dueTodayTasks = tasks.filter((t) => !t.completed && t.dueDate === todayStr);
  const todayEvents = calendarEvents.filter((ev) => getEventDateKey(ev) === todayStr);
  const shouldMaskFinance = Boolean(isFinanceLocked || financeLockEnabled || hideValues);
  const pendingTotal = pendingBankNotifications.reduce((acc, item) => acc + (item.amount || 0), 0);

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
      <div className="w-full sm:max-w-lg max-h-[90dvh] bg-white dark:bg-zinc-900 border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-7 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] sm:pb-7 keyboard-modal-sheet flex flex-col relative animate-bottom-sheet">
        <div className="sm:hidden w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 mx-auto mb-3 shrink-0" />

        <button
          type="button"
          onClick={() => {
            hapticSelection();
            onClose();
          }}
          className="pressable absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          aria-label="Fechar"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3 mb-5 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-xs">
            <BellRing className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Notificações & Lembretes
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Central única de alertas, prazos e lembretes de hoje
            </p>
          </div>
        </div>

        {/* Permission / Controls (Único lugar no app para gerenciar alertas) */}
        <div className="p-3.5 mb-4 rounded-2xl border transition-colors flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-800/40 border-zinc-200 dark:border-zinc-700/60">
          <div className="flex items-center gap-2.5 min-w-0">
            {notificationPermission === 'granted' ? (
              <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
                <BellOff className="w-4 h-4" />
              </div>
            )}
            <div className="min-w-0">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 block truncate">
                {notificationPermission === 'granted'
                  ? 'Notificações Ativas'
                  : 'Notificações Desativadas'}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                {notificationPermission === 'granted'
                  ? 'Alertas visuais para tarefas e agenda'
                  : 'Ative para receber avisos de horários'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {notificationPermission === 'granted' ? (
              <button
                type="button"
                onClick={triggerTestNotification}
                className="pressable min-h-[36px] px-2.5 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-[11px] font-semibold text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                Testar Alerta
              </button>
            ) : (
              <button
                type="button"
                onClick={enableNotifications}
                className="pressable min-h-[36px] px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
              >
                Ativar Agora
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Pendências Financeiras & Lembrete de Backup */}
          {(pendingBankNotifications.length > 0 || backupHealth.shouldRemind) && (
            <div className="space-y-2">
              {pendingBankNotifications.length > 0 && (
                <div className="p-3.5 rounded-2xl bg-violet-50/70 dark:bg-violet-950/25 border border-violet-200/80 dark:border-violet-900/50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-800 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                      {isFinanceLocked ? (
                        <Lock className="w-4 h-4" />
                      ) : (
                        <Wallet className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        {pendingBankNotifications.length} lançamento(s) bancário(s) pendente(s)
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 truncate">
                        {shouldMaskFinance
                          ? 'Valores ocultos pela privacidade · revise na aba Finanças'
                          : `Total aguardando confirmação: ${formatMoney(pendingTotal)}`}
                      </p>
                    </div>
                  </div>
                  {onOpenFinance && (
                    <button
                      type="button"
                      onClick={() => {
                        hapticSelection();
                        onClose();
                        onOpenFinance();
                      }}
                      className="pressable min-h-[36px] px-3 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      <span>Revisar em Finanças</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}

              {backupHealth.shouldRemind && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-900/50 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <HardDrive className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
                        Backup portátil recomendado
                      </p>
                      <p className="text-[11px] text-zinc-600 dark:text-zinc-400 line-clamp-2">
                        {backupHealth.daysSinceLastBackup !== null
                          ? `Último backup há ${backupHealth.daysSinceLastBackup} dia(s). Exporte uma cópia cifrada recente.`
                          : 'Nenhum backup portátil exportado ainda. Proteja seus dados locais.'}
                      </p>
                    </div>
                  </div>
                  {onOpenBackupSettings && (
                    <button
                      type="button"
                      onClick={() => {
                        hapticSelection();
                        onClose();
                        onOpenBackupSettings();
                      }}
                      className="pressable min-h-[36px] px-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      <span>Fazer backup</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Lembretes de Hoje (Tarefas + Eventos/Aniversários) */}
          {(dueTodayTasks.length > 0 || todayEvents.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Para Hoje ({dueTodayTasks.length + todayEvents.length})</span>
                </span>
                {onOpenAgenda && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenAgenda();
                    }}
                    className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    <span>Ver na Agenda</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {todayEvents.map((ev) => (
                  <div
                    key={`notif-ev-${ev.id}`}
                    className="p-3 rounded-2xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-100 dark:border-violet-900/40 flex items-center justify-between gap-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-white dark:bg-zinc-800 flex items-center justify-center shrink-0">
                        {ev.eventCategory === 'birthday' ? (
                          <Cake className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                        ) : ev.eventCategory === 'holiday' || ev.eventCategory === 'commemorative' ? (
                          <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        ) : (
                          <Calendar className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                          {ev.summary || 'Compromisso'}
                        </p>
                        <p className="text-[10px] font-mono tabular-nums text-violet-700 dark:text-violet-300 font-medium">
                          {ev.start?.dateTime
                            ? new Date(ev.start.dateTime).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Dia todo'}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}

                {dueTodayTasks.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      hapticSuccess();
                      toggleTaskCompletion(t.id);
                    }}
                    className="w-full text-left p-3 rounded-2xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/40 hover:bg-indigo-50 dark:hover:bg-indigo-950/35 flex items-center justify-between gap-2.5 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-5 h-5 rounded-md border-2 border-indigo-300 dark:border-indigo-600 flex items-center justify-center shrink-0 text-transparent hover:border-indigo-500">
                        <Check className="w-3 h-3" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate">
                          {t.title}
                        </p>
                        {t.dueTime && (
                          <p className="text-[10px] font-mono tabular-nums text-indigo-600 dark:text-indigo-400 font-medium">
                            Horário limite: {t.dueTime}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                      Concluir
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Histórico de Notificações */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                Histórico Recente ({notificationsList.length})
              </span>
              {notificationsList.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllNotifications}
                  className="text-[11px] text-zinc-400 hover:text-rose-500 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>Limpar tudo</span>
                </button>
              )}
            </div>

            {notificationsList.length === 0 ? (
              <div className="py-8 text-center text-zinc-400 dark:text-zinc-500 space-y-1">
                <Bell className="w-8 h-8 mx-auto stroke-1 opacity-40 mb-1" />
                <p className="text-xs font-medium">Nenhum alerta recente</p>
                <p className="text-[11px]">Você será avisado quando houver prazos ou novidades.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notificationsList.map((notif) => (
                  <div
                    key={notif.id}
                    className="p-3 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800/80 flex items-start justify-between gap-3 group"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                          {notif.title}
                        </span>
                        <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                          {new Date(notif.timestamp).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                        {notif.body}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => dismissNotification(notif.id)}
                      title="Excluir notificação"
                      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="pressable min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
