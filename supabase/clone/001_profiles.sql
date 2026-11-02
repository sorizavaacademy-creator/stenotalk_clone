-- 2026-11-02 클론 DB(ZAVAPASS-clone, yiuraowvnadqdrnysdce) 전용: 회원 정보 표
-- 칸 구성은 운영 ZAVAPASS의 profiles와 같음 (구조만 읽어서 옮김, 데이터는 옮기지 않음)
-- 운영 프로젝트(aqkukxcjcbfxqfesmuva)에는 실행하지 않음

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  note text default '',
  is_admin boolean not null default false,
  allowed_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  status text not null default '준비 중',
  phone text,
  privacy_agreed_at timestamptz,
  access_until date,
  ai_override text,
  ai_bonus integer not null default 0,
  must_change_password boolean not null default false,
  temp_password_at timestamptz,
  password_changed_at timestamptz,
  is_staff boolean not null default false,
  tts_cap integer,
  tts_bonus integer not null default 0,
  tts_bonus_month text,
  report_pledge_at timestamptz
);

alter table public.profiles enable row level security;

-- 관리자 여부 (정책 안에서 profiles를 다시 읽어도 무한 반복되지 않게 security definer)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 본인 것: 가입할 때 만들기(관리자 권한은 못 켬)·읽기·고치기
create policy "profiles: 본인 만들기" on public.profiles for insert to authenticated
  with check (id = auth.uid() and is_admin = false and is_staff = false);
create policy "profiles: 본인 읽기" on public.profiles for select to authenticated
  using (id = auth.uid());
create policy "profiles: 본인 고치기" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 관리자: 모두 읽기·고치기
create policy "profiles: 관리자 읽기" on public.profiles for select to authenticated
  using (public.is_admin());
create policy "profiles: 관리자 고치기" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 관리자가 아닌 사람이 자기 is_admin·is_staff를 바꾸지 못하게 막음
create or replace function public.profiles_guard_roles() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.is_admin is distinct from old.is_admin or new.is_staff is distinct from old.is_staff)
     and auth.uid() is not null and not public.is_admin() then
    raise exception '관리자 권한은 관리자만 바꿀 수 있어요';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_roles on public.profiles;
create trigger profiles_guard_roles before update on public.profiles
  for each row execute function public.profiles_guard_roles();
