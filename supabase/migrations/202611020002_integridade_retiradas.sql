-- Proteção de integridade complementar ao isolamento por condomínio.
create or replace function public.portaria_validar_encomenda()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth, storage, pg_temp
as $$
declare v_nome text;
begin
  select nome into v_nome from public.portaria_membros
  where usuario_id=auth.uid() and condominio_id=new.condominio_id;
  if v_nome is null then raise exception using errcode='42501', message='Acesso ao condomínio não confirmado'; end if;
  if tg_op='INSERT' then
    if new.status<>'pendente' or new.retirado_em is not null or new.retirado_por is not null or new.comprovante_path is not null or new.arquivado_em is not null or new.arquivado_por is not null then
      raise exception 'Uma encomenda nova deve estar pendente e sem retirada ou arquivamento';
    end if;
    new.criado_por:=v_nome; new.criado_em:=now();
  else
    if new.id is distinct from old.id or new.condominio_id is distinct from old.condominio_id or new.protocolo is distinct from old.protocolo or new.criado_em is distinct from old.criado_em or new.criado_por is distinct from old.criado_por then
      raise exception 'Identificação e recebimento da encomenda não podem ser alterados';
    end if;
    if old.status='retirada' and (to_jsonb(new)-array['arquivado_em','arquivado_por']) is distinct from (to_jsonb(old)-array['arquivado_em','arquivado_por']) then
      raise exception 'Retirada confirmada não pode ser modificada';
    end if;
    if old.arquivado_em is not null and (new.arquivado_em is distinct from old.arquivado_em or new.arquivado_por is distinct from old.arquivado_por) then
      raise exception 'Arquivamento já confirmado não pode ser alterado';
    end if;
    if old.status='pendente' and new.status='retirada' then
      if new.comprovante_path is null or new.comprovante_path not like new.condominio_id::text||'/'||new.id::text||'/%' or not exists (
        select 1 from storage.objects where bucket_id='portaria-comprovantes' and name=new.comprovante_path and owner_id=auth.uid()::text
      ) then raise exception 'Envie um comprovante válido para esta encomenda antes da retirada'; end if;
      new.retirado_em:=now();new.retirado_por:=v_nome;
    elsif new.status='pendente' and (new.retirado_em is not null or new.retirado_por is not null or new.comprovante_path is not null) then
      raise exception 'Encomenda pendente não pode conter confirmação de retirada';
    end if;
    if old.arquivado_em is null and new.arquivado_em is not null then
      new.arquivado_em:=now();new.arquivado_por:=auth.uid();
    end if;
  end if;
  if length(trim(new.morador)) not between 1 and 200 or length(new.bloco)>100 or length(new.apartamento)>100 or length(new.rastreio)>200 then raise exception 'Dados de encomenda inválidos ou muito longos'; end if;
  return new;
end;
$$;
revoke all on function public.portaria_validar_encomenda() from public,anon,authenticated;
drop trigger if exists portaria_encomendas_integridade on public.portaria_encomendas;
create trigger portaria_encomendas_integridade before insert or update on public.portaria_encomendas
for each row execute function public.portaria_validar_encomenda();

-- Apenas uploads não vinculados podem ser removidos pelo autor (limpeza de falhas).
alter policy portaria_comprovantes_exclusao_autor on storage.objects
using (bucket_id='portaria-comprovantes' and owner_id=auth.uid()::text
  and exists(select 1 from public.portaria_membros m where m.usuario_id=auth.uid() and m.condominio_id::text=split_part(name,'/',1))
  and not exists(select 1 from public.portaria_encomendas e where e.comprovante_path=name));
