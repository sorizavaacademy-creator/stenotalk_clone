-- 2026-11-05 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 면접 DB 3단계: 질문 뽑기 (서버 함수 pick-questions가 서비스 키로 씀)
--   qb_pick_candidates: 유형 하나에서 '출제 가중치'를 확률로 뽑음. 같은 대표 질문은 한 번만.
--                       부족하면 ① 그 기업+직종 → ② 그 기업 → ③ 같은 구분+직종 → ④ 같은 구분 → ⑤ 전체 순서로 채움
--                       경력직(대리·과장 등) 면접에서 나온 질문은 빼고 뽑음 (학생은 신입 지원)
--   qb_recent_reps:     그 학생의 최근 면접 5번에 낸 대표 질문 (자기소개·지원동기·마무리는 빼고)
--   qb_polished:        AI가 다듬은 질문 보관함 (같은 대표 질문 + 같은 지원 회사면 다시 씀)
--   qb_served:          학생별 출제 기록

create table if not exists public.qb_polished (
  key text primary key,            -- 대표 질문 비교 글 | 지원 회사 키(없으면 구분)
  rep_key text, target text, qtype text,
  text text not null, lang text not null default 'ko', model text,
  created_at timestamptz not null default now()
);
create table if not exists public.qb_served (
  id bigserial primary key,
  user_id uuid not null, pick_id text not null, ver integer, seq integer,
  qid text, rep_key text, qtype text, company_key text, target text, tier integer, how text,
  served_at timestamptz not null default now()
);
create index if not exists qb_served_user on public.qb_served (user_id, served_at desc);
alter table public.qb_polished enable row level security;
alter table public.qb_served enable row level security;
drop policy if exists "관리자 읽기" on public.qb_polished; create policy "관리자 읽기" on public.qb_polished for select to authenticated using (public.is_admin());
drop policy if exists "본인·관리자 읽기" on public.qb_served; create policy "본인·관리자 읽기" on public.qb_served for select to authenticated using (user_id = auth.uid() or public.is_admin());

create or replace function public.qb_pick_candidates(p_ver integer, p_qtype text, p_company text, p_grp text, p_job text, p_exclude text[], p_n integer)
returns table (id text, company_key text, company text, rep text, question text, rep_key text, tier integer)
language plpgsql stable security definer set search_path = public as $$
declare picked text[] := coalesce(p_exclude, '{}'); t integer; r record; got integer := 0;
begin
  for t in 1 .. 5 loop
    exit when got >= p_n;
    continue when t <= 2 and p_company is null;
    continue when t in (1, 3) and p_job is null;
    continue when t in (3, 4) and p_grp is null;
    for r in
      select x.* from (
        select distinct on (q.rep_key) q.id, q.company_key, q.company, q.rep, q.question, q.rep_key,
               -ln(greatest(random(), 1e-9)) / greatest(coalesce(q.weight, 0.15), 0.01) as s
          from public.qb_questions q
         where q.ver = p_ver and q.qtype = p_qtype and q.blocked is null and q.rep_key is not null
           and coalesce(q.rank, '') !~ '^(대리|과장|차장|부장|이사|주임/계장)'   -- 학생은 신입 지원 → 경력직 면접 질문은 빼고 뽑음
           and (coalesce(q.question, '') || ' ' || coalesce(q.rep, '')) !~ '(이직|전\s?직장|이전\s?직장|직전\s?(회사|직장)|퇴사|현\s?직장|현재\s?(회사|직장)|전\s?회사|경력\s?(기술|사항)|경력사항|재직\s?중)'   -- 이직·퇴사 사유처럼 직장 경력을 전제로 한 질문도 뺌
           and not (q.rep_key = any(picked))
           and case t when 1 then q.company_key = p_company and q.job = p_job
                      when 2 then q.company_key = p_company
                      when 3 then q.grp = p_grp and q.job = p_job
                      when 4 then q.grp = p_grp
                      else true end
         order by q.rep_key, s) x
      order by x.s limit (p_n - got)
    loop
      id := r.id; company_key := r.company_key; company := r.company; rep := r.rep; question := r.question; rep_key := r.rep_key; tier := t;
      picked := picked || r.rep_key; got := got + 1;
      return next;
    end loop;
  end loop;
end $$;

create or replace function public.qb_recent_reps(p_user uuid, p_n integer default 5) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct s.rep_key), '{}')
    from public.qb_served s
   where s.user_id = p_user and s.rep_key is not null and s.qtype not in ('자기소개', '지원동기', '마무리')
     and s.pick_id in (select pick_id from public.qb_served where user_id = p_user group by pick_id order by max(served_at) desc limit p_n);
$$;

revoke all on function public.qb_pick_candidates(integer, text, text, text, text, text[], integer) from public, anon, authenticated;
revoke all on function public.qb_recent_reps(uuid, integer) from public, anon, authenticated;
grant execute on function public.qb_pick_candidates(integer, text, text, text, text, text[], integer) to service_role;
grant execute on function public.qb_recent_reps(uuid, integer) to service_role;
