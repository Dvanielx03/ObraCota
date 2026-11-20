export interface Credentials { email: string; password: string }
export interface SessionPort {
  identify(mode: "login" | "register", credentials: Credentials): Promise<void>;
  logout(): Promise<void>;
}
