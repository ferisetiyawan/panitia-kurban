# SQL Migrations

Karena production menggunakan `DB_SYNCHRONIZE=false`, setiap PR yang menambah tabel/kolom baru harus disertai file SQL di folder ini.

## Cara Menjalankan

Sebelum deploy, jalankan file SQL yang relevan di database production:

```bash
psql $DATABASE_URL -f sql/migrations/<nama-file>.sql
```

Atau via psql interaktif:
```bash
psql $DATABASE_URL
\i sql/migrations/<nama-file>.sql
```

## Daftar Migrations

| File | PR | Keterangan |
|------|----|------------|
| `001_create_animals_table.sql` | feat/animal-card | Tabel `animals` untuk kartu hewan kurban |
