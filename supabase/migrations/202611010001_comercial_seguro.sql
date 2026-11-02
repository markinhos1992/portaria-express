-- Portaria Express: base multitenant para Supabase Auth + RLS.
-- Aplique primeiro em um projeto de homologação e revise a política com dados de teste.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.portaria_condominios (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 160),
  criado_em timestamptz not null default now()
);

create table if not exists public.portaria_membros (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.portaria_condominios(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 2 and 160),
  perfil text not null check (perfil in ('admin','porteiro')),
  criado_em timestamptz not null default now(),
  unique (condominio_id, usuario_id)
);

create table if not exists public.portaria_convites (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.portaria_condominios(id) on delete cascade,
  email text not null,
  perfil text not null check (perfil in ('admin','porteiro')),
  token_hash text not null unique,
  criado_por uuid not null references auth.users(id),
  expira_em timestamptz not null default now() + interval '7 days',
  usado_em timestamptz,
  criado_em timestamptz not null default now()
);

create table if not exists public.portaria_moradores (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.portaria_condominios(id) on delete cascade,
  nome text not null,
  bloco text not null,
  apartamento text not null,
  telefone text not null default '',
  whatsapp text not null default '',
  obs text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (condominio_id, bloco, apartamento, nome)
);

create table if not exists public.portaria_encomendas (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.portaria_condominios(id) on delete cascade,
  protocolo text not null,
  morador text not null,
  apartamento text not null default '',
  bloco text not null default '',
  telefone text not null default '',
  transportadora text not null default '',
  rastreio text not null default '',
  remetente text not null default '',
  status text not null default 'pendente' check (status in ('pendente','retirada')),
  criado_por text not null,
  criado_em timestamptz not null default now(),
  retirado_em timestamptz,
  retirado_por text,
  comprovante_path text,
  arquivado_em timestamptz,
  arquivado_por uuid references auth.users(id) on delete set null,
  unique (condominio_id, protocolo)
);

create table if not exists public.portaria_auditoria (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references public.portaria_condominios(id) on delete cascade,
  usuario_id uuid references auth.users(id) on delete set null,
  acao text not null,
  protocolo text not null default '',
  usuario text not null,
  data timestamptz not null default now()
);

create index if not exists portaria_moradores_condominio_idx on public.portaria_moradores(condominio_id);
create index if not exists portaria_encomendas_condominio_criado_idx on public.portaria_encomendas(condominio_id, criado_em desc);
create index if not exists portaria_encomendas_condominio_status_idx on public.portaria_encomendas(condominio_id, status);
create index if not exists portaria_auditoria_condominio_data_idx on public.portaria_auditoria(condominio_id, data desc);
create index if not exists portaria_convites_condominio_email_idx on public.portaria_convites(condominio_id, email);

-- Um membro de vários condomínios não pode mover registros entre eles pela API.
create or replace function public.portaria_impedir_mudanca_condominio()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.condominio_id is distinct from old.condominio_id then
    raise exception using errcode='42501', message='O condomínio de um registro não pode ser alterado';
  end if;
  return new;
end;
$$;
drop trigger if exists portaria_encomendas_condominio_immutavel on public.portaria_encomendas;
create trigger portaria_encomendas_condominio_immutavel before update on public.portaria_encomendas
for each row execute function public.portaria_impedir_mudanca_condominio();
drop trigger if exists portaria_moradores_condominio_immutavel on public.portaria_moradores;
create trigger portaria_moradores_condominio_immutavel before update on public.portaria_moradores
for each row execute function public.portaria_impedir_mudanca_condominio();

-- Ativa INSERT/UPDATE em tempo real para as três tabelas exibidas no painel.
-- Não publica portaria_membros nem habilita eventos DELETE.
do $$
declare v_table text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['portaria_moradores','portaria_encomendas','portaria_auditoria'] loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication %I add table public.%I','supabase_realtime',v_table);
      end if;
    end loop;
  end if;
end;
$$;

create or replace function public.portaria_e_membro(p_condominio uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$ select exists (
  select 1 from public.portaria_membros m
  where m.condominio_id = p_condominio and m.usuario_id = auth.uid()
) $$;

create or replace function public.portaria_e_admin(p_condominio uuid)
returns boolean language sql stable security definer set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$ select exists (
  select 1 from public.portaria_membros m
  where m.condominio_id = p_condominio and m.usuario_id = auth.uid() and m.perfil = 'admin'
) $$;

create or replace function public.portaria_criar_condominio(p_nome text, p_nome_usuario text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare v_condominio uuid;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 or length(trim(coalesce(p_nome_usuario,''))) < 2 then
    raise exception 'Informe o nome do condomínio e do responsável';
  end if;
  insert into public.portaria_condominios(nome) values (trim(p_nome)) returning id into v_condominio;
  insert into public.portaria_membros(condominio_id, usuario_id, nome, perfil)
  values (v_condominio, auth.uid(), trim(p_nome_usuario), 'admin');
  return v_condominio;
end;
$$;

create or replace function public.portaria_criar_convite(p_condominio uuid, p_email text, p_perfil text default 'porteiro')
returns text language plpgsql security definer set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare v_token text; v_email text;
begin
  if auth.uid() is null or not public.portaria_e_admin(p_condominio) then raise exception 'Apenas administradores podem convidar usuários'; end if;
  v_email := lower(trim(coalesce(p_email,'')));
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'E-mail inválido'; end if;
  if p_perfil not in ('admin','porteiro') then raise exception 'Perfil inválido'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.portaria_convites(condominio_id,email,perfil,token_hash,criado_por)
  values (p_condominio,v_email,p_perfil,encode(extensions.digest(v_token,'sha256'),'hex'),auth.uid());
  return v_token;
end;
$$;

create or replace function public.portaria_aceitar_convite(p_token text, p_nome text)
returns uuid language plpgsql security definer set search_path = pg_catalog, public, auth, extensions, pg_temp
as $$
declare v_convite public.portaria_convites%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'Entre com sua conta antes de aceitar o convite'; end if;
  v_email := lower(coalesce(auth.jwt()->>'email',''));
  select * into v_convite from public.portaria_convites
  where token_hash = encode(extensions.digest(coalesce(p_token,''),'sha256'),'hex')
    and email = v_email and usado_em is null and expira_em > now()
  for update;
  if not found then raise exception 'Convite inválido, vencido ou destinado a outro e-mail'; end if;
  if length(trim(coalesce(p_nome,''))) < 2 then raise exception 'Informe seu nome'; end if;
  insert into public.portaria_membros(condominio_id,usuario_id,nome,perfil)
  values (v_convite.condominio_id,auth.uid(),trim(p_nome),v_convite.perfil)
  on conflict (condominio_id,usuario_id) do nothing;
  update public.portaria_convites set usado_em = now() where id = v_convite.id;
  return v_convite.condominio_id;
end;
$$;

alter table public.portaria_condominios enable row level security;
alter table public.portaria_membros enable row level security;
alter table public.portaria_convites enable row level security;
alter table public.portaria_moradores enable row level security;
alter table public.portaria_encomendas enable row level security;
alter table public.portaria_auditoria enable row level security;

revoke all on public.portaria_convites from anon, authenticated;
grant select, delete on public.portaria_membros to authenticated;
grant select on public.portaria_condominios to authenticated;
grant select, insert, update, delete on public.portaria_moradores to authenticated;
grant select, insert, update on public.portaria_encomendas to authenticated;
revoke delete on public.portaria_encomendas from anon, authenticated;
grant select, insert on public.portaria_auditoria to authenticated;
revoke all on function public.portaria_e_membro(uuid), public.portaria_e_admin(uuid) from public, anon;
revoke all on function public.portaria_criar_condominio(text,text), public.portaria_criar_convite(uuid,text,text), public.portaria_aceitar_convite(text,text) from public, anon;
grant execute on function public.portaria_e_membro(uuid), public.portaria_e_admin(uuid) to authenticated;
grant execute on function public.portaria_criar_condominio(text,text), public.portaria_criar_convite(uuid,text,text), public.portaria_aceitar_convite(text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('portaria-comprovantes','portaria-comprovantes',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists portaria_comprovantes_leitura_membro on storage.objects;
create policy portaria_comprovantes_leitura_membro on storage.objects for select to authenticated
using (bucket_id='portaria-comprovantes' and public.portaria_e_membro((storage.foldername(name))[1]::uuid));
drop policy if exists portaria_comprovantes_insercao_membro on storage.objects;
create policy portaria_comprovantes_insercao_membro on storage.objects for insert to authenticated
with check (bucket_id='portaria-comprovantes' and public.portaria_e_membro((storage.foldername(name))[1]::uuid));
drop policy if exists portaria_comprovantes_exclusao_autor on storage.objects;
create policy portaria_comprovantes_exclusao_autor on storage.objects for delete to authenticated
using (bucket_id='portaria-comprovantes' and owner_id=(select auth.uid()::text) and public.portaria_e_membro((storage.foldername(name))[1]::uuid));

drop policy if exists portaria_condominios_leitura_membro on public.portaria_condominios;
create policy portaria_condominios_leitura_membro on public.portaria_condominios for select to authenticated using (public.portaria_e_membro(id));

drop policy if exists portaria_membros_leitura on public.portaria_membros;
create policy portaria_membros_leitura on public.portaria_membros for select to authenticated using (usuario_id = auth.uid() or public.portaria_e_admin(condominio_id));
drop policy if exists portaria_membros_admin_delete on public.portaria_membros;
create policy portaria_membros_admin_delete on public.portaria_membros for delete to authenticated using (public.portaria_e_admin(condominio_id) and usuario_id <> auth.uid());

drop policy if exists portaria_moradores_leitura_membro on public.portaria_moradores;
create policy portaria_moradores_leitura_membro on public.portaria_moradores for select to authenticated
using (public.portaria_e_membro(condominio_id));
drop policy if exists portaria_moradores_edicao_admin on public.portaria_moradores;
create policy portaria_moradores_edicao_admin on public.portaria_moradores for all to authenticated
using (public.portaria_e_admin(condominio_id)) with check (public.portaria_e_admin(condominio_id));

drop policy if exists portaria_encomendas_membro on public.portaria_encomendas;
drop policy if exists portaria_encomendas_leitura_membro on public.portaria_encomendas;
create policy portaria_encomendas_leitura_membro on public.portaria_encomendas for select to authenticated
using (public.portaria_e_membro(condominio_id));
drop policy if exists portaria_encomendas_insercao_membro on public.portaria_encomendas;
create policy portaria_encomendas_insercao_membro on public.portaria_encomendas for insert to authenticated
with check (public.portaria_e_membro(condominio_id));
drop policy if exists portaria_encomendas_atualizacao_membro on public.portaria_encomendas;
create policy portaria_encomendas_atualizacao_membro on public.portaria_encomendas for update to authenticated
using (public.portaria_e_membro(condominio_id)) with check (public.portaria_e_membro(condominio_id));

drop policy if exists portaria_auditoria_leitura_membro on public.portaria_auditoria;
create policy portaria_auditoria_leitura_membro on public.portaria_auditoria for select to authenticated
using (public.portaria_e_membro(condominio_id));
drop policy if exists portaria_auditoria_insercao_membro on public.portaria_auditoria;
create policy portaria_auditoria_insercao_membro on public.portaria_auditoria for insert to authenticated
with check (public.portaria_e_membro(condominio_id) and usuario_id = auth.uid());

