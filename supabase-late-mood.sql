-- ============================================================
-- Хоцролтын бүртгэл + Ахлах ангийн сурагчдын сэтгэл мэдрэмжийн бүртгэл
-- Supabase SQL Editor дээр бүхэлд нь хуулж Run дарна (дахин ажиллуулж болно).
-- ============================================================

-- Ирц (хоцролт) бүртгэх тусдаа код. Энгийн багшийн код (gate_code) энд хамаарахгүй:
-- зөвхөн энэ кодоор эсвэл админ эрхээр орсон хүн хоцролт, сэтгэл мэдрэмжийн өгөгдлийг харна.
alter table site_settings add column if not exists attendance_code text not null default '';
drop function if exists gate_code_ok(text);

create or replace function attendance_code_ok(code_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from site_settings
    where id = 'main' and attendance_code <> '' and attendance_code = coalesce(code_input, '')
  );
$$;
revoke all on function attendance_code_ok(text) from public, anon, authenticated;

-- Админ (Supabase-ээр нэвтэрсэн) эсвэл ирцийн код зөв эсэх
create or replace function staff_ok(code_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'authenticated' or attendance_code_ok(code_input);
$$;
revoke all on function staff_ok(text) from public, anon, authenticated;

-- Нүүр хуудасны «Ирц бүртгэх» нэвтрэлт: код зөв бол true
create or replace function attendance_login(code_input text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select attendance_code_ok(code_input);
$$;
grant execute on function attendance_login(text) to anon, authenticated;

-- ---------------- ХОЦРОЛТ ----------------
create table if not exists late_arrivals (
  id bigint generated always as identity primary key,
  late_date date not null default ((now() at time zone 'Asia/Ulaanbaatar')::date),
  class_name text not null,
  student_name text not null,
  arrived_at time,
  minutes_late int check (minutes_late is null or minutes_late between 0 and 600),
  reason text,
  recorded_by text,
  created_at timestamptz not null default now()
);
create index if not exists late_arrivals_date_idx on late_arrivals (late_date);
alter table late_arrivals enable row level security;
drop policy if exists "authenticated manage late_arrivals" on late_arrivals;
create policy "authenticated manage late_arrivals" on late_arrivals for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

create or replace function late_add(
  code_input text, p_date date, p_class text, p_student text,
  p_arrived time, p_minutes int, p_reason text, p_by text
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare new_id bigint;
begin
  if not staff_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  if coalesce(trim(p_class), '') = '' or coalesce(trim(p_student), '') = '' then
    raise exception 'Анги, сурагчийн нэрийг бөглөнө үү';
  end if;
  insert into late_arrivals (late_date, class_name, student_name, arrived_at, minutes_late, reason, recorded_by)
  values (
    coalesce(p_date, (now() at time zone 'Asia/Ulaanbaatar')::date),
    left(trim(p_class), 20), left(trim(p_student), 120), p_arrived, p_minutes,
    nullif(left(trim(coalesce(p_reason, '')), 300), ''), nullif(left(trim(coalesce(p_by, '')), 120), '')
  ) returning id into new_id;
  return new_id;
end;
$$;
grant execute on function late_add(text, date, text, text, time, int, text, text) to anon, authenticated;

-- jsonb-ээр буцаана (PostgREST-ийн 1000 мөрийн хязгаарт тасрахгүй)
drop function if exists late_list(text, date, date);
create or replace function late_list(code_input text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not staff_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) order by l.late_date desc, l.created_at desc)
    from late_arrivals l where l.late_date between p_from and p_to), '[]'::jsonb);
end;
$$;
grant execute on function late_list(text, date, date) to anon, authenticated;

-- Багш зөвхөн өөрийн бүртгэсэн мөрийг, админ бүх мөрийг устгана
create or replace function late_delete(code_input text, p_id bigint, p_by text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    delete from late_arrivals where id = p_id;
    return found;
  end if;
  if not attendance_code_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  delete from late_arrivals where id = p_id and recorded_by = trim(coalesce(p_by, ''));
  return found;
end;
$$;
grant execute on function late_delete(text, bigint, text) to anon, authenticated;

-- ---------------- СУРАГЧДЫН ЖАГСААЛТ (shalgalt184-өөс хуулсан: зөвхөн анги + овог нэр) ----------------
create table if not exists school_students (
  id bigint generated always as identity primary key,
  class_name text not null,
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (class_name, full_name)
);
alter table school_students enable row level security;
drop policy if exists "authenticated manage school_students" on school_students;
create policy "authenticated manage school_students" on school_students for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop function if exists students_list(text);
create or replace function students_list(code_input text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not staff_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'class_name', s.class_name, 'full_name', s.full_name)
    order by s.class_name, s.full_name) from school_students s where s.active), '[]'::jsonb);
end;
$$;
grant execute on function students_list(text) to anon, authenticated;

-- Нэг ангийн хоцролтыг нэг дор хадгална: p_rows = [{"student":"...","minutes":10,"reason":"..."}]
create or replace function late_add_batch(code_input text, p_date date, p_class text, p_rows jsonb, p_by text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; n int := 0; m int;
begin
  if not staff_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  if coalesce(trim(p_class), '') = '' then raise exception 'Ангиа сонгоно уу'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if coalesce(trim(r->>'student'), '') = '' then continue; end if;
    m := least(greatest(coalesce(nullif(r->>'minutes', '')::int, 0), 0), 600);
    insert into late_arrivals (late_date, class_name, student_name, minutes_late, reason, recorded_by)
    values (
      coalesce(p_date, (now() at time zone 'Asia/Ulaanbaatar')::date),
      left(trim(p_class), 20), left(trim(r->>'student'), 120), m,
      nullif(left(trim(coalesce(r->>'reason', '')), 300), ''), nullif(left(trim(coalesce(p_by, '')), 120), '')
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
grant execute on function late_add_batch(text, date, text, jsonb, text) to anon, authenticated;

-- ---------------- СЭТГЭЛ МЭДРЭМЖ (10–12-р анги) ----------------
create table if not exists mood_entries (
  id bigint generated always as identity primary key,
  entry_date date not null default ((now() at time zone 'Asia/Ulaanbaatar')::date),
  grade int not null check (grade between 10 and 12),
  class_name text not null,
  mood int not null check (mood between 1 and 5),
  tags text[] not null default '{}',
  comment text,
  device_id text not null,
  created_at timestamptz not null default now(),
  unique (device_id, entry_date)
);
create index if not exists mood_entries_date_idx on mood_entries (entry_date);
alter table mood_entries enable row level security;
drop policy if exists "authenticated manage mood_entries" on mood_entries;
create policy "authenticated manage mood_entries" on mood_entries for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Сурагч нэргүйгээр илгээнэ. Нэг төхөөрөмжөөс өдөрт 1 удаа ('ok' | 'dup')
create or replace function mood_submit(p_class text, p_mood int, p_tags text[], p_comment text, p_device text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare g int;
begin
  g := nullif(substring(coalesce(p_class, '') from '^(1[0-2])'), '')::int;
  if g is null then raise exception 'Ангиа сонгоно уу'; end if;
  if p_mood is null or p_mood < 1 or p_mood > 5 then raise exception 'Мэдрэмжээ сонгоно уу'; end if;
  if coalesce(length(p_device), 0) < 8 then raise exception 'Төхөөрөмж танигдсангүй'; end if;
  insert into mood_entries (grade, class_name, mood, tags, comment, device_id)
  values (
    g, left(trim(p_class), 10), p_mood,
    coalesce((select array_agg(left(t, 40)) from unnest(p_tags[1:12]) t), '{}'),
    nullif(left(trim(coalesce(p_comment, '')), 500), ''), left(p_device, 64)
  )
  on conflict (device_id, entry_date) do nothing;
  if found then return 'ok'; end if;
  return 'dup';
end;
$$;
grant execute on function mood_submit(text, int, text[], text, text) to anon, authenticated;

drop function if exists mood_list(text, date, date);
create or replace function mood_list(code_input text, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not staff_ok(code_input) then raise exception 'Нэвтрэх код буруу байна'; end if;
  -- device_id-г буцаахгүй (нэргүй байдлыг хадгална)
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'entry_date', m.entry_date, 'grade', m.grade,
      'class_name', m.class_name, 'mood', m.mood, 'tags', m.tags, 'comment', m.comment, 'created_at', m.created_at)
    order by m.entry_date desc, m.created_at desc) from mood_entries m where m.entry_date between p_from and p_to), '[]'::jsonb);
end;
$$;
grant execute on function mood_list(text, date, date) to anon, authenticated;
