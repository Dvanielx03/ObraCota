import {defineConfig} from "@playwright/test";
export default defineConfig({testDir:"./tests",timeout:120000,workers:1,expect:{timeout:25000},
  use:{baseURL:process.env.VIEWER_URL || "http://localhost:3201",channel:"msedge",
    storageState:{cookies:[],origins:[{origin:new URL(process.env.VIEWER_URL || "http://localhost:3201").origin,localStorage:[{name:"obracota.guide.v1",value:"seen"},{name:"obracota.onboarding.v1",value:"seen"},
      // The explorer dock starts folded for a first visit (as in the reference); most suites read it, so they start with it open.
      {name:"obracota.explorer.v1",value:"open"}]}]},
    launchOptions:{args:process.env.TEST_HARDWARE_GPU==="1"?[]:["--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]}}});
