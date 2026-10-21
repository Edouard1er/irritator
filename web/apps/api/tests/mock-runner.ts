// Process-control fixture only. Never used by the production API or scientific integration tests.
const mode=process.argv[2];
process.stdin.resume();
if(mode==='hang') setInterval(()=>{},1000);
else if(mode==='stdout') {process.stdout.write('x'.repeat(10000));setInterval(()=>{},1000);}
else if(mode==='stderr') {process.stderr.write('x'.repeat(10000));setInterval(()=>{},1000);}
else process.stdin.on('end',()=>{
  if(mode==='invalid') process.stdout.write('not json');
  else if(mode==='success-on-failure') {process.stdout.write('{"schemaVersion":1,"status":"completed"}');process.exitCode=2;}
  else if(mode==='failure-on-success') process.stdout.write('{"schemaVersion":1,"status":"failed","error":{"code":"EXECUTION_ERROR","message":"fixture"}}');
  else if(mode==='failure') {process.stdout.write('{"schemaVersion":1,"status":"failed","error":{"code":"EXECUTION_ERROR","message":"fixture","engineCategory":2,"engineCode":10}}');process.exitCode=2;}
  else process.stdout.write('{}');
});
