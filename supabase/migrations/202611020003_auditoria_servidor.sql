-- A auditoria das operações deixa de depender do navegador.
create or replace function public.portaria_auditar_operacao()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare v_row jsonb;v_nome text;v_acao text;v_condo uuid;
begin
  if tg_op='DELETE' then v_row:=to_jsonb(old);else v_row:=to_jsonb(new);end if;
  v_condo:=(v_row->>'condominio_id')::uuid;
  select nome into v_nome from public.portaria_membros where condominio_id=v_condo and usuario_id=auth.uid();
  if tg_table_name='portaria_encomendas' then
    if tg_op='INSERT' then v_acao:='Encomenda criada';
    elsif new.status is distinct from old.status then v_acao:='Retirada confirmada';
    elsif new.arquivado_em is distinct from old.arquivado_em then v_acao:='Encomenda arquivada';
    else v_acao:='Encomenda atualizada';end if;
  else v_acao:=case tg_op when 'INSERT' then 'Morador cadastrado' when 'UPDATE' then 'Morador atualizado' else 'Morador excluído' end;end if;
  insert into public.portaria_auditoria(condominio_id,usuario_id,acao,protocolo,usuario,data)
  values(v_condo,auth.uid(),v_acao,coalesce(v_row->>'protocolo',''),coalesce(v_nome,'Manutenção do banco'),clock_timestamp());
  if tg_op='DELETE' then return old;end if;return new;
end;
$$;
revoke all on function public.portaria_auditar_operacao() from public,anon,authenticated;
drop trigger if exists portaria_encomendas_auditoria_servidor on public.portaria_encomendas;
create trigger portaria_encomendas_auditoria_servidor after insert or update on public.portaria_encomendas for each row execute function public.portaria_auditar_operacao();
drop trigger if exists portaria_moradores_auditoria_servidor on public.portaria_moradores;
create trigger portaria_moradores_auditoria_servidor after insert or update or delete on public.portaria_moradores for each row execute function public.portaria_auditar_operacao();
revoke insert on public.portaria_auditoria from authenticated;
