// Prints the top 3 (with labels and fit) for each realistic student profile in personas.mjs.
import fs from 'fs'; import {createRequire} from 'module'; import path from 'path'; import {fileURLToPath} from 'url';
import {P} from './personas.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)); const require=createRequire(import.meta.url);
const CM=require(path.join(here,'../FirebirdHub/club-match.js'));
const CLUBS=JSON.parse(fs.readFileSync(process.argv[2]||path.join(here,'clubs-snapshot-2026-11-20.json')));
P.forEach(([d,a],i)=>{const {top}=CM.top(a,Array.isArray(CLUBS)?CLUBS:CLUBS.clubs,3);console.log((i+1)+'. '+d+'\n   '+top.map(r=>r.club.name+' ('+CM.band(r.fit,r.tags)+' '+r.fit.toFixed(2)+')').join(' | '));});
