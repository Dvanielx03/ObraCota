import { request, sessionStore, type AccessSession } from "@/core/http/http-client";
import type { SessionPort } from "../domain/session";

export const sessionHttp: SessionPort = {
  async identify(mode, credentials) {
    const session = await request<AccessSession>("auth/" + mode, { method: "POST", body: JSON.stringify(credentials) });
    sessionStore.set(session);
  },
  async logout() {
    await request<void>("auth/logout", { method: "POST" });
    sessionStore.set(null);
  },
};
