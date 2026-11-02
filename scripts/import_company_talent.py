"""회사별 인재상 엑셀 → 클론 DB(company_talent, company_talent_excluded) INSERT SQL 만들기

    python3 -I scripts/import_company_talent.py <엑셀 경로> <SQL을 둘 폴더> [한 파일당 줄 수=80]

- 본문 9개 시트(No·회사명·인재상 유형·키워드·키워드별 뜻·한 줄 요약·주요 테마·확인상태·출처·비고·ID)를 회사 1곳당 1줄로 읽음
- '점검필요' 탭의 ID는 needs_review·review_reason으로, '제외·보류 명단' 탭은 company_talent_excluded로
- 만든 SQL은 클론 프로젝트(ZAVAPASS-clone)에서만 실행. 같은 ID가 있으면 새 값으로 덮어씀(다시 넣어도 안전)
- 표 구조는 supabase/clone/002_company_talent.sql
"""
import collections, os, re, sys

import openpyxl

MAIN = ['대기업 그룹', '재계 그룹(31~102위)', '시가총액 상위 기업', '금융권', 'IT·플랫폼·유니콘',
        '공기업', '준정부기관', '기타공공기관', '시총 101~200위·코스닥']
REFERENCE_ONLY = '시총 101~200위·코스닥'


def clean(v):
    return (str(v).replace('\r', '').strip() if v is not None else '') or None


def lines(v):
    return [x.strip() for x in str(v).split('\n') if x.strip()] if v else []


def table(ws, first):
    """시트 위쪽 설명 줄을 건너뛰고, 첫 칸이 first인 줄을 머리글로 해서 표를 읽음"""
    rows = list(ws.iter_rows(values_only=True))
    h = next(i for i, r in enumerate(rows) if r and r[0] == first)
    hdr = [str(c).strip() if c is not None else '' for c in rows[h]]
    return [dict(zip(hdr, r)) for r in rows[h + 1:] if r and r[0] not in (None, '')]


def read(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    review = {clean(r['ID']): clean(r['점검 사유']) for r in table(wb['점검필요'], 'ID')}
    companies = []
    for order, sheet in enumerate(MAIN, 1):
        for r in table(wb[sheet], 'No'):
            cid, note = clean(r['ID']), clean(r.get('비고')) or ''
            companies.append({
                'id': cid, 'category': sheet, 'category_order': order,
                'no': int(r['No']) if str(r['No']).isdigit() else None,
                'name': clean(r['회사명']), 'talent_type': clean(r['인재상 유형']),
                'keywords': lines(r['키워드']),
                'keyword_meanings': [re.sub(r'^•\s*', '', x) for x in lines(r['키워드별 뜻'])],
                'summary': clean(r['한 줄 요약']),
                'themes': [t.strip() for t in str(r['주요 테마'] or '').split(',') if t.strip()],
                'verify_status': clean(r['확인상태']), 'source_url': clean(r['출처']), 'note': note or None,
                'reference_only': sheet == REFERENCE_ONLY, 'merge_planned': '[통폐합 예정]' in note,
                'needs_review': cid in review, 'review_reason': review.get(cid)})
    excluded = [{'no': int(r['No']), 'original_category': clean(r['원래 구분']), 'name': clean(r['회사·기관명']),
                 'action': clean(r['처리']), 'reason': clean(r['사유']), 'evidence_url': clean(r['근거'])}
                for r in table(wb['제외·보류 명단'], 'No')]
    dup = [k for k, n in collections.Counter(c['id'] for c in companies).items() if n > 1]
    if dup or any(not c['id'] or not c['name'] for c in companies):
        sys.exit(f'ID 중복 또는 빈 ID·회사명이 있어요: {dup}')
    missing = [k for k in review if k not in {c["id"] for c in companies}]
    if missing:
        sys.exit(f"'점검필요' 탭의 ID가 본문에 없어요: {missing}")
    return companies, excluded


def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, int):
        return str(v)
    if isinstance(v, list):
        return "'{}'::text[]" if not v else 'array[' + ','.join(lit(x) for x in v) + ']::text[]'
    return "'" + str(v).replace("'", "''") + "'"


def main():
    src, out = sys.argv[1], sys.argv[2]
    per = int(sys.argv[3]) if len(sys.argv) > 3 else 80
    companies, excluded = read(src)
    os.makedirs(out, exist_ok=True)
    cols = ['id', 'category', 'category_order', 'no', 'name', 'talent_type', 'keywords', 'keyword_meanings', 'summary',
            'themes', 'verify_status', 'source_url', 'note', 'reference_only', 'merge_planned', 'needs_review', 'review_reason']
    upd = ', '.join(f'{c} = excluded.{c}' for c in cols[1:]) + ', updated_at = now()'
    files = []
    for i in range(0, len(companies), per):
        vals = ',\n'.join('(' + ', '.join(lit(c[k]) for k in cols) + ')' for c in companies[i:i + per])
        files.append(f'insert into public.company_talent ({", ".join(cols)}) values\n{vals}\non conflict (id) do update set {upd};\n')
    ecols = ['no', 'original_category', 'name', 'action', 'reason', 'evidence_url']
    evals = ',\n'.join('(' + ', '.join(lit(e[k]) for k in ecols) + ')' for e in excluded)
    eupd = ', '.join(f'{c} = excluded.{c}' for c in ecols[1:])
    files.append(f'insert into public.company_talent_excluded ({", ".join(ecols)}) values\n{evals}\non conflict (no) do update set {eupd};\n')
    for n, sql in enumerate(files, 1):
        with open(os.path.join(out, f'{n:02d}.sql'), 'w', encoding='utf-8') as f:
            f.write(sql)
    print(f'회사 {len(companies)}곳, 제외·보류 {len(excluded)}건 → SQL 파일 {len(files)}개 ({out})')


if __name__ == '__main__':
    main()
