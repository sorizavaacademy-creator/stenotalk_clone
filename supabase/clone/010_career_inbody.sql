-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 009_interviewer_voices.sql 다음에 실행
--
-- 커리어 인바디(학생이 마이페이지에 직접 적는 학점·어학·자격·경험 수치). 학교 커리어 인바디가 연동되면 같은 칸을 자동으로 채움
--   share_stats : '비슷한 학생 비교'에 내 수치를 이름 없이 보태기 (기본 꺼짐). 보탠 학생만 비교 결과를 볼 수 있음
-- 비교는 inbody_peers()로만: 같은 분야 학생이 5명 이상일 때만 숫자를 주고, 자격증은 3명 이상 가진 것만 이름을 보여 줌 (누군지 알 수 없게)

create table if not exists public.career_inbody (
  user_id uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  grade text check (grade in ('1','2','3','4','졸업')),
  gpa numeric(3,2) check (gpa between 0 and 4.5),
  gpa_max numeric(2,1) not null default 4.5 check (gpa_max in (4.0, 4.3, 4.5)),
  major_gpa numeric(3,2) check (major_gpa between 0 and 4.5),
  toeic integer check (toeic between 10 and 990),
  toeic_speaking text check (toeic_speaking in ('Lv1','Lv2','Lv3','Lv4','Lv5','Lv6','Lv7','Lv8')),
  opic text check (opic in ('NL','NM','NH','IL','IM1','IM2','IM3','IH','AL')),
  other_lang text check (length(other_lang) <= 60),
  certs jsonb not null default '[]'::jsonb,
  intern_months integer check (intern_months between 0 and 60),
  activities integer check (activities between 0 and 50),
  awards integer check (awards between 0 and 50),
  volunteer_hours integer check (volunteer_hours between 0 and 5000),
  projects integer check (projects between 0 and 50),
  target_field text,
  target_role text check (length(target_role) <= 40),
  share_stats boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.career_inbody enable row level security;
drop policy if exists "career_inbody: 본인 전체" on public.career_inbody;
create policy "career_inbody: 본인 전체" on public.career_inbody for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "career_inbody: 교직원 읽기" on public.career_inbody;
create policy "career_inbody: 교직원 읽기" on public.career_inbody for select to authenticated using (public.can_see_user(user_id));

-- 비슷한 학생(같은 목표 분야, 가능하면 같은 학년) 비교. 내 수치의 위치(상위 몇 %)와 그 학생들의 면접 연습 점수 평균
create or replace function public.inbody_peers(p_field text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me public.career_inbody; fld text; same_grade boolean := true; n int; res jsonb;
begin
  select * into me from public.career_inbody where user_id = auth.uid();
  if not found then return jsonb_build_object('status','no_data'); end if;
  if not me.share_stats then return jsonb_build_object('status','locked'); end if;
  fld := coalesce(nullif(p_field,''), me.target_field);
  if fld is null then return jsonb_build_object('status','no_field'); end if;
  select count(*) into n from public.career_inbody c where c.share_stats and c.target_field = fld and c.grade is not distinct from me.grade;
  if n < 5 then same_grade := false; select count(*) into n from public.career_inbody c where c.share_stats and c.target_field = fld; end if;
  if n < 5 then return jsonb_build_object('status','few','n',n,'field',fld); end if;
  with peers as (
    select c.*, case when c.gpa is null then null else round(c.gpa / c.gpa_max * 4.5, 2) end as gpa45
      from public.career_inbody c where c.share_stats and c.target_field = fld and (not same_grade or c.grade is not distinct from me.grade)
  ), sc as (
    select r.user_id, avg(r.score)::numeric as s from (
      select ir.user_id, ir.score, row_number() over (partition by ir.user_id order by ir.created_at desc) rn
        from public.interview_records ir join peers p on p.user_id = ir.user_id where ir.score is not null) r
     where r.rn <= 5 group by r.user_id
  ), certs as (
    select x->>'name' as name, count(distinct p.user_id) as k from peers p, jsonb_array_elements(p.certs) x where coalesce(x->>'name','') <> '' group by 1 having count(distinct p.user_id) >= 3 order by 2 desc limit 5
  )
  select jsonb_build_object(
    'status','ok', 'n', n, 'field', fld, 'same_grade', same_grade, 'grade', me.grade,
    'gpa', (select jsonb_build_object('p25', percentile_cont(0.25) within group (order by gpa45), 'p50', percentile_cont(0.5) within group (order by gpa45), 'p75', percentile_cont(0.75) within group (order by gpa45), 'k', count(gpa45),
              'me_pct', case when me.gpa is null then null else round(100.0 * count(*) filter (where gpa45 < round(me.gpa / me.gpa_max * 4.5, 2)) / nullif(count(gpa45),0)) end) from peers),
    'toeic', (select jsonb_build_object('p25', percentile_cont(0.25) within group (order by toeic), 'p50', percentile_cont(0.5) within group (order by toeic), 'p75', percentile_cont(0.75) within group (order by toeic), 'k', count(toeic),
              'me_pct', case when me.toeic is null then null else round(100.0 * count(*) filter (where toeic < me.toeic) / nullif(count(toeic),0)) end) from peers),
    'intern_rate', (select round(100.0 * count(*) filter (where coalesce(intern_months,0) > 0) / count(*)) from peers),
    'activities_avg', (select round(avg(coalesce(activities,0)), 1) from peers),
    'projects_avg', (select round(avg(coalesce(projects,0)), 1) from peers),
    'certs', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'pct', round(100.0 * k / n))) from certs), '[]'::jsonb),
    'score', (select jsonb_build_object('avg', round(avg(s)), 'k', count(*)) from sc),
    'my_score', (select round(avg(score)) from (select score from public.interview_records where user_id = auth.uid() and score is not null order by created_at desc limit 5) t)
  ) into res;
  return res;
end $$;
revoke all on function public.inbody_peers(text) from public, anon;
grant execute on function public.inbody_peers(text) to authenticated;
