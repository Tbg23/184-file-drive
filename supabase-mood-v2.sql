-- ============================================================
-- Daily School Well-being Check-in (2026-11-24): 6–12-р анги, мэдрэмжийн хүч (1–4),
-- «хамгийн их хэрэгтэй зүйл» (comment талбарт). Дахин ажиллуулж болно.
-- ============================================================
alter table mood_entries drop constraint if exists mood_entries_grade_check;
alter table mood_entries add constraint mood_entries_grade_check check (grade between 6 and 12);
alter table mood_entries add column if not exists intensity int;
alter table mood_entries drop constraint if exists mood_entries_intensity_check;
alter table mood_entries add constraint mood_entries_intensity_check check (intensity is null or intensity between 1 and 4);

drop function if exists mood_submit(text, int, text[], text, text);
drop function if exists mood_submit(text, int, text[], text, text, int);
create or replace function mood_submit(p_class text, p_mood int, p_tags text[], p_comment text, p_device text, p_intensity int default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare g int;
begin
  g := nullif(substring(coalesce(p_class, '') from '^(1[0-2]|[6-9])'), '')::int;
  if g is null then raise exception 'Ангиа сонгоно уу'; end if;
  if p_mood is null or p_mood < 1 or p_mood > 5 then raise exception 'Мэдрэмжээ сонгоно уу'; end if;
  if p_intensity is not null and (p_intensity < 1 or p_intensity > 4) then raise exception 'Мэдрэмжийн хүчийг сонгоно уу'; end if;
  if coalesce(length(p_device), 0) < 8 then raise exception 'Төхөөрөмж танигдсангүй'; end if;
  insert into mood_entries (grade, class_name, mood, intensity, tags, comment, device_id)
  values (
    g, left(trim(p_class), 10), p_mood, p_intensity,
    coalesce((select array_agg(left(t, 60)) from unnest(p_tags[1:24]) t), '{}'),
    nullif(left(trim(coalesce(p_comment, '')), 500), ''), left(p_device, 64)
  )
  on conflict (device_id, entry_date) do nothing;
  if found then return 'ok'; end if;
  return 'dup';
end;
$$;
grant execute on function mood_submit(text, int, text[], text, text, int) to anon, authenticated;

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
      'class_name', m.class_name, 'mood', m.mood, 'intensity', m.intensity, 'tags', m.tags, 'comment', m.comment, 'created_at', m.created_at)
    order by m.entry_date desc, m.created_at desc) from mood_entries m where m.entry_date between p_from and p_to), '[]'::jsonb);
end;
$$;
grant execute on function mood_list(text, date, date) to anon, authenticated;

-- Бөглөх хуудсанд ангийн нэрс (зөвхөн «6А» гэх мэт нэр, сурагчийн мэдээлэлгүй)
create or replace function mood_classes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(distinct s.class_name), '[]'::jsonb)
  from school_students s
  where s.active and s.class_name ~ '^(1[0-2]|[6-9])[^0-9]';
$$;
grant execute on function mood_classes() to anon, authenticated;
