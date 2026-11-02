# 기업 맞춤 면접 연동 가이드 (인재상 + 면접 자료)

2026-11-02 · 클론(ZAVAPASS-clone `yiuraowvnadqdrnysdce`) 전용 · 운영 ZAVAPASS에는 적용하지 않음

목표: 학생이 면접 준비 단계에서 회사를 검색해 고르면 아래 세 가지를 한 번에 불러온다.
① 그 회사의 인재상·핵심가치 ② 공식 면접 전형 ③ 예상 질문과 평가포인트.
이 자료로 면접 질문을 섞고, AI 면접관의 꼬리질문과 채점 피드백에도 반영한다.

## 적용 현황 (2026-11-02q)

- 클론 DB: `003`(면접 전형 704곳·예상 질문 4,224문항, 엑셀과 대조 일치), `004`(면접자는 `list_companies()`·`get_company_pack()`으로만 읽고, 출처·비고·점검 사유 같은 내부 메모는 받지 않음. 표 직접 읽기는 관리자만)
- 앱(`index.html`): 아래 2장 내용 반영
  - 면접 준비 창: 회사 검색 → 회사 카드, 면접관 10가지(인재상 검증형·논리 검증형·무반응형·공공·청렴형 추가), 기본 2명, 난이도 설명 카드(꼬리질문 최대 개수와 연결)
  - 면접실: 기업 맞춤 질문 2개(6문항 이상이면 3개)를 2·3번에, 질문 아래 힌트(연습형은 평가포인트), 면접관 명단·꼬리질문은 다른 면접관이 이어서, 회사 정보 줄
  - 결과: 인재상과 내 답변(행동·결과 기준), 면접관 종합 의견(고른 면접관별), 문항 카드에 확인한 인재상, 종합 리포트에 회사 공식 전형, 남은 예상 질문으로 연습. 국회 속기 분야의 '실제 기출'·'실제 면접 후기' 표시는 한림대 화면에서 숨김
- 남은 것: AI 면접관 Edge Function(3장) — 배포 전까지 꼬리질문·채점은 규칙 방식

---

## 0. 지금 상태와 먼저 정할 것

| 항목 | 지금 | 이번 작업 |
|---|---|---|
| 인재상 704곳 | 클론 DB `company_talent`에 들어가 있음 (엑셀과 일치 확인) | 그대로 씀 |
| 면접 자료 | 엑셀만 있음 | `003_company_interview.sql` 표 + 가져오기 스크립트 |
| 회사 입력 | 면접 준비 창의 `fl-company` **자유 입력칸** (`state.flowCtx.job.company`에 글자만 저장) | 검색해서 고르는 칸으로 바꾸고, 회사 **ID**를 저장 |
| AI 면접관 프롬프트 | index.html이 아니라 **Edge Function** `followup-question`·`grade-answer` 안에 있음. 클론 프로젝트에는 이 함수가 **배포돼 있지 않음** (지금은 규칙 꼬리질문·기본 채점으로 대체되어 진행) | 클론용 함수에 회사 단락을 넣어 배포 (OpenAI 키 필요) |

### 회사 키는 회사명 대신 ID로

요청은 "회사명을 키로"였지만, 데이터를 확인해 보니 이름만으로는 회사를 하나로 정할 수 없어서 **ID(`G1-01` 형식)를 키**로 했습니다. 검색은 이름으로 하고, 저장·조회는 ID로 합니다.

- 회사명이 겹치는 곳: **카카오** (G1-15 대기업 그룹 / G2-49 시가총액 상위 기업), **에쓰-오일(S-OIL)** (G1-25 대기업 그룹 / G2-47 시가총액 상위 기업)
- **G5-043**은 인재상 엑셀 v3에 옛 이름 `강릉원주대학교치과병원`으로 있습니다. 강원대·강릉원주대 통합으로 `강원대학교치과병원`이 됐으므로(2026-11-02 확인), 클론 DB 이름을 바꾸고 `import_company_talent.py`의 `RENAMED`에도 넣어 다시 가져와도 새 이름이 유지되게 했습니다.

### 데이터 사용 원칙 (엑셀 '보고 요약' 기준)

- **면접 전형(공식)**은 사실 정보입니다. 다만 공고·직무·연도마다 바뀌므로 화면에 `기준 공고`와 `공고일`을 함께 보여 줍니다.
  - 공고일이 없는 곳이 198곳, '미제공'이 123곳입니다.
- **예상 질문(자체 작성)**은 연습용 가상 질문입니다. 화면에서도, AI 답변에서도 "기출"이나 "실제로 묻는 질문"이라고 하지 않습니다.
- 인재상이 `미확인`인 99곳은 일반 역량 질문으로 진행합니다. 예상 질문도 '업종 공통'으로 작성돼 있습니다.
- `부분확인` 인재상과 `일부 제공`·`그룹 공통`·`2차 출처` 전형은 그 회사 고유 기준으로 단정하지 않습니다.

---

## 1. DB 연동

### 1-1. 표 만들기 — `supabase/clone/003_company_interview.sql` (작성 완료, 아직 실행 안 함)

| 표·함수 | 내용 |
|---|---|
| `company_interview_process` | 회사 1곳당 1줄 (704줄). '공식 정보 제공 현황' + '면접 전형(공식)'을 ID로 합친 것. `provide_level`, `stages`, `interview_types[]`, `detail`, `base_posting`, `posted_month`, `group_common`, `secondary_source` … |
| `company_interview_question` | 회사마다 6문항 (4,224줄). `question`, `linked_talent`, `eval_point`, `basis` |
| `get_company_pack(p_id)` | ID 하나로 `{talent, process, questions}`를 한 번에 돌려주는 함수. 로그인한 사람만 부를 수 있음 |

권한은 인재상 표와 같습니다. 로그인한 사람은 읽기만 하고, 쓰기는 관리자만 합니다.

### 1-2. 엑셀 → SQL — `scripts/import_company_interview.py` (작성·실행 확인 완료)

```bash
python3 -I scripts/import_company_interview.py 회사별_면접자료_20261102.xlsx out/ 회사별_인재상_정리_20261102_v3.xlsx
```

실행 결과:

```
회사 704곳 (제공 317 · 일부 제공 264 · 미제공 123), 예상 질문 4224개 → SQL 파일 24개
```

스크립트는 다음을 점검하고, 맞지 않으면 SQL을 만들지 않고 멈춥니다.
- ID 중복
- 전형 탭에만 있는 ID
- 제공 수준이 '미제공'인데 전형이 적혀 있는 경우 (또는 그 반대)
- 회사마다 6문항이 아닌 경우
- 인재상 DB에 없는 ID

같은 키가 이미 있으면 새 값으로 덮어쓰므로 다시 넣어도 안전합니다.

### 1-3. 클론 DB에 넣는 순서

1. `003_company_interview.sql` 실행 (마이그레이션 이름: `clone_003_company_interview`)
2. `out/01.sql` ~ `24.sql` 실행 (01~12 전형, 13~24 예상 질문)
3. 확인 쿼리를 실행해 704 / 4224 / (317, 264, 123)이 나오는지 봅니다.

```sql
select (select count(*) from company_interview_process) as proc,
       (select count(*) from company_interview_question) as qs,
       (select jsonb_object_agg(provide_level, n) from (select provide_level, count(*) n from company_interview_process group by 1) x) as lv;
select get_company_pack('G1-01');   -- 삼성그룹: 인재상 + 전형 + 6문항
```

---

## 2. 화면(index.html) 연동

### 2-1. 회사 자료 모듈 `CompanyData` 추가 (StartFlow 바로 위)

회사 목록(704곳, id·이름·구분만)은 처음 한 번만 읽어서 검색에 씁니다. 회사를 고르면 `get_company_pack`으로 자세한 자료를 읽고, 읽은 자료는 저장해 두고 다시 씁니다.

```js
/* 2026-11-0x 기업 맞춤 면접: 회사 검색·자료 불러오기 (키는 회사 ID) */
const CompanyData = {
  _list:null, _packs:{}, cur:null,           // cur = 지금 면접에 쓰는 pack
  norm(s){ return String(s||'').toLowerCase().replace(/\(주\)|㈜|주식회사|\s+/g,'').replace(/[()·\-]/g,''); },
  async list(){
    if(this._list) return this._list;
    const { data, error } = await sb.from('company_talent').select('id,name,category,category_order,verify_status,reference_only').order('category_order').order('no');
    if(error){ console.warn('[회사 목록 실패]', error.message); return []; }
    return (this._list = data.map(r=>Object.assign(r, { k: this.norm(r.name) })));
  },
  /** 이름 일부로 찾기: 앞부분이 맞는 회사 먼저, 같은 이름이면 구분 순서대로. 참고용(시총 101~200위)은 뒤로 */
  async search(q, n = 8){
    const k = this.norm(q); if(!k) return [];
    const L = await this.list();
    return L.filter(r=>r.k.includes(k))
      .sort((a,b)=>(a.k.startsWith(k)?0:1)-(b.k.startsWith(k)?0:1) || (a.reference_only-b.reference_only) || a.category_order-b.category_order)
      .slice(0, n);
  },
  async pack(id){
    if(!id) return null;
    if(this._packs[id]) return this._packs[id];
    const { data, error } = await sb.rpc('get_company_pack', { p_id: id });
    if(error || !data){ console.warn('[회사 자료 실패]', error && error.message); return null; }
    return (this._packs[id] = data);
  },
  /** 면접 질문으로 쓸 예상 질문 n개 (자체 작성 질문임을 표시) */
  questions(pack, n){
    if(!pack || !pack.questions) return [];
    return pack.questions.slice(0, n).map(q=>({
      id: `cq-${pack.talent.id}-${q.seq}`, q: q.question, ref: null, custom: true, bank: 'company',
      hint: q.eval_point ? `평가포인트: ${q.eval_point}` : '', cseq: q.seq, src: '기업 맞춤 예상 질문(자체 작성)' }));
  },
};
```

### 2-2. 면접 준비 창: 자유 입력칸을 검색해서 고르는 칸으로

`StartFlow.open()`의 `job` 초기값에 `companyId`를 추가합니다.

```js
job:{ field:f.id, company:'', companyId:'', role:'', post:'' }
```

`vPrep()`의 `fl-company` 칸을 아래로 바꿉니다. 화면은 입력칸 + 검색 결과 목록 + 고른 회사 요약입니다.

```js
<div class="fl-f"><label for="fl-company">목표 기업·기관 <span class="fl-opt">(선택)</span></label>
  <div class="fl-co">
    <input id="fl-company" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="fl-co-list"
           value="${escapeHtml(j.company)}" placeholder="회사 이름으로 검색 (예: 삼성, 한국전력)" autocomplete="off">
    <ul id="fl-co-list" class="fl-co-list" role="listbox" hidden></ul>
  </div>
  <div id="fl-co-card">${j.companyId ? '<p class="fl-sub">회사 정보를 불러오는 중…</p>' : '<p class="fl-sub">목록에 없으면 이름만 적어도 돼요. 그때는 직무 일반 질문으로 진행해요.</p>'}</div>
</div>
```

`render()` 끝부분의 `bind('fl-company', …)`는 지우고 검색 동작으로 바꿉니다. 글자를 다시 고치면 고른 회사가 풀립니다.

```js
const co = document.getElementById('fl-company'), ul = document.getElementById('fl-co-list');
if(co){
  let tm = 0;
  co.addEventListener('input', ()=>{ s.job.company = co.value; s.job.companyId = ''; clearTimeout(tm);
    tm = setTimeout(async ()=>{ const r = await CompanyData.search(co.value);
      ul.innerHTML = r.map(x=>`<li role="option" data-co="${x.id}"><b>${escapeHtml(x.name)}</b><span>${escapeHtml(x.category)}${x.verify_status==='미확인'?' · 인재상 미확인':''}</span></li>`).join('');
      ul.hidden = !r.length; co.setAttribute('aria-expanded', String(!!r.length)); }, 150); });
  ul.onclick = e=>{ const li = e.target.closest('[data-co]'); if(!li) return;
    const x = CompanyData._list.find(r=>r.id === li.dataset.co); s.job.companyId = x.id; s.job.company = x.name; this.render(); };
}
if(s.job.companyId) CompanyData.pack(s.job.companyId).then(p=>{ const el = document.getElementById('fl-co-card'); if(el && p) el.innerHTML = CompanyCard.html(p, 'compact'); });
```

`finish()`에서 회사 ID를 맥락에 남기고, 면접 시작 전에 자료를 읽어 둡니다.

```js
job: s.kind === 'job' ? { field: fid, company: s.job.company || null, companyId: s.job.companyId || null, role: s.job.role, post: s.job.post || null } : null };
CompanyData.cur = null;
if(s.kind === 'job' && s.job.companyId) CompanyData.pack(s.job.companyId).then(p=>{ CompanyData.cur = p; });
```

`vStart()`의 '내 정보'에서는 회사 ID가 있으면 `회사명 (구분)`, 없으면 지금처럼 `기업 미입력(직무 일반 질문)`을 보여 줍니다.

### 2-3. 회사 요약 카드 `CompanyCard` (준비 창 + 면접 화면에서 같이 씀)

```js
const CompanyCard = {
  html(p, size){
    const t = p.talent, pr = p.process || {};
    const kw = (t.keywords||[]).slice(0, 6).map(k=>`<span class="cc-kw">${escapeHtml(k)}</span>`).join('');
    const vs = { '확인':'공식 확인', '부분확인':'일부 확인 · 그룹 공통일 수 있음', '미확인':'공식 인재상 미확인' }[t.verify_status];
    const lv = pr.provide_level === '미제공' || !pr.stages ? '<p class="cc-none">공식 면접 전형 정보가 없어 일반 면접 방식으로 진행해요.</p>'
      : `<p class="cc-stage">${escapeHtml(pr.stages)}</p>${(pr.interview_types||[]).length ? `<p class="cc-type">면접 유형 · ${escapeHtml(pr.interview_types.join(', '))}</p>` : ''}
         <p class="cc-src">${escapeHtml(pr.base_posting||'')}${pr.posted_month ? ' · ' + escapeHtml(pr.posted_month) : ''}${pr.provide_level==='일부 제공' ? ' · 일부만 공개' : ''}${pr.group_common ? ' · 그룹 공통 절차' : ''}</p>`;
    return `<section class="cc ${size||''}" aria-label="${escapeHtml(t.name)} 면접 정보">
      <header><b>${escapeHtml(t.name)}</b><span class="cc-badge v-${t.verify_status}">${vs}</span></header>
      <div class="cc-row"><span class="cc-lbl">인재상</span>${kw || '<span class="cc-none">확인된 키워드 없음</span>'}</div>
      ${size === 'compact' ? '' : (t.summary ? `<p class="cc-sum">${escapeHtml(t.summary)}</p>` : '')}
      <div class="cc-row"><span class="cc-lbl">면접 전형</span>${lv}</div>
      <p class="cc-note">예상 질문은 인재상을 바탕으로 만든 연습용 질문이에요. 실제 기출 질문이 아니에요.</p>
    </section>`;
  },
};
```

면접 화면에는 `#screen-interview .interview-top` 바로 아래에 자리 하나를 둡니다.

```html
<div id="iv-company-card" class="iv-cc" hidden></div>
```

`StenoLoop.run(opt, (type, d)=>{ … })`의 `type==='questions'`에서 채웁니다.

```js
const cc = document.getElementById('iv-company-card');
if(cc){ const p = CompanyData.cur; cc.hidden = !p; cc.innerHTML = p ? CompanyCard.html(p) : ''; }
```

모바일에서는 접어 둔 상태(회사명·배지만 보임)로 시작하고, 누르면 펼칩니다. 면접관 영상 영역을 가리지 않게 하기 위해서입니다.

### 2-4. 면접 질문에 회사 예상 질문 섞기

면접 옵션을 만드는 곳(지금 `opt.extraQuestions = state.customQuestions…`가 있는 부분)에서, 서류 질문이 없을 때 회사 예상 질문을 넣습니다. 몇 개를 넣을지는 아래 기준이 기본값이고, 바꿀 수 있습니다.

| 면접 길이 | 회사 예상 질문 |
|---|---|
| 5문항 이하 | 2개 |
| 6문항 이상 | 3개 |

지금 자기소개서 맞춤 질문을 넣는 방식(`extraQuestions`)과 같아서, 직무 문제은행 문항 수에 **더해지고** 2번째 자리부터 들어갑니다. 예를 들어 5문항 면접이면 직무 1 → 기업 맞춤 2 → 직무 4로 모두 7문항입니다.

```js
else if(state.customQuestions && state.customQuestions.length){ opt.extraQuestions = state.customQuestions.map(x=>Object.assign({}, x)); }
// ↓ 추가
if(!resume && !opt.questions && CompanyData.cur && state.flowCtx && state.flowCtx.purpose === 'job'){
  const cq = CompanyData.questions(CompanyData.cur, (opt.count || 5) >= 6 ? 3 : 2);
  opt.extraQuestions = (opt.extraQuestions || []).concat(cq);
  opt.companyId = CompanyData.cur.talent.id;
}
```

`type==='question'`에서 `pendingAsk`를 만들 때 `cseq: d.q.cseq || null`을 함께 담습니다. 이 값으로 채점과 꼬리질문이 "회사 예상 질문 몇 번"인지 알 수 있습니다.

### 2-5. AI 호출에 회사 ID와 질문 번호만 실어 보내기

회사 자료 글은 보내지 않습니다. 서버가 DB에서 직접 읽으므로, 브라우저에서 조작한 글이 프롬프트에 들어가지 않습니다.

`StenoDialog.followup()`의 `body`에 추가합니다.

```js
company_id: (CompanyData.cur && CompanyData.cur.talent.id) || undefined,
company_seq: cseq || undefined,
```

이 `cseq`는 호출하는 쪽에서 넘깁니다. `StenoLoop` 안의 `StenoDialog.followup({ … qid:… })` 호출에 `cseq: q.cseq`를 추가하면 됩니다.

`gradeAnswerWithAI()`의 `body`에도 같은 두 값을 넣습니다. `extra`로 `{ cseq: a.cseq }`를 넘기고, 호출하는 곳 두 군데(`17496`, `18346` 줄 근처)에 추가합니다.

### 2-6. 결과·기록

- 면접 기록 저장 시 `flowCtx.job.companyId`를 함께 저장합니다. 그러면 '나의 성장'에서 "같은 회사로 한 면접끼리" 비교할 수 있습니다.
- 결과 리포트 위쪽에 같은 `CompanyCard`(compact)를 보여 줍니다. 회사 예상 질문 문항에는 `평가포인트`를 함께 보여 줍니다.

---

## 3. AI 면접관 프롬프트 (Edge Function)

### 3-1. 공통 조각 — `supabase/functions/_shared/company_prompt.ts` (작성 완료)

- `loadCompanyPack(sb, company_id)`
  - 로그인한 사용자 권한으로 `get_company_pack`을 부릅니다.
  - ID 형식이 틀리거나 없는 회사면 `null`을 돌려주고, 그 경우 일반 면접으로 진행합니다.
- `buildCompanyBlock(pack, 'followup' | 'grade', seq?)`
  - 요청하신 프롬프트 구조에 데이터 상태별 안전 규칙을 더한 단락을 만듭니다.

실제 데이터로 돌려 본 출력 (삼성그룹 G1-01, 1번 예상 질문, 꼬리질문). 인재상이 `부분확인`이라 단정 금지 줄이 붙습니다.

```
너는 삼성그룹의 채용 면접관이다.
이 회사의 인재상(인재상 (대표 계열사 기준(삼성전자)))은 Passion 열정(미래를 향해 쉼 없이 도전하는 뜨거운 의지를 가진 사람을 뜻한다.), Creativity 창의혁신(새로운 생각과 혁신으로 세상에 변화를 일으키는 사람을 뜻한다.), Integrity 인간미·도덕성(정직하고 올바르게 행동하며 맡은 역할과 책임을 끝까지 해내는 사람을 뜻한다.)이다. 요약: 끝없는 열정으로 도전하고 창의적 혁신으로 변화를 만들며, 정직하고 바른 행동으로 책임을 다하는 사람을 원한다.
이 인재상은 그룹 공통이거나 2차 출처일 수 있으니, 지원자에게 "삼성그룹의 고유 기준"이라고 단정해서 말하지 마라.
이 질문의 핵심 평가 포인트는 "목표 설정의 도전 수준과 장애 앞에서 지속한 구체적 행동을 보는지."이고, 근거가 된 인재상은 "Passion 열정"이다.
공식 면접 전형은 "지원서 접수 → 직무적합성평가 → 직무적성검사(GSAT) → 종합면접(임원·직무역량·창의성) → 채용 건강검진"이다. 면접 유형: 직무PT, 인성. 세부: 종합면접은 임원면접·직무역량면접·창의성면접으로 구성된다. …
예상 질문은 면접 연습용으로 자체 작성한 것이고 실제 기출이 아니다. "이 회사가 실제로 묻는 질문", "기출"이라고 말하지 마라.
지원자 답변에 없는 경험·수치·회사 정보를 지어내지 말고, 다른 회사·계열사 정보로 바꿔 말하지 마라.
지원자의 답변을 위 인재상과 평가 기준에 비추어 분석하고, 면접 전형 스타일에 맞는 꼬리 질문을 하나만 해라. 인재상 키워드를 그대로 읽어 주지 말고, 그 키워드가 드러날 행동·판단·결과를 묻는 질문으로 바꿔라.
```

인재상 `미확인` 회사(중흥건설그룹 G7-02)는 둘째 줄이 "이 회사의 공식 인재상은 확인되지 않았다. 회사 고유의 인재상·가치를 지어내거나 단정하지 말고, 일반 역량으로 판단해라"로 바뀝니다. 전형 `미제공` 회사(LG그룹 G1-04)는 전형 줄이 "공식 면접 방식은 확인되지 않았다. 일반적인 인성·직무 면접 방식으로 진행해라"로 바뀝니다.

데이터 상태에 따라 단락이 달라집니다.

| 상태 | 프롬프트에 들어가는 내용 |
|---|---|
| 인재상 `미확인` 또는 키워드 없음 | 회사 고유 인재상을 지어내지 말고 일반 역량으로 판단 |
| 인재상 `부분확인` | "그 회사 고유 기준"이라고 단정 금지 |
| 전형 `미제공` | 일반 인성·직무 면접 방식 |
| 전형 `일부 제공` · 그룹 공통 · 2차 출처 | 전형 이름을 사실처럼 단정 금지 |
| 채점(`grade`) | 회사명·키워드를 말했다는 이유만으로 점수를 올리지 않음 |

### 3-2. 각 함수에 넣는 위치

`followup-question`과 `grade-answer`에서 OpenAI를 부르기 직전에 아래 코드를 넣습니다.

```ts
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { loadCompanyPack, buildCompanyBlock } from '../_shared/company_prompt.ts';

// 요청한 사용자의 JWT로 읽음 (RLS 적용)
const userSb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
  { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
const pack = await loadCompanyPack(userSb, body.company_id);
const seq = Number.isInteger(body.company_seq) ? body.company_seq : undefined;
const system = (pack ? buildCompanyBlock(pack, 'followup', seq) + '\n\n' : '') + BASE_SYSTEM_PROMPT;   // grade-answer는 'grade'
```

응답 형식은 지금 화면이 기대하는 그대로 둡니다. 화면 코드는 바꿀 필요가 없습니다.
- `followup-question` → `{ followup, evaluation, intent, model, limit }`
- `grade-answer` → `{ score, feedback, strengths, improvements, rewrite, model, limit }`

### 3-3. 클론에 함수가 없다는 점 — 결정이 필요한 부분

두 함수의 원본 코드는 운영 프로젝트에만 배포돼 있고, 이 레포에는 없습니다. 클론에서 AI 면접관을 실제로 켜려면 아래 둘 중 하나를 골라야 합니다.

- **A. 운영 함수 코드를 읽어서 옮기기** (읽기만 함, 운영에는 쓰지 않음)
  - 그 코드를 `supabase/functions/followup-question/`, `grade-answer/`로 옮기고 3-2를 더해 **클론에만** 배포합니다.
  - 속기사용 문구·한도 관리(`limit`)가 그대로 따라오므로, 한림대용으로 손볼 부분을 같이 정리합니다.
- **B. 한림대용으로 새로 작성**
  - 같은 응답 형식으로 단순하게 새로 만듭니다. 속기사 전용 규칙이 없어서 더 가볍습니다.

어느 쪽이든 클론 프로젝트 시크릿에 **OpenAI API 키**(`OPENAI_API_KEY`)를 넣어야 합니다. 키는 사용자가 Supabase 대시보드(ZAVAPASS-clone → Edge Functions → Secrets)에서 직접 넣고, 채팅에는 붙여 넣지 않습니다.

함수가 없는 동안에도 회사 연동은 동작합니다.
- 회사 검색
- 요약 카드
- 회사 예상 질문 출제와 평가포인트 힌트

AI 꼬리질문·채점에 인재상이 반영되는 부분만 함수가 배포된 뒤부터 동작합니다.

---

## 4. 작업 순서와 확인 목록

| 단계 | 할 일 | 확인 |
|---|---|---|
| 1 | 003 SQL + 24개 데이터 SQL을 클론 DB에 실행 | 704 / 4224 / 317·264·123, `get_company_pack('G1-01')` |
| 2 | `CompanyData`·`CompanyCard`·준비 창 검색칸 | '삼성' → 삼성그룹 등, '카카오' → 2곳이 구분과 함께 나옴, 모르는 이름 → 일반 질문 안내 |
| 3 | 면접 화면 카드 + 예상 질문 섞기 | 회사 고른 면접에서 예상 질문 2~3개, 힌트에 평가포인트, '기출 아님' 문구 |
| 4 | AI 호출 body에 `company_id`·`company_seq` | 함수가 없으면 지금처럼 규칙 꼬리질문으로 대체 (오류 없이) |
| 5 | 클론 Edge Function 배포 (A/B 결정 + 키) | 꼬리질문·피드백에 인재상이 드러남. `미확인` 회사에서 회사 고유 가치를 지어내지 않음 |

미리 볼 회사 예시:

| 회사 | 확인할 점 |
|---|---|
| 삼성그룹 G1-01 | 제공·확인 |
| SK그룹 G1-02 | 일부 제공 |
| 공기업 1곳 | 제공 비율이 높음 |
| 미확인 회사 1곳 | 일반 질문으로 대체되는지 |
| 카카오 | 이름이 겹치는 2곳이 구분되는지 |
