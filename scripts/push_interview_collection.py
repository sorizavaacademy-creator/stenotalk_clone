"""import_interview_collection.py가 만든 data.json → 클론 DB에 넣기 (ic_import_reset → ic_import 여러 번)

    IC_IMPORT_TOKEN=<임시 열쇠> python3 -I scripts/push_interview_collection.py <data.json>

- 주소와 공개 키(anon)는 config.js에서 읽음. 운영 프로젝트(aqkukxcjcbfxqfesmuva)이면 바로 멈춤
- 관리자 로그인 없이 넣으려면 임시 열쇠가 필요함: 클론 DB의 qb_import_tokens에 열쇠의 sha256 해시를 짧은 기한으로 넣고, 다 넣은 뒤 지움
- 표 구조와 함수는 supabase/clone/018_interview_collection.sql, 019_interview_collection_use.sql
"""
import json, os, re, sys, urllib.request

PROD_REF = 'aqkukxcjcbfxqfesmuva'
HERE = os.path.dirname(os.path.abspath(__file__))


def env():
    s = open(os.path.join(HERE, '..', 'config.js'), encoding='utf-8').read()
    url = re.search(r"VITE_SUPABASE_URL:\s*'([^']+)'", s).group(1).rstrip('/')
    key = re.search(r"VITE_SUPABASE_ANON_KEY:\s*'([^']+)'", s).group(1)
    if PROD_REF in url or PROD_REF in key:
        sys.exit('운영 프로젝트 주소라서 멈춤')
    return url, key


def rpc(url, key, fn, body):
    req = urllib.request.Request(f'{url}/rest/v1/rpc/{fn}', data=json.dumps(body, ensure_ascii=False).encode('utf-8'),
                                 headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read() or 'null')
    except urllib.error.HTTPError as e:
        sys.exit(f'{fn} 실패 {e.code}: {e.read().decode("utf-8", "replace")[:500]}')


def main():
    data = json.load(open(sys.argv[1], encoding='utf-8'))
    token = os.environ.get('IC_IMPORT_TOKEN') or sys.exit('IC_IMPORT_TOKEN이 없어요')
    url, key = env()
    rpc(url, key, 'ic_import_reset', {'p_token': token})
    for table, rows in data:
        n = 0
        for i in range(0, len(rows), 200):
            n += rpc(url, key, 'ic_import', {'p_table': table, 'p_rows': rows[i:i + 200], 'p_token': token})
        print(f'{table}: {n}줄')


if __name__ == '__main__':
    main()
