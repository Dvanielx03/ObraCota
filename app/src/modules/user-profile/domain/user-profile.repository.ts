import type { UserProfile } from "./user-profile";

/** Port: where the onboarding answers live. Today the browser; later the backend context. */
export interface UserProfileRepository {
  load(): UserProfile | null;
  save(profile: UserProfile): void;
  clear(): void;
}
