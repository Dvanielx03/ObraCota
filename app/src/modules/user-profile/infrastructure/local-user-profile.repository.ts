import { isUserProfile, type UserProfile } from "../domain/user-profile";
import type { UserProfileRepository } from "../domain/user-profile.repository";

const KEY = "obracota.onboarding.v1";

/**
 * Browser adapter. Storage can be unavailable (private window, blocked site data): reads
 * then answer "not completed" and writes are dropped, so the onboarding simply shows again.
 */
export const localUserProfileRepository: UserProfileRepository = {
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      // The test suite marks it as seen with a bare flag, like the viewer guide.
      if (raw === "seen") return { role: null, firstReview: null, start: null, completedAt: "", skipped: true };
      const parsed: unknown = JSON.parse(raw);
      return isUserProfile(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  save(profile: UserProfile) {
    try {
      localStorage.setItem(KEY, JSON.stringify(profile));
    } catch {
      /* Shown again next visit. */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* Nothing stored to remove. */
    }
  },
};
