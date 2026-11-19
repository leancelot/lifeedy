import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, X } from 'lucide-react';
import {
  QUICK_TOUR_STEPS,
  QuickTourTarget,
  findVisibleTourTarget,
} from '../../constants/quickTourSteps';
import { useBackHandler } from '../../context/BackNavigationContext';
import { hapticImpactLight, hapticSelection, hapticSuccess } from '../../services/hapticsService';

interface QuickTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (navigateTo?: QuickTourTarget) => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
}

const SPOTLIGHT_PAD = 6;
const TOOLTIP_WIDTH = 320;
const EDGE_MARGIN = 12;

export const QuickTourModal: React.FC<QuickTourModalProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [spotRect, setSpotRect] = useState<SpotlightRect | null>(null);

  const totalSteps = QUICK_TOUR_STEPS.length;
  const currentStep = QUICK_TOUR_STEPS[stepIndex] || QUICK_TOUR_STEPS[0];
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex === totalSteps - 1;

  useEffect(() => {
    if (isOpen) {
      setStepIndex(0);
    }
  }, [isOpen]);

  const measureTarget = useCallback(() => {
    if (!isOpen || typeof window === 'undefined') {
      setSpotRect(null);
      return;
    }
    const targetEl = findVisibleTourTarget(currentStep.selector);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!targetEl) {
      setSpotRect(null);
      return;
    }
    const r = targetEl.getBoundingClientRect();
    setSpotRect({
      top: Math.max(4, r.top - SPOTLIGHT_PAD),
      left: Math.max(4, r.left - SPOTLIGHT_PAD),
      width: Math.min(vw - 8, r.width + SPOTLIGHT_PAD * 2),
      height: Math.min(vh - 8, r.height + SPOTLIGHT_PAD * 2),
      vw,
      vh,
    });
  }, [isOpen, currentStep.selector]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    measureTarget();
    const raf = window.requestAnimationFrame(measureTarget);
    const onViewportChange = () => measureTarget();

    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [isOpen, measureTarget]);

  const handleDismiss = useCallback(() => {
    hapticSelection();
    onClose();
  }, [onClose]);

  const handlePrevious = useCallback(() => {
    if (stepIndex > 0) {
      hapticSelection();
      setStepIndex((prev) => Math.max(0, prev - 1));
    }
  }, [stepIndex]);

  const handleNextOrFinish = useCallback(() => {
    if (isLastStep) {
      hapticSuccess();
      onComplete();
    } else {
      hapticImpactLight();
      setStepIndex((prev) => Math.min(totalSteps - 1, prev + 1));
    }
  }, [isLastStep, onComplete, totalSteps]);

  useBackHandler(isOpen, () => {
    if (stepIndex > 0) {
      setStepIndex((prev) => Math.max(0, prev - 1));
      return true;
    }
    onClose();
    return true;
  });

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNextOrFinish();
      } else if (e.key === 'ArrowLeft' && stepIndex > 0) {
        handlePrevious();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, stepIndex, handleDismiss, handleNextOrFinish, handlePrevious]);

  if (!isOpen) return null;

  // Compute clamped floating tooltip coordinates relative to highlighted UI element
  const computeTooltipLayout = () => {
    if (!spotRect) {
      return {
        placeAbove: false,
        cardStyle: {
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: `min(calc(100vw - ${EDGE_MARGIN * 2}px), ${TOOLTIP_WIDTH}px)`,
        } as React.CSSProperties,
        arrowLeftPx: null as number | null,
      };
    }

    const { top, left, width, height, vw, vh } = spotRect;
    const cardWidth = Math.min(vw - EDGE_MARGIN * 2, TOOLTIP_WIDTH);
    const targetCenterX = left + width / 2;
    const targetCenterY = top + height / 2;
    const placeAbove = targetCenterY > vh * 0.52;

    const rawLeft = targetCenterX - cardWidth / 2;
    const clampedLeft = Math.max(EDGE_MARGIN, Math.min(vw - cardWidth - EDGE_MARGIN, rawLeft));
    const arrowLeftPx = Math.max(20, Math.min(cardWidth - 20, targetCenterX - clampedLeft));

    const cardStyle: React.CSSProperties = placeAbove
      ? {
          bottom: `${Math.max(EDGE_MARGIN, vh - top + 14)}px`,
          left: `${clampedLeft}px`,
          width: `${cardWidth}px`,
        }
      : {
          top: `${Math.min(vh - 180, top + height + 14)}px`,
          left: `${clampedLeft}px`,
          width: `${cardWidth}px`,
        };

    return { placeAbove, cardStyle, arrowLeftPx };
  };

  const { placeAbove, cardStyle, arrowLeftPx } = computeTooltipLayout();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-tour-title"
      className="fixed inset-0 z-50"
    >
      {/* Click shield + fallback dim if spotlight rect unavailable */}
      <div
        onClick={handleNextOrFinish}
        className={`fixed inset-0 transition-opacity duration-200 ${
          spotRect ? 'bg-transparent' : 'bg-black/65 backdrop-blur-xs'
        }`}
      />

      {/* Live cutout spotlight ring around the actual UI element */}
      {spotRect && (
        <button
          type="button"
          onClick={handleNextOrFinish}
          aria-label={`Avançar tutorial: ${currentStep.title}`}
          style={{
            top: `${spotRect.top}px`,
            left: `${spotRect.left}px`,
            width: `${spotRect.width}px`,
            height: `${spotRect.height}px`,
            borderRadius: `${currentStep.spotlightRadius}px`,
            boxShadow: '0 0 0 9999px rgba(10, 10, 14, 0.68)',
          }}
          className="fixed z-50 border-2 border-indigo-400 dark:border-indigo-300 bg-transparent cursor-pointer transition-all duration-200 ease-out focus:outline-none"
        />
      )}

      {/* Compact Coachmark Bubble */}
      <div
        key={currentStep.id}
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
        className="fixed z-[51] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl p-4 space-y-3 animate-sheet-up"
      >
        {/* Pointer arrow connecting card to live spotlight */}
        {arrowLeftPx !== null && (
          <span
            aria-hidden="true"
            style={{ left: `${arrowLeftPx - 6}px` }}
            className={`absolute w-3 h-3 rotate-45 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 ${
              placeAbove
                ? '-bottom-1.5 border-r border-b'
                : '-top-1.5 border-l border-t'
            }`}
          />
        )}

        {/* Header: Step Counter + Skip */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-mono tabular-nums font-bold text-indigo-600 dark:text-indigo-400">
            {currentStep.stepNumber} de {totalSteps}
          </span>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Fechar tutorial"
            className="pressable inline-flex items-center gap-1 min-h-[32px] px-2 rounded-lg text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <span>Pular</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Title & concise explanation */}
        <div className="space-y-1">
          <h2
            id="quick-tour-title"
            className="text-sm sm:text-base font-bold text-zinc-900 dark:text-zinc-100 leading-snug"
          >
            {currentStep.title}
          </h2>
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {currentStep.description}
          </p>
        </div>

        {/* Footer: 4 step dots + Next/Finish button */}
        <div className="pt-1 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Etapas">
            {QUICK_TOUR_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                role="tab"
                aria-selected={index === stepIndex}
                aria-label={`Ir para etapa ${step.stepNumber}`}
                onClick={() => {
                  hapticSelection();
                  setStepIndex(index);
                }}
                className="p-1 cursor-pointer"
              >
                <span
                  className={`block h-1.5 rounded-full transition-all ${
                    index === stepIndex
                      ? 'w-5 bg-indigo-600 dark:bg-indigo-400'
                      : 'w-1.5 bg-zinc-300 dark:bg-zinc-700'
                  }`}
                />
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isFirstStep && (
              <button
                type="button"
                onClick={handlePrevious}
                aria-label="Etapa anterior"
                className="pressable w-10 h-10 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center justify-center cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}

            <button
              type="button"
              onClick={handleNextOrFinish}
              className="pressable min-h-[40px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              {isLastStep ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Pronto</span>
                </>
              ) : (
                <>
                  <span>Próximo</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
