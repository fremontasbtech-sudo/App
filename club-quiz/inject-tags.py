# Copies club-tags.json into the TAGS table in FirebirdHub/club-match.js.
# Run after editing club-tags.json: python3 club-quiz/inject-tags.py, then bump club-match.js?v= in index.html.
import json,re,os
here=os.path.dirname(os.path.abspath(__file__)); F=os.path.join(here,'..','FirebirdHub','club-match.js')
C={'light':'l','regular':'r','heavy':'h','unknown':'u'}; O={'open':'o','community':'c','selective':'s'}
out={}
for t in json.load(open(os.path.join(here,'club-tags.json'))):
    if 'name' not in t: continue
    e={'i':t['interests'],'a':t['activities'],'c':C[t['commitment']],'o':O[t['openness']]}
    if t.get('community'): e['m']=t['community']
    if t.get('confidence')=='low': e['q']='l'
    out[t['name']]=e
js=json.dumps(out,ensure_ascii=False,separators=(',',':'))
src=open(F).read()
src=re.sub(r'/\*TAGS_START\*/.*?/\*TAGS_END\*/', lambda m:'/*TAGS_START*/'+js+'/*TAGS_END*/', src, flags=re.S)
open(F,'w').write(src); print(len(out),'clubs written to club-match.js')
