"""회사별 면접 자료 엑셀 → 클론 DB(company_interview_process, company_interview_question) INSERT SQL 만들기

    python3 -I scripts/import_company_interview.py <면접자료 엑셀> <SQL을 둘 폴더> [인재상 엑셀] [한 파일당 회사 수=60]

- '공식 정보 제공 현황'(704곳)과 '면접 전형(공식)'(581곳)을 ID로 합쳐 회사 1곳당 1줄(company_interview_process)
- '예상 질문(자체 작성)'은 회사마다 6문항(company_interview_question)
- 인재상 엑셀을 함께 주면 ID가 모두 인재상 DB에 있는지, 회사명이 다른 곳이 있는지 확인해서 알려 줌
- 만든 SQL은 클론 프로젝트(ZAVAPASS-clone)에서만 실행. 같은 키가 있으면 새 값으로 덮어씀(다시 넣어도 안전)
- 표 구조는 supabase/clone/003_company_interview.sql (002_company_talent.sql을 먼저 넣어야 함)
"""
import collections, os, runpy, sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
_t = runpy.run_path(os.path.join(HERE, 'import_company_talent.py'), run_name='lib')
clean, table, lit = _t['clean'], _t['table'], _t['lit']


def read(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    status = table(wb['공식 정보 제공 현황'], 'No')
    proc = {clean(r['ID']): r for r in table(wb['면접 전형(공식)'], 'No')}
    rows = []
    for s in status:
        cid = clean(s['ID'])
        p = proc.get(cid) or {}
        src_type = clean(p.get('출처 유형'))
        rows.append({
            'company_id': cid, 'sheet_name': clean(s['회사명']), 'provide_level': clean(s['공식 정보']),
            'provide_reason': clean(s['사유 (미제공·일부 제공)']), 'checked_url': clean(s['확인한 채용사이트·공고']),
            'stages': clean(p.get('전형 단계')),
            'interview_types': [x.strip() for x in str(p.get('면접 유형') or '').split(',') if x.strip()],
            'detail': clean(p.get('면접 세부(요약)')), 'base_posting': clean(p.get('기준 공고')),
            'posted_month': clean(p.get('공고일')), 'source_type': src_type, 'source_url': clean(p.get('출처')),
            'note': clean(p.get('비고')),
            'group_common': '그룹 공통' in (src_type or ''), 'secondary_source': '2차 출처' in (src_type or '')})
    questions = [{'company_id': clean(r['ID']), 'seq': int(r['#']), 'question': clean(r['예상 질문 (자체 작성)']),
                  'linked_talent': clean(r['연결 인재상']), 'eval_point': clean(r['평가포인트']), 'basis': clean(r['작성 기준'])}
                 for r in table(wb['예상 질문(자체 작성)'], 'No')]

    # 점검: 키 중복, 전형 탭에만 있는 ID, 제공 수준과 전형 유무가 맞는지, 회사마다 6문항인지
    ids = [r['company_id'] for r in rows]
    errs = []
    dup = [k for k, n in collections.Counter(ids).items() if n > 1]
    if dup: errs.append(f'제공 현황 ID 중복: {dup}')
    extra = sorted(set(proc) - set(ids))
    if extra: errs.append(f"'면접 전형' 탭에만 있는 ID: {extra}")
    bad = [r['company_id'] for r in rows if (r['provide_level'] == '미제공') == (r['company_id'] in proc)]
    if bad: errs.append(f'제공 수준과 전형 탭이 맞지 않는 ID: {bad[:10]}')
    qk = collections.Counter((q['company_id'], q['seq']) for q in questions)
    if any(n > 1 for n in qk.values()): errs.append('예상 질문 (ID, #) 중복')
    per = collections.Counter(q['company_id'] for q in questions)
    if set(per) != set(ids) or any(n != 6 for n in per.values()): errs.append('회사마다 예상 질문 6문항이 아님')
    if errs: sys.exit('\n'.join(errs))
    return rows, questions


def check_against_talent(rows, talent_xlsx):
    companies, _ = _t['read'](talent_xlsx)
    names = {c['id']: c['name'] for c in companies}
    missing = [r['company_id'] for r in rows if r['company_id'] not in names]
    if missing: sys.exit(f'인재상 DB에 없는 ID: {missing}')
    for r in rows:
        if r['sheet_name'] != names[r['company_id']]:
            print(f"  ※ 회사명이 다름 {r['company_id']}: 인재상 '{names[r['company_id']]}' / 면접 자료 '{r['sheet_name']}'")


def upsert(tbl, cols, key, items):
    vals = ',\n'.join('(' + ', '.join(lit(x[c]) for c in cols) + ')' for x in items)
    upd = ', '.join(f'{c} = excluded.{c}' for c in cols if c not in key) + ', updated_at = now()'
    return f'insert into public.{tbl} ({", ".join(cols)}) values\n{vals}\non conflict ({", ".join(key)}) do update set {upd};\n'


def main():
    src, out = sys.argv[1], sys.argv[2]
    talent = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].endswith('.xlsx') else None
    per = int(sys.argv[-1]) if sys.argv[-1].isdigit() else 60
    rows, questions = read(src)
    if talent: check_against_talent(rows, talent)
    os.makedirs(out, exist_ok=True)
    pcols = ['company_id', 'sheet_name', 'provide_level', 'provide_reason', 'checked_url', 'stages', 'interview_types', 'detail',
             'base_posting', 'posted_month', 'source_type', 'source_url', 'note', 'group_common', 'secondary_source']
    qcols = ['company_id', 'seq', 'question', 'linked_talent', 'eval_point', 'basis']
    files = []
    for i in range(0, len(rows), per):
        files.append(upsert('company_interview_process', pcols, ['company_id'], rows[i:i + per]))
    ids = [r['company_id'] for r in rows]
    for i in range(0, len(ids), per):
        part = set(ids[i:i + per])
        files.append(upsert('company_interview_question', qcols, ['company_id', 'seq'], [q for q in questions if q['company_id'] in part]))
    for n, sql in enumerate(files, 1):
        with open(os.path.join(out, f'{n:02d}.sql'), 'w', encoding='utf-8') as f:
            f.write(sql)
    lv = collections.Counter(r['provide_level'] for r in rows)
    print(f"회사 {len(rows)}곳 (제공 {lv['제공']} · 일부 제공 {lv['일부 제공']} · 미제공 {lv['미제공']}), "
          f'예상 질문 {len(questions)}개 → SQL 파일 {len(files)}개 ({out})')


if __name__ == '__main__':
    main()
