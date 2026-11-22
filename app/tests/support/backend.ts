import {expect,type APIRequestContext} from "@playwright/test";

/**
 * Waits until the API behind the app answers (any status under 500, e.g. 401 for an anonymous list). Right after a
 * backend restart the proxy answers 500/502 for a while; a suite that starts then fails for the environment, not
 * for the code (KNOWN_ISSUES #17).
 */
export async function backendReady(request:APIRequestContext,timeout=90_000){
  await expect.poll(async()=>{
    try{return (await request.get("/api/projects",{timeout:10_000})).status();}catch{return 0;}
  },{timeout,intervals:[500,1000,2000],message:"El backend no respondió a tiempo"}).toBeLessThan(500);
}
