# 184 Файлын сан

Google Drive шиг фолдер бүтэцтэй, docx/xlsx/pdf/зураг файлыг шууд сайт дээр нь нээж харуулдаг,
файл тус бүрт QR код үүсгэдэг сайт. Файлууд Supabase Storage дээр хадгалагдана, сайт нь Vercel
дээр static хэлбэрээр байршина (build алхам, Node.js шаардлагагүй).

## 1) Supabase тохиргоо

1. https://supabase.com дээр төслөө үүсгэсэн бол нээгээд, эсрэг тохиолдолд шинээр project үүсгэ.
2. **SQL Editor** руу орж `supabase-schema.sql` файлын бүх агуулгыг хуулж, **Run** дар.
   - Энэ нь `folders`, `files` хүснэгт, эрхийн дүрэм (RLS), `files` нэртэй Storage bucket үүсгэнэ.
3. **Storage** хэсэгт орж `files` bucket үүссэнийг шалга (public байх ёстой).
4. **Authentication → Users** хэсэгт админ болох 1 хэрэглэгч (өөрийн имэйл/нууц үг) нэмнэ
   ("Add user" → "Create new user", **Auto Confirm User**-г идэвхжүүл). Энэ имэйл/нууц үгээрээ
   сайт дээрх "Админ нэвтрэх" товчоор орж файл нэмэх/устгах эрхтэй болно.
5. (Заавал биш) **Database → Replication** хэсэгт `folders`, `files` хүснэгтийг идэвхжүүлбэл
   нэг хүн файл нэмэхэд бусад нээлттэй tab дээр шууд шинэчлэгдэнэ.
6. **Project Settings → API** хэсгээс **Project URL** болон **anon public** key-г хуулж аваад
   `config.js` файлд бич.

## 2) Локал тохиргоо

`config.js` файлыг нээж:

```js
export const SUPABASE_URL = "https://xxxxx.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
export const VIEW_PASSCODE = "184ISO"; // хүссэн кодоороо солино
```

## 3) GitHub + Vercel дээр байршуулах

```bash
cd 184-file-drive
git init
git add .
git commit -m "Initial commit"
gh repo create 184-file-drive --private --source=. --push
```

(`gh` CLI байхгүй бол GitHub.com дээр шинэ repo үүсгээд заавар ёсоор `git remote add origin ...`
болон `git push` хий.)

Дараа нь [vercel.com](https://vercel.com) → **Add New Project** → энэ GitHub repo-г сонго.
- Framework Preset: **Other**
- Build Command: хоосон орхи
- Output Directory: `.`

Deploy дараад өгсөн `*.vercel.app` холбоос дээрээ сайт нээгдэнэ (дараа нь өөрийн домайн ч холбож болно).

## Ажиллах зарчим

- **Нэвтрэх код** (`VIEW_PASSCODE`) — QR уншуулж орох бүх хүнд зориулсан энгийн, найдвартай бус
  hindrer гэдгийг анхаараарай (жинхэнэ хамгаалалт биш).
- **Админ нэвтрэх** — Supabase Auth ашигладаг жинхэнэ нэвтрэлт; зөвхөн нэвтэрсэн админ файл
  нэмэх/устгах/нэр солих боломжтой (RLS-ээр сервер талд хамгаалагдсан).
- **Файл харах** — docx (mammoth.js), xlsx (SheetJS, хуудас бүрээр), PDF/зураг шууд, draw.io
  шинэ tab дээр diagrams.net ашиглан нээнэ. Бусад төрлийг шинэ tab-аар нээнэ.
- **QR** — файл тус бүрийн мөрөн дэх ▦ товч, эсвэл нээсэн файлын дэлгэц дотор.
