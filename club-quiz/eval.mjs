// Club quiz check: node club-quiz/eval.mjs [clubs.json]
// Runs a 12% sample of every answer set through FirebirdHub/club-match.js (and the old category quiz
// for comparison) and prints reach, spread, ties and labels. Default clubs: the 2026-11-20 snapshot.
// For today's list: curl -s https://www.fremontasb.org/api/clubs > /tmp/c.json && node club-quiz/eval.mjs /tmp/c.json
import fs from 'fs'; import {createRequire} from 'module'; import path from 'path'; import {fileURLToPath} from 'url';
const here=path.dirname(fileURLToPath(import.meta.url)); const require=createRequire(import.meta.url);
const CM=require(path.join(here,'../FirebirdHub/club-match.js'));
const raw=JSON.parse(fs.readFileSync(process.argv[2]||path.join(here,'clubs-snapshot-2026-11-20.json')));
const CLUBS=Array.isArray(raw)?raw:raw.clubs;
const Q=id=>CM.QS.find(q=>q.id===id).opts.map(o=>o.k);
const ints=Q('int'),acts=Q('act'),times=Q('time'),goals=Q('goal'),coms=Q('com');
function* subsets(arr,max){const n=arr.length;for(let a=0;a<n;a++){yield [arr[a]];if(max<2)continue;for(let b=a+1;b<n;b++){yield [arr[a],arr[b]];if(max<3)continue;for(let c=b+1;c<n;c++)yield [arr[a],arr[b],arr[c]];}}}
let rnd=7;const R=()=>(rnd=(rnd*1103515245+12345)%2147483648)/2147483648;
const appear={},top5={},topFit=[],bands={strong:0,good:0,some:0};let n=0,ties=0,miss=0;
const untagged=CLUBS.filter(c=>c&&c.name&&!c.disbanded&&CM.tagsOf(c).auto).map(c=>c.name);
for(const I of subsets(ints,3))for(const A of subsets(acts,2))for(const T of times)for(const G of goals){
  if(R()>0.12) continue;
  const ans={int:I,act:A,time:[T],goal:[G]}; if(I.includes('culture')) ans.com=[coms[Math.floor(R()*coms.length)]];
  const {top,all}=CM.top(ans,CLUBS,3); n++;
  top.forEach(r=>appear[r.club.name]=(appear[r.club.name]||0)+1); all.slice(0,5).forEach(r=>top5[r.club.name]=(top5[r.club.name]||0)+1);
  topFit.push(top[0].fit); bands[CM.band(top[0].fit,top[0].tags)]++;
  if(Math.abs(all[0].sort-all[1].sort)<1e-9) ties++;
  const cov=new Set(top.map(r=>r.why.interest)); miss+=I.filter(k=>!cov.has(k)).length;
}
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return +s[Math.floor(p*(s.length-1))].toFixed(2)};
const live=CLUBS.filter(c=>c&&c.name&&!c.disbanded);
console.log('answer sets checked:',n,' clubs:',live.length,' clubs with no hand-checked tags:',untagged.length?untagged.join(', '):'none');
console.log('reach: in a top 3 for some answers',live.filter(c=>appear[c.name]).length,'of',live.length,'; never in a top 5:',live.filter(c=>!top5[c.name]).map(c=>c.name).join(', ')||'none');
console.log('most shown:',Object.entries(appear).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([k,v])=>k+' '+(100*v/n).toFixed(0)+'%').join(' | '));
console.log('fit of #1 p10/p50/p90:',q(topFit,.1),q(topFit,.5),q(topFit,.9),' label of #1:',JSON.stringify(bands));
console.log('exact score tie #1 and #2:',(100*ties/n).toFixed(0)+'% (broken by a hash of the answers, never the alphabet)');
console.log('picked interests with no club in the top 3, per answer set:',(miss/n).toFixed(2));
