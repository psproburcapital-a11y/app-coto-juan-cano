-- =============================================================
--  App Coto Juan Cano · Esquema de base de datos (Fase 1)
--  Pegar entero en Supabase > SQL Editor > New query > Run
--  Se puede ejecutar más de una vez sin romper nada.
-- =============================================================

-- ---------- Tablas ----------
create table if not exists public.gestores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado  timestamptz not null default now()
);

create or replace function public.generar_codigo()
returns text language sql volatile as $$
  -- 6 caracteres sin letras ni números que se confundan (sin 0, O, 1, I, L)
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31)+1)::int, 1), '')
  from generate_series(1,6);
$$;

create table if not exists public.socios (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  telefono       text,
  codigo         text not null unique default public.generar_codigo(),
  user_id        uuid unique references auth.users(id) on delete set null,
  activo         boolean not null default true,
  consentimiento timestamptz,
  creado         timestamptz not null default now()
);

create table if not exists public.parcelas (
  id     text primary key,          -- referencia catastral
  nombre text not null,             -- "Pol. 150 Parc. 12"
  ha     numeric,
  geom   jsonb not null,            -- GeoJSON (MultiPolygon, WGS84)
  creado timestamptz not null default now()
);

create table if not exists public.zonas (
  id     uuid primary key default gen_random_uuid(),
  nombre text not null default '',
  tipo   text not null check (tipo in ('caza','reserva','prohibida','seguridad')),
  geom   jsonb not null,            -- GeoJSON (Polygon, WGS84)
  creado timestamptz not null default now()
);

create table if not exists public.puntos (
  id     uuid primary key default gen_random_uuid(),
  tipo   text not null check (tipo in ('bebedero','comedero','puesto','acceso','aparcamiento','otro')),
  nombre text not null default '',
  nota   text,
  lat    double precision not null,
  lng    double precision not null,
  creado timestamptz not null default now()
);

-- ---------- Quién es quién ----------
create or replace function public.es_gestor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from gestores where user_id = auth.uid());
$$;

create or replace function public.es_socio()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from socios where user_id = auth.uid() and activo);
$$;

-- El socio mete su código en la app y queda vinculado a su móvil
create or replace function public.canjear_codigo(c text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare v_nombre text;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  update socios set user_id = null where user_id = auth.uid();
  update socios set user_id = auth.uid()
   where upper(codigo) = upper(trim(c)) and activo
  returning nombre into v_nombre;
  return v_nombre;  -- null si el código no existe
end $$;

create or replace function public.registrar_consentimiento()
returns void language sql volatile security definer set search_path = public as $$
  update socios set consentimiento = now() where user_id = auth.uid();
$$;

grant execute on function public.es_gestor(), public.es_socio(),
  public.canjear_codigo(text), public.registrar_consentimiento() to authenticated;
revoke execute on function public.canjear_codigo(text), public.registrar_consentimiento() from public, anon;

-- ---------- Permisos (RLS) ----------
alter table public.gestores enable row level security;
alter table public.socios   enable row level security;
alter table public.parcelas enable row level security;
alter table public.zonas    enable row level security;
alter table public.puntos   enable row level security;

drop policy if exists "gestor se ve" on public.gestores;
create policy "gestor se ve" on public.gestores for select using (user_id = auth.uid());

drop policy if exists "gestor todo socios" on public.socios;
create policy "gestor todo socios" on public.socios for all using (public.es_gestor()) with check (public.es_gestor());
drop policy if exists "socio se ve" on public.socios;
create policy "socio se ve" on public.socios for select using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['parcelas','zonas','puntos'] loop
    execute format('drop policy if exists "leer" on public.%I', t);
    execute format('create policy "leer" on public.%I for select using (public.es_gestor() or public.es_socio())', t);
    execute format('drop policy if exists "gestor escribe" on public.%I', t);
    execute format('create policy "gestor escribe" on public.%I for all using (public.es_gestor()) with check (public.es_gestor())', t);
  end loop;
end $$;
