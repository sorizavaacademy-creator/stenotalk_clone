-- 2026-11-03 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용. 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음
-- 006_prep_state.sql 다음에 실행
--
-- 권한 4단계 (profiles.role)
--   admin   관리자      : 모든 화면 + 권한 부여 + 이용 중지
--   staff   교직원      : 모든 학생의 연습 현황·기록 보기, 상담 메모, 공지 쓰기, 의견 답장 (권한 부여는 못 함)
--   dept    학과 담당   : 맡은 학과(scope_depts) 학생만 보기 + 상담 메모 (공지·의견·권한은 못 함)
--   student 면접자(학생): 면접 연습만
-- 예전 칸 is_admin·is_staff는 role에 맞춰 자동으로 채움 (앱의 기존 코드가 그대로 동작하게)
--   admin → is_admin, staff·dept → is_staff (학생 통계에서 빠짐)
-- 권한은 관리자만 set_user_role()로 바꿀 수 있고, 바꿀 때마다 role_log에 남음

alter table public.profiles
  add column if not exists role text not null default 'student',
  add column if not exists college text,
  add column if not exists dept text,
  add column if not exists scope_depts text[] not null default '{}';
do $$ begin
  alter table public.profiles add constraint profiles_role_check check (role in ('admin','staff','dept','student'));
exception when duplicate_object then null; end $$;

-- 가입 때 note('한림대학교 {단과대학} {학과}')로만 남아 있던 소속을 칸으로 옮김
update public.profiles
   set college = split_part(note, ' ', 2), dept = split_part(note, ' ', 3)
 where college is null and note like '한림대학교 % %';
update public.profiles set role = 'admin' where is_admin and role = 'student';
update public.profiles set role = 'staff' where is_staff and not is_admin and role = 'student';

-- role → is_admin·is_staff 맞추기
create or replace function public.profiles_sync_role() returns trigger
language plpgsql set search_path = public as $$
begin
  -- 예전 화면처럼 is_admin·is_staff만 바꿨으면 role을 거기에 맞춤
  if tg_op = 'UPDATE' and new.role is not distinct from old.role
     and (new.is_admin is distinct from old.is_admin or new.is_staff is distinct from old.is_staff) then
    new.role := case when new.is_admin then 'admin' when new.is_staff then 'staff' else 'student' end;
  end if;
  new.is_admin := (new.role = 'admin');
  new.is_staff := (new.role in ('staff','dept'));
  if new.role <> 'dept' then new.scope_depts := '{}'; end if;
  return new;
end $$;
drop trigger if exists profiles_sync_role on public.profiles;
create trigger profiles_sync_role before insert or update on public.profiles
  for each row execute function public.profiles_sync_role();

-- 관리자가 아닌 사람은 role·scope_depts·is_admin·is_staff를 못 바꿈 (본인 것도)
create or replace function public.profiles_guard_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.scope_depts is distinct from old.scope_depts
      or new.is_admin is distinct from old.is_admin or new.is_staff is distinct from old.is_staff)
     and auth.uid() is not null and not public.is_admin() then
    raise exception '권한은 관리자만 바꿀 수 있어요';
  end if;
  return new;
end $$;

-- 가입할 때는 학생으로만
drop policy if exists "profiles: 본인 만들기" on public.profiles;
create policy "profiles: 본인 만들기" on public.profiles for insert to authenticated
  with check (id = auth.uid() and role = 'student' and is_admin = false and is_staff = false and scope_depts = '{}');

-- ── 권한 확인 함수 (정책 안에서 profiles를 다시 읽어도 반복되지 않게 security definer) ──
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid() and status <> '이용 중지'), 'student');
$$;
-- 관리자·교직원
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','staff');
$$;
-- 관리자·교직원·학과 담당
create or replace function public.is_school_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','staff','dept');
$$;
-- 이 사람의 기록을 볼 수 있나: 관리자·교직원은 모두, 학과 담당은 맡은 학과 학생만
create or replace function public.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case public.my_role()
    when 'admin' then true
    when 'staff' then true
    when 'dept' then exists (
      select 1 from public.profiles t, public.profiles me
       where t.id = p_user and me.id = auth.uid()
         and t.role = 'student' and t.dept is not null and t.dept = any(me.scope_depts))
    else false end;
$$;
revoke all on function public.my_role() from public, anon;
revoke all on function public.is_manager() from public, anon;
revoke all on function public.is_school_staff() from public, anon;
revoke all on function public.can_see_user(uuid) from public, anon;
grant execute on function public.my_role() to authenticated;
grant execute on function public.is_manager() to authenticated;
grant execute on function public.is_school_staff() to authenticated;
grant execute on function public.can_see_user(uuid) to authenticated;

-- 이용 중지된 관리자는 관리자 권한도 쓰지 못하게
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and status <> '이용 중지' from public.profiles where id = auth.uid()), false);
$$;

-- ── 교직원·학과 담당이 읽을 수 있는 것 (읽기만) ──
create policy "profiles: 교직원 읽기" on public.profiles for select to authenticated using (public.can_see_user(id));
create policy "interview_records: 교직원 읽기" on public.interview_records for select to authenticated using (public.can_see_user(user_id));
create policy "interview_answers: 교직원 읽기" on public.interview_answers for select to authenticated
  using (exists (select 1 from public.interview_records r where r.id = record_id and public.can_see_user(r.user_id)));
create policy "prep_state: 교직원 읽기" on public.prep_state for select to authenticated using (public.can_see_user(user_id));
create policy "activity_log: 교직원 읽기" on public.activity_log for select to authenticated using (public.can_see_user(user_id));
create policy "user_presence: 교직원 읽기" on public.user_presence for select to authenticated using (public.can_see_user(user_id));
-- 의견·공지: 관리자·교직원
create policy "feedback: 교직원 읽기" on public.feedback for select to authenticated using (public.is_manager());
create policy "notices: 교직원 쓰기" on public.notices for all to authenticated using (public.is_manager()) with check (public.is_manager());
-- 자기소개서·연습 메모는 개인 자료라 관리자만 (005의 '관리자 읽기' 그대로)

-- 의견 답장 (교직원도). 답장·상태만 바꿈
create or replace function public.reply_feedback(p_id bigint, p_reply text, p_status text default '답장함') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception '관리자·교직원만 답장할 수 있어요'; end if;
  update public.feedback set reply = nullif(trim(p_reply), ''), replied_at = case when nullif(trim(p_reply), '') is null then null else now() end,
         reply_seen_at = null, status = coalesce(p_status, status), updated_at = now()
   where id = p_id;
end $$;
revoke all on function public.reply_feedback(bigint, text, text) from public, anon;
grant execute on function public.reply_feedback(bigint, text, text) to authenticated;

-- ── 권한 바꾸기 (관리자만) + 기록 ──
create table if not exists public.role_log (
  id bigint generated by default as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  changed_by uuid references auth.users(id) on delete set null,
  old_role text, new_role text,
  old_scope text[], new_scope text[],
  old_status text, new_status text,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.role_log enable row level security;
create policy "role_log: 관리자 읽기" on public.role_log for select to authenticated using (public.is_admin());

create or replace function public.set_user_role(p_user uuid, p_role text, p_scope text[] default '{}', p_status text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.profiles; n public.profiles; admins int;
begin
  if not public.is_admin() then raise exception '권한은 관리자만 바꿀 수 있어요'; end if;
  if p_role not in ('admin','staff','dept','student') then raise exception '알 수 없는 권한: %', p_role; end if;
  if p_status is not null and p_status not in ('준비 중','이용 중지') then raise exception '알 수 없는 상태: %', p_status; end if;
  if p_role = 'dept' and coalesce(cardinality(p_scope), 0) = 0 then raise exception '학과 담당은 맡을 학과를 하나 이상 골라 주세요'; end if;
  select * into o from public.profiles where id = p_user for update;
  if not found then raise exception '없는 계정이에요'; end if;
  -- 마지막 관리자가 스스로 권한을 내려놓거나 이용 중지되지 않게
  if o.role = 'admin' and (p_role <> 'admin' or p_status = '이용 중지') then
    select count(*) into admins from public.profiles where role = 'admin' and status <> '이용 중지' and id <> p_user;
    if admins = 0 then raise exception '관리자가 한 명은 남아 있어야 해요'; end if;
  end if;
  update public.profiles
     set role = p_role, scope_depts = case when p_role = 'dept' then p_scope else '{}' end,
         status = coalesce(p_status, status)
   where id = p_user returning * into n;
  if o.role is distinct from n.role or o.scope_depts is distinct from n.scope_depts or o.status is distinct from n.status then
    insert into public.role_log (user_id, changed_by, old_role, new_role, old_scope, new_scope, old_status, new_status, reason)
    values (p_user, auth.uid(), o.role, n.role, o.scope_depts, n.scope_depts, o.status, n.status, nullif(trim(p_reason), ''));
  end if;
  return jsonb_build_object('role', n.role, 'scope_depts', n.scope_depts, 'status', n.status);
end $$;
revoke all on function public.set_user_role(uuid, text, text[], text, text) from public, anon;
grant execute on function public.set_user_role(uuid, text, text[], text, text) to authenticated;

-- 관리 화면에서 이메일 보기 (관리자·교직원, 볼 수 있는 사람만)
create or replace function public.school_user_emails() returns table (id uuid, email text)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email::text from auth.users u where public.is_school_staff() and public.can_see_user(u.id);
$$;
revoke all on function public.school_user_emails() from public, anon;
grant execute on function public.school_user_emails() to authenticated;

-- ── 상담 메모: 교직원·학과 담당이 학생마다 남기는 메모 (학생에게는 안 보임) ──
create table if not exists public.staff_notes (
  id bigint generated by default as identity primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (length(trim(body)) > 0 and length(body) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists staff_notes_student_idx on public.staff_notes (student_id, created_at desc);
alter table public.staff_notes enable row level security;
create policy "staff_notes: 볼 수 있는 학생 읽기" on public.staff_notes for select to authenticated
  using (public.is_school_staff() and public.can_see_user(student_id));
create policy "staff_notes: 볼 수 있는 학생에게 쓰기" on public.staff_notes for insert to authenticated
  with check (author_id = auth.uid() and public.is_school_staff() and public.can_see_user(student_id));
create policy "staff_notes: 쓴 사람·관리자 지우기" on public.staff_notes for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());
