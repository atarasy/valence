"""Independent Python encoder for fixed catalogue-v2 interoperability vectors."""
import copy,hashlib,json
from pathlib import Path
base={'version':'fixture-v2','presenter':'presenter','products':{'tea':{'merchant':'shop','maker':'maker','ships':'carrier','price':1200}}}
physical={'ambient':True,'keeps_for_days':365,'fits_ten_per_container':True,'regulated':False}
cases=[('absent-metadata',copy.deepcopy(base))]
c=copy.deepcopy(base);c['products']['tea']['physical']=copy.deepcopy(physical);cases.append(('eligible',c))
for field,value in [('ambient',False),('keeps_for_days',364),('fits_ten_per_container',False),('regulated',True)]:
 c=copy.deepcopy(cases[1][1]);c['products']['tea']['physical'][field]=value;cases.append(('changed-'+field,c))
c=copy.deepcopy(base);c['products']['tea']['physical']={'ambient':False,'keeps_for_days':0,'fits_ten_per_container':False,'regulated':False};cases.append(('present-false-zero',c))
c=copy.deepcopy(base);c['version']='v\n"\\';c['presenter']='提供者';c['products']['tea']['category']='a:b,c\n"\\\u2028';cases.append(('escaped-and-unicode',c))
c=copy.deepcopy(base);c['products']={key:copy.deepcopy(base['products']['tea']) for key in ['\ue000','😀','é','e\u0301']};cases.append(('utf16-order-no-normalisation',c))
c=copy.deepcopy(base);c['products']={};cases.append(('empty-catalogue',c))
result=[]
for name,c in cases:
 rows=[]
 for ref in sorted(c['products'],key=lambda s:s.encode('utf-16-be')):
  e=c['products'][ref];p=e.get('physical');eligibility=None if p is None else [p['ambient'],int(p['keeps_for_days']),p['fits_ten_per_container'],p['regulated']]
  rows.append([ref,e['merchant'],e['maker'],e['ships'],int(e['price']),e.get('category'),eligibility])
 canonical=json.dumps(['valence.catalogue.2',c['version'],c['presenter'],rows],ensure_ascii=False,separators=(',',':'))
 result.append({'id':name,'config':c,'canonical':canonical,'sha256':hashlib.sha256(canonical.encode('utf-8')).hexdigest()})
out=Path(__file__).resolve().parents[1]/'test/fixtures/catalogue-v2-vectors.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(f'{len(result)} independent catalogue-v2 vectors written')
