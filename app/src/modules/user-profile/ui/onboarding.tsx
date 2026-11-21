"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding, skipOnboarding } from "../application/onboarding.use-case";
import { EMPTY_ANSWERS, FIRST_REVIEWS, ROLES, STARTS, STEP_COUNT, type OnboardingAnswers } from "../domain/user-profile";
import { localUserProfileRepository } from "../infrastructure/local-user-profile.repository";
import styles from "./onboarding.module.css";

type Option = { id: string; label: string; hint?: string };
type Step = { field: keyof OnboardingAnswers; title: string; help: string; options: readonly Option[]; columns: 1 | 2 };

const STEPS: readonly Step[] = [
  { field: "role", title: "¿Qué te describe mejor?", help: "Así abrimos primero lo que más usas.", options: ROLES, columns: 2 },
  { field: "firstReview", title: "¿Qué quieres revisar primero?", help: "Puedes abrir el otro cuando quieras.", options: FIRST_REVIEWS, columns: 2 },
  { field: "start", title: "¿Con qué empiezas?", help: "La muestra ya está cargada: no tienes que subir nada.", options: STARTS, columns: 2 },
];

export function Onboarding() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<OnboardingAnswers>(EMPTY_ANSWERS);
  const [leaving, setLeaving] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const chosen = answers[step.field];

  // Each step announces itself: focus goes to its question, then Tab reaches the options.
  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  function choose(id: string) {
    if (leaving) return;
    const next = { ...answers, [step.field]: id } as OnboardingAnswers;
    setAnswers(next);
    if (index < STEPS.length - 1) {
      setIndex(index + 1);
      return;
    }
    setLeaving(true);
    router.replace(completeOnboarding(localUserProfileRepository, next));
  }

  function skip() {
    if (leaving) return;
    setLeaving(true);
    router.replace(skipOnboarding(localUserProfileRepository));
  }

  // Arrow keys move the focus inside the group; Enter or Space confirms, like the mouse.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...(group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const move: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let target = at;
    if (event.key in move) target = (at + move[event.key] + items.length) % items.length;
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = items.length - 1;
    else return;
    event.preventDefault();
    items[target].focus();
  }

  const tabStop = chosen ?? step.options[0].id;

  return (
    <main className={styles.screen}>
      <p className={styles.brand}>
        <svg viewBox="0 0 64 64" width="26" height="26" aria-hidden="true">
          <path fill="currentColor" d="M8 10h48l-8 10H18L8 26zM8 30l10-6v17L8 47zM8 51l10-6h30l8 10H8z" />
        </svg>
        ObraCota
      </p>

      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Progreso de la bienvenida"
        aria-valuemin={1}
        aria-valuemax={STEP_COUNT}
        aria-valuenow={index + 1}
        aria-valuetext={`Paso ${index + 1} de ${STEP_COUNT}`}
      >
        {STEPS.map((s, i) => (
          <span key={s.field} data-done={i <= index || undefined} />
        ))}
      </div>

      <section className={styles.card} aria-labelledby="onboarding-question">
        <p className={styles.count}>
          Paso {index + 1} de {STEP_COUNT}
        </p>
        <h1 id="onboarding-question" ref={heading} tabIndex={-1} className={styles.question}>
          {step.title}
        </h1>
        <p className={styles.help}>{step.help}</p>

        <div
          key={step.field}
          ref={group}
          role="radiogroup"
          aria-labelledby="onboarding-question"
          className={styles.options}
          data-columns={step.columns}
          onKeyDown={onKeyDown}
        >
          {step.options.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={chosen === option.id}
              tabIndex={option.id === tabStop ? 0 : -1}
              disabled={leaving}
              className={styles.option}
              onClick={() => choose(option.id)}
            >
              <span className={styles.label}>{option.label}</span>
              {option.hint && <span className={styles.hint}>{option.hint}</span>}
            </button>
          ))}
        </div>

        <div className={styles.footer}>
          {index > 0 ? (
            <button type="button" className={styles.link} disabled={leaving} onClick={() => setIndex(index - 1)}>
              Atrás
            </button>
          ) : (
            <span />
          )}
          <button type="button" className={styles.link} disabled={leaving} onClick={skip}>
            Omitir por ahora
          </button>
        </div>
      </section>

      <p className={styles.note} role="status">
        {leaving ? "Abriendo tu espacio de trabajo…" : "Tus respuestas se guardan en este navegador."}
      </p>
    </main>
  );
}
