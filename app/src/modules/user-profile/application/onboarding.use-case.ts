import { destinationFor, EMPTY_ANSWERS, type OnboardingAnswers, type UserProfile } from "../domain/user-profile";
import type { UserProfileRepository } from "../domain/user-profile.repository";

export function hasCompletedOnboarding(repository: UserProfileRepository): boolean {
  return repository.load() !== null;
}

/** Stores the answers and returns the route to open next. */
export function completeOnboarding(repository: UserProfileRepository, answers: OnboardingAnswers, now: Date = new Date()): string {
  const profile: UserProfile = { ...answers, completedAt: now.toISOString(), skipped: false };
  repository.save(profile);
  return destinationFor(answers);
}

/** Leaving early still counts as seen, so it never comes back on its own. */
export function skipOnboarding(repository: UserProfileRepository, now: Date = new Date()): string {
  repository.save({ ...EMPTY_ANSWERS, completedAt: now.toISOString(), skipped: true });
  return destinationFor(EMPTY_ANSWERS);
}

export function restartOnboarding(repository: UserProfileRepository): void {
  repository.clear();
}

/** Route after signing up or in: the onboarding first, then the usual destination. */
export function entryRoute(repository: UserProfileRepository, usual: string): string {
  return hasCompletedOnboarding(repository) ? usual : "/bienvenida";
}
