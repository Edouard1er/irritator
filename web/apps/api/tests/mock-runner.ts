// Process-control fixture only. Never used by the production API or scientific integration tests.
import { catalog, runnerCapabilities } from '../../../packages/contracts/index.js';
const mode=process.argv[2];
const input: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer) => input.push(chunk));
process.stdin.resume();
if(mode==='hang') setInterval(()=>{},1000);
else if(mode==='stdout') {process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000);}
else if(mode==='stderr') {process.stderr.write('x'.repeat(10000));setInterval(()=>{},1000);}
else process.stdin.on('end',()=>{
  if (process.argv[3] === '--describe') process.stdout.write(JSON.stringify(mode === 'catalog-mismatch' ? {} : catalog));
  else if (process.argv[3] === '--capabilities') process.stdout.write(JSON.stringify(mode === 'capabilities-mismatch' ? { ...runnerCapabilities, resultVersions: { '3': 1 } } : runnerCapabilities));
  else if(mode==='capture-v3') process.stdout.write(Buffer.concat(input));
  else if(mode==='invalid' || mode==='malformed-v3') process.stdout.write('not json');
  else if(mode==='legacy-v3') process.stdout.write('{"schemaVersion":1,"status":"completed"}');
  else if(mode==='v3-error') {process.stdout.write('{"schemaVersion":1,"status":"failed","error":{"code":"INVALID_FACTOR","message":"fixture"}}');process.exitCode=2;}
  else if(mode==='success-on-failure') {process.stdout.write('{"schemaVersion":1,"status":"completed"}');process.exitCode=2;}
  else if(mode==='failure-on-success') process.stdout.write('{"schemaVersion":1,"status":"failed","error":{"code":"EXECUTION_ERROR","message":"fixture"}}');
  else if(mode==='failure') {process.stdout.write('{"schemaVersion":1,"status":"failed","error":{"code":"EXECUTION_ERROR","message":"fixture","engineCategory":2,"engineCode":10}}');process.exitCode=2;}
  else process.stdout.write('{}');
});
