-- 184 Файлын сан — Supabase schema
-- Энэ бүхлийг Supabase Dashboard → SQL Editor дотор хуулж, "Run" дарна.

create table if not exists folders (
  id text primary key,
  name text not null,
  parent_id text references folders(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists files (
  id text primary key,
  name text not null,
  folder_id text not null references folders(id) on delete cascade,
  ext text not null,
  mime text not null,
  storage_path text not null,
  size bigint,
  added_at timestamptz not null default now()
);

create index if not exists files_folder_id_idx on files(folder_id);
create index if not exists folders_parent_id_idx on folders(parent_id);

alter table folders enable row level security;
alter table files enable row level security;

-- Хэн ч (нэвтрээгүй хүн ч) уншиж болно — сайт өөрөө нэвтрэх код (passcode)-оор хамгаална.
create policy "public read folders" on folders for select using (true);
create policy "public read files" on files for select using (true);

-- Зөвхөн Supabase Auth-аар нэвтэрсэн (админ) хүн бичиж/устгаж болно.
create policy "authenticated write folders" on folders for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated write files" on files for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Эхний фолдер бүтэц (өөрийн Drive-ийн жишээгээр) — шаардлагагүй бол устгаад өөрөө үүсгэж болно.
insert into folders (id, name, parent_id) values
  ('root', '', null),
  ('f-184', '184 хэрэгжүүлэлт', 'root'),
  ('f-bolov', 'Боловсруулж байгаа', 'root'),
  ('f-dotood', 'Дотоод аудит', 'root'),
  ('f-4r', '4-р бүлэг', 'f-184'),
  ('f-5r', '5-р бүлэг', 'f-184'),
  ('f-6', '6 бүлэг', 'f-184'),
  ('f-7r', '7-р бүлэг', 'f-184'),
  ('f-8r', '8-р бүлэг', 'f-184'),
  ('f-9', '9 бүлэг', 'f-184'),
  ('f-master', 'Мастер жагсаалт', 'f-184'),
  ('f-sudalgaa', 'Судалгаанууд', 'f-184')
on conflict (id) do nothing;

-- QR самбар: админ өөрийн загварчилсан QR зургаа нэрийн хамт байршуулна.
create table if not exists qr_items (
  id text primary key,
  name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);
alter table qr_items enable row level security;
create policy "public read qr_items" on qr_items for select using (true);
create policy "authenticated write qr_items" on qr_items for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Дараа нь Dashboard → Storage дотор "files" нэртэй PUBLIC bucket үүсгэнэ үү,
-- дараа нь доорх storage policy-г SQL Editor-т ажиллуулна:

insert into storage.buckets (id, name, public)
values ('files', 'files', true)
on conflict (id) do nothing;

create policy "public read storage" on storage.objects for select
  using (bucket_id = 'files');
create policy "authenticated write storage" on storage.objects for insert
  with check (bucket_id = 'files' and auth.role() = 'authenticated');
create policy "authenticated update storage" on storage.objects for update
  using (bucket_id = 'files' and auth.role() = 'authenticated');
create policy "authenticated delete storage" on storage.objects for delete
  using (bucket_id = 'files' and auth.role() = 'authenticated');

-- Хичээлийн жилийн хуанли: нэг мөрт бүх төлөвлөгөө хадгална (админ засна, бусад нь зөвхөн харна).
-- Анхны өгөгдлийг (ангилал + бичлэгүүд) энд SQL-аар оруулахгүй — хэт урт мөр
-- хуулахад тасардаг тул сайт өөрөө анх удаа админ "Хуанли" таб нээхэд
-- assets/calendar/seed-state.json-оос уншиж автоматаар бөглөнө.
create table if not exists calendar_state (
  id text primary key,
  start_year int not null default 2026,
  categories jsonb not null default '[]',
  events jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table calendar_state enable row level security;
create policy "public read calendar_state" on calendar_state for select using (true);
create policy "authenticated write calendar_state" on calendar_state for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
