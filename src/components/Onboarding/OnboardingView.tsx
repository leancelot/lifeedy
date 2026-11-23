import React, { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRight, Check, Moon, ShieldCheck, Sparkles, Sun, Upload, User } from 'lucide-react';
import { useWorkspace } from '../../context/AppContext';
import { hapticImpactLight, hapticSelection } from '../../services/hapticsService';
import { BackupImportModal } from '../Backup/BackupModals';

export const OnboardingView: React.FC = () => {
  const {
    theme,
    setThemeMode,
    userName,
    completeOnboarding,
  } = useWorkspace();

  const [nameInput, setNameInput] = useState(userName || '');
  const [pendingRestoreFile, setPendingRestoreFile] = useState<{
    name: string;
    size: number;
    content: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim()) return;
    completeOnboarding(nameInput.trim());
  };

  const handleBackupFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result;
      if (typeof content === 'string') {
        setPendingRestoreFile({
          name: file.name,
          size: file.size,
          content,
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col overflow-y-auto px-4 pt-[calc(max(env(safe-area-inset-top,0px),var(--safe-area-inset-top,0px))+2rem)] pb-[calc(max(env(safe-area-inset-bottom,0px),var(--safe-area-inset-bottom,0px))+var(--keyboard-inset,0px)+2rem)] transition-colors">
      <div className="w-full max-w-lg mx-auto my-auto bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-7">
        {/* Marca & Boas-vindas */}
        <header className="space-y-3">
          <div className="flex items-center gap-2.5 text-indigo-600 dark:text-indigo-400">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#DC7B62] to-[#BE6272] dark:from-[#F2A68E] dark:to-[#E69BA7] text-white dark:text-[#24120E] flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              Lifeedy
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100 text-balance">
            Seu espaço privado e offline
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
            Sem login obrigatório e sem conta na nuvem. Seus dados ficam protegidos no cofre local do aparelho.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 1. Nome do Usuário */}
          <div className="space-y-2">
            <label
              htmlFor="onboarding-name"
              className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300"
            >
              Como gostaria de ser chamado? *
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="onboarding-name"
                type="text"
                required
                autoComplete="name"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Digite seu nome"
                className="w-full h-12 pl-10 pr-4 text-sm rounded-2xl bg-zinc-50 dark:bg-zinc-800/70 border border-zinc-200 dark:border-zinc-700 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>
          </div>

          {/* 2. Tema Visual */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Tema visual
            </span>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  hapticSelection();
                  setThemeMode('light');
                }}
                className={`min-h-[56px] p-3.5 rounded-2xl border flex items-center justify-between transition-colors cursor-pointer ${
                  theme === 'light'
                    ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-semibold">
                  <Sun className="w-4 h-4 text-amber-500" />
                  Claro
                </span>
                {theme === 'light' && <Check className="w-4 h-4 text-indigo-600" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  hapticSelection();
                  setThemeMode('dark');
                }}
                className={`min-h-[56px] p-3.5 rounded-2xl border flex items-center justify-between transition-colors cursor-pointer ${
                  theme === 'dark'
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                    : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-800/40 text-zinc-700 dark:text-zinc-300 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <span className="flex items-center gap-2.5 text-sm font-semibold">
                  <Moon className="w-4 h-4 text-indigo-400" />
                  Escuro
                </span>
                {theme === 'dark' && <Check className="w-4 h-4 text-indigo-400" />}
              </button>
            </div>
          </div>

          {/* 3. Restaurar Backup Existente (Opcional) */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Trocando de celular? (Opcional)
            </span>

            <button
              type="button"
              onClick={() => {
                hapticImpactLight();
                fileInputRef.current?.click();
              }}
              className="w-full min-h-[52px] px-4 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 block">
                    Restaurar backup salvo
                  </span>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400 block truncate">
                    Aceita arquivo cifrado (.lifeedy) ou legado (.json)
                  </span>
                </div>
              </div>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">
                Selecionar
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={Capacitor.isNativePlatform() ? undefined : '.lifeedy,.json,application/json,application/octet-stream'}
              onChange={handleBackupFileSelected}
              className="hidden"
            />
          </div>

          <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              Cofre local cifrado no aparelho e biometria opcional disponíveis em Finanças.
            </span>
          </div>

          {/* Botão Primário */}
          <button
            type="submit"
            disabled={!nameInput.trim()}
            className="w-full min-h-[48px] px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <span>Começar a usar</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>
      </div>

      <BackupImportModal
        pendingFile={pendingRestoreFile}
        onClose={() => setPendingRestoreFile(null)}
        replaceWarning={false}
      />
    </div>
  );
};
