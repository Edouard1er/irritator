import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Run with the existing Fastify and Next.js servers. Firefox uses Playwright's
// patched browser; an optional executable supports installations of EdgeCore.
export default defineConfig({
  ...base,
  testMatch:'lake-fullscreen.spec.ts',
  reporter:'list',
  outputDir:'../../../reports/lake-fullscreen',
  use:{baseURL:process.env.FRONTEND_URL??'http://127.0.0.1:3000',viewport:{width:1920,height:1080},
    trace:'retain-on-failure',screenshot:'only-on-failure',acceptDownloads:true},
  projects:[
    {name:'chrome',use:{browserName:'chromium',channel:'chrome'}},
    {name:'firefox',use:{browserName:'firefox',channel:undefined,
      launchOptions:{firefoxUserPrefs:{'full-screen-api.warning.timeout':0}}}},
    {name:'edge',use:{browserName:'chromium',channel:process.env.IRRITATOR_EDGE_EXECUTABLE?undefined:'msedge',
      launchOptions:process.env.IRRITATOR_EDGE_EXECUTABLE?{executablePath:process.env.IRRITATOR_EDGE_EXECUTABLE}:undefined}},
  ],
});
