// Usage: node scripts/report-db-transfer.mjs --hours 24 --cameras 1 --target-cameras 10 < capture.ndjson
import readline from 'node:readline';
const args = process.argv.slice(2);
function option(name, fallback) {
 const i=args.indexOf('--'+name); const value=i<0?fallback:Number(args[i+1]);
 if (!Number.isFinite(value)||value<=0) throw Error('Invalid --'+name); return value;
}
const hours=option('hours',24), cameras=option('cameras',1), target=option('target-cameras',cameras);
const flows=new Map();let count=0;
function visit(value) {
 if (typeof value==='string') {try {visit(JSON.parse(value));} catch {} return;}
 if (!value||typeof value!=='object') return;
 if (value.type==='db_transfer') {
  const row=flows.get(value.flow)||{calls:0,errors:0,rows:0,payload_bytes:0};
  row.calls++;row.errors+=value.ok?0:1;row.rows+=Number(value.rows)||0;row.payload_bytes+=Number(value.payload_bytes)||0;
  flows.set(value.flow,row);count++;return;
 }
 if(Array.isArray(value)) value.forEach(visit);else Object.values(value).forEach(visit);
}
for await (const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})) {try {visit(JSON.parse(line));} catch {}}
if(!count) {console.error('No db_transfer records found. Use NDJSON logs from both Pages and GPU worker.');process.exitCode=1;}
else {
 const bytes=[...flows.values()].reduce((n,r)=>n+r.payload_bytes,0);
 console.log(JSON.stringify({warning:'Application payload estimate, not billed network transfer. Log sampling or missing workers undercounts. Projection assumes same workload and dashboard usage per camera.',hours,cameras,target_cameras:target,records:count,payload_bytes:bytes,estimated_gb_per_camera_day:bytes/cameras/hours*24/1e9,estimated_gb_30_days_target:bytes/cameras/hours*24*30*target/1e9,flows:Object.fromEntries([...flows].sort((a,b)=>b[1].payload_bytes-a[1].payload_bytes))},null,2));
}
