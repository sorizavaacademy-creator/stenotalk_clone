"""면접 자료 수집 대상·채용 직무 엑셀 + 2024·2025 기출 엑셀 → 클론 DB INSERT SQL 만들기

    python3 -I scripts/import_interview_collection.py <수집 대상·채용 직무 엑셀> <2024·2025 기출 엑셀> <SQL을 둘 폴더> [한 파일당 줄 수=300]

- '수집 대상 목록'(141곳) → interview_target
- '인재상DB 대조'(148건) → interview_target_talent (수집 대상 목록의 '인재상 DB ID' 칸과 같은지 확인)
- '채용 직무'(1,104줄) → interview_target_job. 공무원 줄은 '공무원 직렬' 탭과 맞춰 보고 확인상태를 붙임
- 2024·2025 기출(282문항) → interview_past_question. 출처 URL·출처 사이트·다시 확인하는 방법은 넣지 않음
- 작업용 시트(안내·현황·면접 기출 수집·기출 문항 입력)는 읽지 않음
- 만든 SQL은 클론 프로젝트(ZAVAPASS-clone)에서만 실행. 같은 키가 있으면 새 값으로 덮어씀(다시 넣어도 안전)
- 표 구조는 supabase/clone/018_interview_collection.sql (002_company_talent.sql을 먼저 넣어야 함)
"""
import collections, os, re, runpy, sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
_t = runpy.run_path(os.path.join(HERE, 'import_company_talent.py'), run_name='lib')
_i = runpy.run_path(os.path.join(HERE, 'import_company_interview.py'), run_name='lib')
clean, table, upsert = _t['clean'], _t['table'], _i['upsert']
CATEGORIES = ('대기업', '공기업', '공무원')
STATUS = ('확인', '부분확인', '미확인')
SITE_ID = re.compile(r'\s*\(L\d+\)')  # 비고에 남은 후기 사이트 기업 번호 (출처 정보라 뺌)


def num(v):
    s = clean(v)
    return int(s) if s and s.isdigit() else None


def read_targets(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    errs = []
    targets = []
    for r in table(wb['수집 대상 목록'], 'No'):
        targets.append({
            'key': clean(r['Key']), 'no': num(r['No']), 'priority': num(r['우선순위']), 'category': clean(r['구분']),
            'name': clean(r['수집 대상']),
            'talent_ids': [x.strip() for x in str(r['인재상 DB ID'] or '').split(',') if x.strip()],
            'group_memo': clean(r['정리 메모']), 'recruit_channel': clean(r['채용 채널']), 'recruit_method': clean(r['채용 방식']),
            'recent_posting': clean(r['최근 공고']), 'interview_process': clean(r['면접 전형']), 'research_memo': clean(r['조사 메모']),
            'job_count': num(r['채용 직무 수']) or 0, 'verify_status': clean(r['확인상태']), 'posting_source': clean(r['출처']),
            'original_checked': clean(r['원문 대조']), 'original_changes': clean(r['원문 대조 변경 내용']),
            'login_required': clean(r['로그인 필요'])})
    by_key = {t['key']: t for t in targets}
    dup = [k for k, n in collections.Counter(t['key'] for t in targets).items() if n > 1]
    if dup: errs.append(f'수집 대상 Key 중복: {dup}')
    dup = [k for k, n in collections.Counter(t['name'] for t in targets).items() if n > 1]
    if dup: errs.append(f'수집 대상 이름 중복: {dup}')
    bad = [t['key'] for t in targets if not t['key'] or not t['name'] or t['no'] is None or t['priority'] not in (1, 2, 3)
           or t['category'] not in CATEGORIES or t['verify_status'] not in STATUS]
    if bad: errs.append(f'수집 대상 값이 비었거나 맞지 않음: {bad}')

    # 인재상 DB 대조: 연결표와 수집 대상 목록의 '인재상 DB ID' 칸이 같은지
    links = [{'talent_id': clean(r['인재상 DB ID']), 'target_key': clean(r['→ 수집 대상 Key']), 'reason': clean(r['묶은 이유']),
              'target_name': clean(r['→ 수집 대상'])} for r in table(wb['인재상DB 대조'], '인재상 DB ID')]
    dup = [k for k, n in collections.Counter(l['talent_id'] for l in links).items() if n > 1]
    if dup: errs.append(f'인재상DB 대조 ID 중복: {dup}')
    bad = [l['talent_id'] for l in links if l['target_key'] not in by_key or by_key[l['target_key']]['name'] != l['target_name']]
    if bad: errs.append(f'인재상DB 대조의 수집 대상 Key·이름이 목록과 다름: {bad}')
    a = {(i, t['key']) for t in targets for i in t['talent_ids']}
    b = {(l['talent_id'], l['target_key']) for l in links}
    if a != b: errs.append(f"'인재상 DB ID' 칸과 인재상DB 대조가 다름: 목록에만 {sorted(a - b)[:5]} / 대조에만 {sorted(b - a)[:5]}")

    # 채용 직무 (대상 안에서 순서대로 seq)
    jobs, seq = [], collections.Counter()
    for r in table(wb['채용 직무'], 'No'):
        k = clean(r['Key'])
        if k not in by_key or by_key[k]['name'] != clean(r['수집 대상']):
            errs.append(f"채용 직무 No {r['No']}: Key·수집 대상이 목록과 다름 ({k})")
            continue
        seq[k] += 1
        jobs.append({'target_key': k, 'seq': seq[k], 'division': clean(r['부문·채용구분']), 'job_group': clean(r['직무군·직렬']),
                     'job_detail': clean(r['세부 직무·직류']), 'note': clean(r['비고']), 'verify_status': None})
    bad = [t['key'] for t in targets if seq[t['key']] != t['job_count']]
    if bad: errs.append(f'채용 직무 수가 목록과 다름: {bad}')

    # 공무원 직렬: 채용 직무의 공무원 줄과 같은 순서·같은 값인지 보고 확인상태를 붙임
    gov_jobs = [j for j in jobs if by_key[j['target_key']]['category'] == '공무원']
    gov = list(table(wb['공무원 직렬'], 'No'))
    if len(gov) != len(gov_jobs):
        errs.append(f'공무원 직렬 {len(gov)}줄 ≠ 채용 직무의 공무원 줄 {len(gov_jobs)}줄')
    for j, g in zip(gov_jobs, gov):
        same = (clean(g['Key']), clean(g['급수·채용 구분']), clean(g['직군·직렬']), clean(g['직류']), clean(g['비고 (인원·과목 등)'])) == \
               (j['target_key'], j['division'], j['job_group'], j['job_detail'], j['note'])
        if not same or clean(g['확인상태']) not in STATUS:
            errs.append(f"공무원 직렬 No {g['No']}이 채용 직무와 맞지 않음")
            break
        j['verify_status'] = clean(g['확인상태'])
    return targets, links, jobs, errs


def read_past(path, targets):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    by_name = {t['name']: t for t in targets}
    errs, qs = [], []
    for r in table(wb.worksheets[0], '원본 번호'):
        name, when = clean(r['수집 대상']), clean(r['면접 시기']) or ''
        t = by_name.get(name)
        m = re.fullmatch(r'(\d{4})\s*(상반기|하반기)?', when)
        if not t or not m or not clean(r['질문 요약']) or num(r['원본 번호']) is None:
            errs.append(f"기출 원본 번호 {r['원본 번호']}: 수집 대상·시기·질문 확인 필요 ({name} / {when})")
            continue
        if num(r['우선순위']) != t['priority'] or clean(r['대상 구분']) != t['category']:
            errs.append(f"기출 원본 번호 {r['원본 번호']}: 우선순위·대상 구분이 수집 대상 목록과 다름 ({name})")
        qs.append({'orig_no': num(r['원본 번호']), 'target_key': t['key'], 'question': clean(r['질문 요약']),
                   'year': int(m.group(1)), 'half': m.group(2), 'job_category': clean(r['직무(원문 구분)']),
                   'review_company': clean(r['후기 표시 기업']), 'employment_type': clean(r['고용형태']),
                   'note': clean(SITE_ID.sub('', r['범위·주의사항'] or ''))})
    dup = [k for k, n in collections.Counter(q['orig_no'] for q in qs).items() if n > 1]
    if dup: errs.append(f'기출 원본 번호 중복: {dup}')
    dup = [k for k, n in collections.Counter((q['target_key'], q['question']) for q in qs).items() if n > 1]
    if dup: errs.append(f'같은 대상에 같은 질문이 두 번: {dup[:5]}')
    return qs, errs


def main():
    a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
    per = int(sys.argv[4]) if len(sys.argv) > 4 else 300
    targets, links, jobs, errs = read_targets(a)
    qs, errs2 = read_past(b, targets)
    if errs or errs2: sys.exit('\n'.join(errs + errs2))
    tcols = ['key', 'no', 'priority', 'category', 'name', 'group_memo', 'recruit_channel', 'recruit_method', 'recent_posting',
             'interview_process', 'research_memo', 'job_count', 'verify_status', 'posting_source', 'original_checked',
             'original_changes', 'login_required']
    lcols = ['talent_id', 'target_key', 'reason']
    jcols = ['target_key', 'seq', 'division', 'job_group', 'job_detail', 'note', 'verify_status']
    qcols = ['orig_no', 'target_key', 'question', 'year', 'half', 'job_category', 'review_company', 'employment_type', 'note']
    files = [upsert('interview_target', tcols, ['key'], targets),
             upsert('interview_target_talent', lcols, ['talent_id'], links)]
    files += [upsert('interview_target_job', jcols, ['target_key', 'seq'], jobs[i:i + per]) for i in range(0, len(jobs), per)]
    files += [upsert('interview_past_question', qcols, ['orig_no'], qs[i:i + per]) for i in range(0, len(qs), per)]
    # 엑셀에서 줄이 줄어든 경우 남은 옛 줄 지우기
    keys = ', '.join(_t['lit'](t['key']) for t in targets)
    files.append('delete from public.interview_target_job j using public.interview_target t\n'
                 ' where j.target_key = t.key and j.seq > t.job_count;\n'
                 f'delete from public.interview_target_talent where talent_id not in ({", ".join(_t["lit"](l["talent_id"]) for l in links)});\n'
                 f'delete from public.interview_past_question where orig_no not in ({", ".join(str(q["orig_no"]) for q in qs)});\n'
                 f'delete from public.interview_target where key not in ({keys});\n')
    os.makedirs(out, exist_ok=True)
    for n, sql in enumerate(files, 1):
        with open(os.path.join(out, f'{n:02d}.sql'), 'w', encoding='utf-8') as f:
            f.write(sql)
    cat = collections.Counter(t['category'] for t in targets)
    yr = collections.Counter(q['year'] for q in qs)
    diff = sum(1 for q in qs if q['review_company'] and q['review_company'] != next(t['name'] for t in targets if t['key'] == q['target_key']))
    print(f"수집 대상 {len(targets)}곳 ({' · '.join(f'{c} {cat[c]}' for c in CATEGORIES)}), 인재상 연결 {len(links)}건, "
          f"채용 직무 {len(jobs)}줄, 기출 {len(qs)}문항 ({len({q['target_key'] for q in qs})}곳 · "
          f"{' · '.join(f'{y}년 {n}' for y, n in sorted(yr.items()))}, 후기 표시 기업명이 다른 줄 {diff}) → SQL 파일 {len(files)}개 ({out})")


if __name__ == '__main__':
    main()
