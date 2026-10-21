import { buildApp } from './app.js';
import { readConfig } from './config/index.js';

const config=readConfig();
const app=buildApp(config);
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close();});
try {
  await app.listen({host:config.host,port:config.port});
  console.log(`Irritator API: ${app.listeningOrigin}`);
} catch(error) {
  console.error(error); await app.close(); process.exitCode=1;
}
