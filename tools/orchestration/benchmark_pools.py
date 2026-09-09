#!/usr/bin/env python3
"""Identical read-only Tovis tasks; deterministic scoring, no premium judge."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time
import pool_worker as pool


def tasks(repo):
    output=subprocess.check_output(['git','-C',str(repo),'grep','-n','-w','ConsultMentorDTO','--','*.ts','*.tsx'],text=True)
    hits=[];windows={}
    for line in output.splitlines():
        name,number,_=line.split(':',2);number=int(number);hits.append((name,number))
        windows.setdefault(name,set()).update(range(max(1,number-3),number+4))
    def excerpts(windows):
        rows=[]
        for name,numbers in windows.items():
            lines=(repo/name).read_text().splitlines()
            rows += ['%s:%d: %s'%(name,n,lines[n-1]) for n in sorted(numbers) if n<=len(lines)]
        return '\n'.join(rows)
    a=excerpts(windows)
    name='lib/consult/profileCalibration.test.ts'; lines=(repo/name).read_text().splitlines()
    b=excerpts({name:set(range(1,len(lines)+1))})
    tests=[(name,i) for i,line in enumerate(lines,1) if re.search(r"\bit\('",line)]
    rule_name='CLAUDE.md';rules=(repo/rule_name).read_text().splitlines()
    first=next(i for i,line in enumerate(rules,1) if "Don't guess" in line)
    c=excerpts({rule_name:set(range(first-2,first+14))})
    return [
      {'id':'A','class':'symbol-search','task':'Locate EVERY exact ConsultMentorDTO occurrence in the supplied tracked TypeScript inventory (definitions, imports, type usages and fields). Return one finding per matching source line with its exact full-line quote. Do not include unrelated lines. The local collector searched all tracked TS/TSX files; do not claim you ran that search yourself.','context':a,'expected':hits},
      {'id':'B','class':'test-coverage','task':'Identify every test case covering optional profile clarification in this test file. Return one finding for each it(...) test declaration, quoting only that full declaration line as evidence. State the test title exactly as your claim; do not claim the tests were executed.','context':b,'expected':tests},
      {'id':'C','class':'guidance','task':'State the house-rule heading that requires evidence before guessing/changing anything. Quote the full heading source line, and use that same heading text as your claim. Return one finding. Do not invent an audit-before-code or one-task rule if the supplied section does not contain it.','context':c,'expected':[(rule_name,first)]}
    ]


def prompt_for(task):
    return 'TASK:\n'+task['task']+'\nSOURCE EXCERPTS:\n'+task['context']


def score(answer,task):
    evidence=[e for f in answer['result']['findings'] for e in f['evidence']]
    got={(e['path'],e['line']) for e in evidence};expected=set(map(tuple,task['expected']))
    missing=expected-got;extra=got-expected;semantics=True
    if task['id'] in {'B','C'}:
        index=pool.evidence_index(task['context'])
        for f in answer['result']['findings']:
            for e in f['evidence']:
                source=index[(e['path'],e['line'])];title=re.search(r"it\('([^']+)'",source)
                heading=re.search(r'\*\*(.+?)\*\*',source)
                needle=title[1] if title else (heading[1] if heading else source.strip())
                if needle not in f['claim']:semantics=False
    return {'passed':not missing and not extra and semantics and len(evidence)==len(expected),'evidence_completeness':round(len(got&expected)/len(expected),3),'hallucinated_citations':len(extra),'formatting_reliable':True,'semantic_contract':semantics,'missing':[list(x) for x in sorted(missing)]}


def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[2]);p.add_argument('--models',nargs='+');p.add_argument('--output',type=Path,required=True);p.add_argument('--prepare-only',action='store_true');args=p.parse_args()
    cases=tasks(args.repo);results=[]
    commit=subprocess.check_output(['git','-C',str(args.repo),'rev-parse','HEAD'],text=True).strip()
    for task in cases:pool.screen(prompt_for(task))
    if args.prepare_only:
        args.output.write_text(json.dumps({'system':pool.SCHEMA_PROMPT,'prompts':[prompt_for(task) for task in cases]},indent=2)+'\n');return
    if not args.models:p.error('--models required for live test')
    for model in args.models:
        for task in cases:
            prompt=prompt_for(task)
            row={'model':model,'task':task['id'],'class':task['class'],'prompt_sha256':hashlib.sha256(prompt.encode()).hexdigest()};start=time.monotonic()
            try:
                answer=pool.call('free',model,prompt,{'max_input_bytes':32000,'max_output_tokens':1800,'timeout_seconds':45})
                row.update(score(answer,task));row['answer']=answer
            except Exception as exc:
                row.update(passed=False,error=str(exc) if isinstance(exc,pool.PoolError) else 'Runtime failure; details withheld')
            row['latency_seconds']=round(time.monotonic()-start,3);results.append(row)
            print(json.dumps({k:v for k,v in row.items() if k!='answer'}),flush=True)
            report={'commit':commit,'tasks':cases,'results':results,'scope':'Tracked TS/TSX symbol inventory; source coverage declarations; guidance extraction. No tests or model tools executed.'}
            args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n')


if __name__=='__main__':
    try: main()
    except KeyboardInterrupt: raise SystemExit('Benchmark interrupted; no retries.')
