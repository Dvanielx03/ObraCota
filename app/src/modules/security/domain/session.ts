export interface Credentials { email: string; password: string }
export interface SessionPort {
  identify(mode: "login" | "register", credentials: Credentials): Promise<void>;
  /** Signs in (or creates the account) with the ID token Google Identity Services returns. */
  /** Signs in with Google; true when this sign-in created the account. */
  google(credential: string): Promise<boolean>;
  logout(): Promise<void>;
}
