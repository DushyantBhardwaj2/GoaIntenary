import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { allocateShares, exactTotal, safeNumber } from './money.js';
import { hash, TripRepository } from './repository.js';
import type { Expense, ExpenseInput, ExpenseParticipant, ExpenseShare, ExpenseSplit, Ledger, PersonBalance, Repayment, RepaymentInput, Role } from './types.js';
import { isCalendarDate } from './validation.js';

type ExpenseRow = Omit<Expense,'amountPaise'|'createdAt'|'shares'> & { amountPaise: string | number; createdAt: string | Date; deletedAt: Date | null };
type RepaymentRow = Omit<Repayment,'amountPaise'|'createdAt'> & { amountPaise: string | number; createdAt: string | Date; deletedAt: Date | null };
const conflict = (message: string) => new ApiError(409,'CONFLICT',message);
const denied = () => new ApiError(403,'FORBIDDEN','Only the organiser or this record’s creator can do that.');
const expenseSelect = `SELECT e.id,e.trip_id AS "tripId",e.title,e.amount_paise AS "amountPaise",e.category,e.date::text,
 e.paid_by_user_id AS "paidByUserId",e.paid_by_participant_id AS "paidByParticipantId",COALESCE(p.display_name,ep.display_name) AS "paidByDisplayName",
 e.created_by AS "createdBy",e.created_at AS "createdAt",e.version,e.split_mode AS "splitMode",e.deleted_at AS "deletedAt"
 FROM goa_core_expenses e JOIN goa_core_expense_participants ep ON ep.trip_id=e.trip_id AND ep.id=e.paid_by_participant_id
 LEFT JOIN goa_core_profiles p ON p.id=ep.user_id`;
const repaymentSelect = `SELECT id,from_participant_id AS "fromParticipantId",to_participant_id AS "toParticipantId",amount_paise AS "amountPaise",
 date::text,note,created_by AS "createdBy",created_at AS "createdAt",deleted_at AS "deletedAt" FROM goa_core_repayments`;

export class LedgerRepository {
  constructor(private readonly core: TripRepository) {}

  private async participants(client: SqlClient, tripId: string): Promise<ExpenseParticipant[]> {
    // Only real accepted/historical memberships become member ledger identities.
    // A guest never enters the profile, membership or authentication tables.
    await client.query(`INSERT INTO goa_core_expense_participants (trip_id,id,user_id,display_name,created_by)
      SELECT m.trip_id,m.user_id,m.user_id,left(p.display_name,80),t.created_by FROM goa_core_memberships m
      JOIN goa_core_profiles p ON p.id=m.user_id JOIN goa_core_trips t ON t.id=m.trip_id
      WHERE m.trip_id=$1 AND m.status IN ('accepted','removed') ON CONFLICT DO NOTHING`,[tripId]);
    return client.query<ExpenseParticipant>(`SELECT ep.id,ep.user_id AS "userId",COALESCE(p.display_name,ep.display_name) AS "displayName",
      CASE WHEN ep.user_id IS NULL THEN 'guest' ELSE 'member' END AS kind,
      CASE WHEN ep.user_id IS NULL THEN ep.archived_at IS NULL ELSE m.status='accepted' END AS active
      FROM goa_core_expense_participants ep LEFT JOIN goa_core_profiles p ON p.id=ep.user_id
      LEFT JOIN goa_core_memberships m ON m.trip_id=ep.trip_id AND m.user_id=ep.user_id
      WHERE ep.trip_id=$1 ORDER BY ep.created_at,ep.id`,[tripId]);
  }
  async listParticipants(actor: string, tripId: string): Promise<ExpenseParticipant[]> {
    return this.core.database.transaction(async client => { await this.core.membership(client,actor,tripId); return this.participants(client,tripId); });
  }
  private async retry(client: SqlClient, actor: string, tripId: string, scope: string, key: string | undefined, input: unknown, legacyHash?: string): Promise<string | undefined> {
    if (!key) return;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[actor,tripId,scope,key,digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`,[actor,tripId,scope,key]);
    if (row!.request_hash !== digest && row!.request_hash !== legacyHash) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }
  private async finish(client: SqlClient, actor: string, tripId: string, scope: string, key: string | undefined, id: string) {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`,[actor,tripId,scope,key,id]);
  }
  async addGuest(actor: string, tripId: string, displayName: string, key?: string): Promise<ExpenseParticipant> {
    return this.core.database.transaction(async client => {
      await this.core.membership(client,actor,tripId,true);
      const name = displayName.trim();
      if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) throw invalid('Use a guest name from 1 to 80 characters.');
      const people = await this.participants(client,tripId);
      const prior = await this.retry(client,actor,tripId,'guest',key,{ displayName: name });
      if (prior) return people.find(person => person.id===prior)!;
      if (people.filter(person => person.active).length >= 50) throw conflict('This trip already has fifty active expense travellers.');
      if (people.some(person => person.active && person.displayName.toLowerCase()===name.toLowerCase())) throw conflict('That name is already in this trip. Use a distinct guest name.');
      const id = randomUUID();
      await client.query('INSERT INTO goa_core_expense_participants (trip_id,id,display_name,created_by) VALUES ($1,$2,$3,$4)',[tripId,id,name,actor]);
      await this.finish(client,actor,tripId,'guest',key,id);
      await this.core.audit(client,actor,tripId,'guest.created',id);
      return { id,userId: null,displayName: name,kind: 'guest',active: true };
    });
  }
  async archiveGuest(actor: string, tripId: string, id: string): Promise<void> {
    return this.core.database.transaction(async client => {
      await this.core.membership(client,actor,tripId,true);
      const [guest] = await client.query<{ user_id: string | null; archived_at: Date | null }>('SELECT user_id,archived_at FROM goa_core_expense_participants WHERE trip_id=$1 AND id=$2',[tripId,id]);
      if (!guest) throw notFound();
      if (guest.user_id) throw invalid('Manage joined members from People. Only guests can be archived here.');
      if (guest.archived_at) return;
      await client.query('UPDATE goa_core_expense_participants SET archived_at=now() WHERE trip_id=$1 AND id=$2',[tripId,id]);
      await this.core.audit(client,actor,tripId,'guest.archived',id);
    });
  }
  private async shares(client: SqlClient, tripId: string, id: string): Promise<ExpenseShare[]> {
    const rows = await client.query<ExpenseShare>(`SELECT s.participant_id AS "participantId",COALESCE(p.display_name,ep.display_name) AS "displayName",s.amount_paise AS "amountPaise"
      FROM goa_core_expense_shares s JOIN goa_core_expense_participants ep ON ep.trip_id=s.trip_id AND ep.id=s.participant_id
      LEFT JOIN goa_core_profiles p ON p.id=ep.user_id WHERE s.trip_id=$1 AND s.expense_id=$2 ORDER BY s.participant_id`,[tripId,id]);
    return rows.map(row => ({ ...row,amountPaise: Number(row.amountPaise) }));
  }
  private async expense(client: SqlClient, tripId: string, id: string, includeDeleted=false): Promise<Expense & { deletedAt: Date | null }> {
    const [row] = await client.query<ExpenseRow>(`${expenseSelect} WHERE e.trip_id=$1 AND e.id=$2 AND ($3 OR e.deleted_at IS NULL)`,[tripId,id,includeDeleted]);
    if (!row) throw notFound();
    return { ...row,amountPaise: Number(row.amountPaise),createdAt: new Date(row.createdAt).toISOString(),shares: await this.shares(client,tripId,id) };
  }
  async expenses(client: SqlClient, tripId: string): Promise<Expense[]> {
    const rows = await client.query<{ id: string }>('SELECT id FROM goa_core_expenses WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY date DESC,created_at DESC,id',[tripId]);
    const expenses: Expense[] = [];
    for (const row of rows) { const { deletedAt: _,...expense } = await this.expense(client,tripId,row.id); expenses.push(expense); }
    return expenses;
  }
  private choose(people: ExpenseParticipant[], id: string, historical: string[]=[]): ExpenseParticipant {
    const person = people.find(person => person.id===id.toLowerCase());
    if (!person || (!person.active && !historical.includes(person.id))) throw invalid('Choose active travellers from this trip.');
    return person;
  }
  private async writeShares(client: SqlClient, tripId: string, id: string, shares: { participantId: string; amountPaise: number }[]) {
    await client.query('DELETE FROM goa_core_expense_shares WHERE expense_id=$1',[id]);
    for (const share of shares) await client.query('INSERT INTO goa_core_expense_shares (trip_id,expense_id,participant_id,amount_paise) VALUES ($1,$2,$3,$4)',[tripId,id,share.participantId,share.amountPaise]);
  }
  private async history(client: SqlClient, actor: string, tripId: string, id: string, operation: string) {
    const shares = await this.shares(client,tripId,id);
    await client.query(`INSERT INTO goa_core_expense_history (id,expense_id,version,actor_id,operation,title,amount_paise,category,date,paid_by_user_id,paid_by_participant_id,split_mode,shares)
      SELECT $1,id,version,$2,$3,title,amount_paise,category,date,paid_by_user_id,paid_by_participant_id,split_mode,$5::jsonb FROM goa_core_expenses WHERE id=$4`,[randomUUID(),actor,operation,id,JSON.stringify(shares)]);
  }
  private payerId(input: Partial<ExpenseInput>, fallback: string): string {
    if (input.paidByParticipantId !== undefined && input.paidByUserId !== undefined) throw invalid('Choose one payer field.');
    return (input.paidByParticipantId ?? input.paidByUserId ?? fallback).toLowerCase();
  }
  async createExpense(actor: string, tripId: string, input: ExpenseInput, key?: string): Promise<Expense> {
    return this.core.database.transaction(async client => {
      await this.core.membership(client,actor,tripId);
      if (!input.title.trim() || !isCalendarDate(input.date)) throw invalid('Use a spending title and real date.');
      const payerId = this.payerId(input,actor), split = input.split ?? { mode: 'none' };
      const shares = allocateShares(input.amountPaise,split);
      const legacyHash=input.split===undefined && input.paidByParticipantId===undefined ? hash(JSON.stringify({title:input.title.trim(),amountPaise:input.amountPaise,category:input.category,date:input.date,paidByUserId:payerId})) : undefined;
      const prior = await this.retry(client,actor,tripId,'expense',key,{ title: input.title.trim(),amountPaise: input.amountPaise,category: input.category,date: input.date,paidByParticipantId: payerId,splitMode: split.mode,shares },legacyHash);
      if (prior) { const { deletedAt: _,...expense }=await this.expense(client,tripId,prior); return expense; }
      const people = await this.participants(client,tripId), payer = this.choose(people,payerId);
      if(input.paidByUserId!==undefined && !payer.userId)throw invalid('Choose a joined member for paidByUserId, or use a guest participant.');
      shares.forEach(share => this.choose(people,share.participantId));
      const id=randomUUID();
      await client.query(`INSERT INTO goa_core_expenses (id,trip_id,title,amount_paise,category,date,paid_by_user_id,paid_by_participant_id,split_mode,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,tripId,input.title.trim(),input.amountPaise,input.category,input.date,payer.userId,payer.id,split.mode,actor]);
      await this.writeShares(client,tripId,id,shares); await this.finish(client,actor,tripId,'expense',key,id);
      await this.history(client,actor,tripId,id,'created'); await this.core.audit(client,actor,tripId,'expense.created',id);
      const { deletedAt: _,...expense }=await this.expense(client,tripId,id); return expense;
    });
  }
  private async correction(client: SqlClient, tripId: string, role: Role, acknowledged: boolean) {
    const rows=await client.query('SELECT id FROM goa_core_repayments WHERE trip_id=$1 AND deleted_at IS NULL LIMIT 1',[tripId]);
    if (rows.length && (role!=='organiser' || !acknowledged)) throw conflict('Repayments are recorded. Ask the organiser to confirm this correction; existing repayments will remain.');
  }
  async updateExpense(actor: string, tripId: string, id: string, patch: Partial<ExpenseInput> & { version: number }): Promise<Expense> {
    return this.core.database.transaction(async client => {
      const role=await this.core.membership(client,actor,tripId), current=await this.expense(client,tripId,id);
      if (role!=='organiser' && current.createdBy!==actor) throw denied();
      if (current.version!==patch.version) throw conflict('This spending record changed. Reload it before saving.');
      await this.correction(client,tripId,role,patch.acknowledgeSettlementChange===true);
      const next={ ...current,...patch };
      if (!next.title.trim() || !isCalendarDate(next.date)) throw invalid('Use a spending title and real date.');
      if (patch.amountPaise!==undefined && patch.amountPaise!==current.amountPaise && current.splitMode!=='none' && !patch.split) throw invalid('Supply revised shares when changing a split amount.');
      const split: ExpenseSplit = patch.split ?? (current.splitMode==='none' ? { mode: 'none' } : current.splitMode==='equal' ? { mode: 'equal',participantIds: current.shares.map(s=>s.participantId) } : { mode: 'custom',shares: current.shares });
      const shares=allocateShares(next.amountPaise,split), people=await this.participants(client,tripId);
      const payer=this.choose(people,this.payerId(patch,current.paidByParticipantId),[current.paidByParticipantId]);
      if(patch.paidByUserId!==undefined && !payer.userId)throw invalid('Choose a joined member for paidByUserId, or use a guest participant.');
      shares.forEach(share=>this.choose(people,share.participantId,current.shares.map(s=>s.participantId)));
      await client.query(`UPDATE goa_core_expenses SET title=$3,amount_paise=$4,category=$5,date=$6,paid_by_user_id=$7,paid_by_participant_id=$8,split_mode=$9,
        version=version+1,updated_at=now() WHERE trip_id=$1 AND id=$2`,[tripId,id,next.title.trim(),next.amountPaise,next.category,next.date,payer.userId,payer.id,split.mode]);
      await this.writeShares(client,tripId,id,shares); await this.history(client,actor,tripId,id,'updated'); await this.core.audit(client,actor,tripId,'expense.updated',id);
      const { deletedAt: _,...expense }=await this.expense(client,tripId,id); return expense;
    });
  }
  async deleteExpense(actor: string, tripId: string, id: string, acknowledged=false): Promise<void> {
    return this.core.database.transaction(async client => {
      const role=await this.core.membership(client,actor,tripId), current=await this.expense(client,tripId,id,true);
      if (role!=='organiser' && current.createdBy!==actor) throw denied();
      if (current.deletedAt) return;
      await this.correction(client,tripId,role,acknowledged);
      await client.query('UPDATE goa_core_expenses SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1',[id]);
      await this.history(client,actor,tripId,id,'deleted'); await this.core.audit(client,actor,tripId,'expense.deleted',id);
    });
  }
  private async repayments(client: SqlClient, tripId: string): Promise<Repayment[]> {
    return (await client.query<RepaymentRow>(`${repaymentSelect} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`,[tripId])).map(({deletedAt: _,...row})=>({ ...row,amountPaise: Number(row.amountPaise),createdAt: new Date(row.createdAt).toISOString() }));
  }
  private async ledger(client: SqlClient, tripId: string): Promise<Ledger> {
    const participants=await this.participants(client,tripId), expenses=await this.expenses(client,tripId), repayments=await this.repayments(client,tripId);
    const balances: PersonBalance[]=participants.map(person=>{
      const paidPaise=exactTotal(expenses.filter(e=>e.splitMode!=='none' && e.paidByParticipantId===person.id).map(e=>e.amountPaise));
      const sharePaise=exactTotal(expenses.flatMap(e=>e.shares).filter(s=>s.participantId===person.id).map(s=>s.amountPaise));
      const sentPaise=exactTotal(repayments.filter(r=>r.fromParticipantId===person.id).map(r=>r.amountPaise));
      const receivedPaise=exactTotal(repayments.filter(r=>r.toParticipantId===person.id).map(r=>r.amountPaise));
      return { participantId: person.id,displayName: person.displayName,paidPaise,sharePaise,sentPaise,receivedPaise,balancePaise: safeNumber(BigInt(paidPaise)-BigInt(sharePaise)+BigInt(sentPaise)-BigInt(receivedPaise)) };
    });
    if (exactTotal(balances.map(b=>b.balancePaise))!==0) throw conflict('The ledger needs reconciliation.');
    const debtors=balances.filter(b=>b.balancePaise<0).map(b=>({id:b.participantId,left:-b.balancePaise})).sort((a,b)=>a.id.localeCompare(b.id));
    const creditors=balances.filter(b=>b.balancePaise>0).map(b=>({id:b.participantId,left:b.balancePaise})).sort((a,b)=>a.id.localeCompare(b.id));
    const settlements: Ledger['settlements']=[]; let d=0,c=0;
    while(d<debtors.length && c<creditors.length) { const from=debtors[d]!,to=creditors[c]!,amountPaise=Math.min(from.left,to.left); settlements.push({fromParticipantId:from.id,toParticipantId:to.id,amountPaise}); from.left-=amountPaise;to.left-=amountPaise; if(!from.left)d++;if(!to.left)c++; }
    return { participants,balances,settlements,repayments,unallocatedTotalPaise:exactTotal(expenses.filter(e=>e.splitMode==='none').map(e=>e.amountPaise)) };
  }
  async getLedger(actor: string, tripId: string): Promise<Ledger> { return this.core.database.transaction(async client=>{await this.core.membership(client,actor,tripId);return this.ledger(client,tripId);}); }
  async createRepayment(actor: string, tripId: string, input: RepaymentInput, key?: string): Promise<Repayment> {
    return this.core.database.transaction(async client=>{
      const role=await this.core.membership(client,actor,tripId);
      if (!Number.isSafeInteger(input.amountPaise)||input.amountPaise<1||input.amountPaise>1_000_000_000||!isCalendarDate(input.date)||input.fromParticipantId.toLowerCase()===input.toParticipantId.toLowerCase()) throw invalid('Use two different travellers, a positive amount and real date.');
      const normalized={...input,fromParticipantId:input.fromParticipantId.toLowerCase(),toParticipantId:input.toParticipantId.toLowerCase(),note:input.note?.trim()??''};
      input=normalized;
      const prior=await this.retry(client,actor,tripId,'repayment',key,normalized);
      if(prior) {const row=(await this.repayments(client,tripId)).find(r=>r.id===prior);if(!row)throw conflict('That repayment was removed.');return row;}
      const ledger=await this.ledger(client,tripId);
      if(!ledger.participants.some(p=>p.id===input.fromParticipantId)||!ledger.participants.some(p=>p.id===input.toParticipantId))throw invalid('Choose travellers from this trip.');
      if(role!=='organiser'&&input.fromParticipantId!==actor)throw denied();
      const from=ledger.balances.find(b=>b.participantId===input.fromParticipantId)!,to=ledger.balances.find(b=>b.participantId===input.toParticipantId)!;
      if(input.amountPaise>Math.min(-from.balancePaise,to.balancePaise))throw invalid('The repayment exceeds the outstanding balance between these travellers.');
      const id=randomUUID();
      await client.query(`INSERT INTO goa_core_repayments (id,trip_id,from_participant_id,to_participant_id,amount_paise,date,note,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,tripId,input.fromParticipantId,input.toParticipantId,input.amountPaise,input.date,normalized.note,actor]);
      await this.finish(client,actor,tripId,'repayment',key,id);await this.core.audit(client,actor,tripId,'repayment.created',id);
      return (await this.repayments(client,tripId)).find(r=>r.id===id)!;
    });
  }
  async deleteRepayment(actor: string, tripId: string, id: string): Promise<void> {
    return this.core.database.transaction(async client=>{
      const role=await this.core.membership(client,actor,tripId);
      const [row]=await client.query<RepaymentRow>(`${repaymentSelect} WHERE trip_id=$1 AND id=$2`,[tripId,id]);
      if(!row)throw notFound();if(role!=='organiser'&&row.createdBy!==actor)throw denied();if(row.deletedAt)return;
      await client.query('UPDATE goa_core_repayments SET deleted_at=now() WHERE id=$1',[id]);await this.core.audit(client,actor,tripId,'repayment.deleted',id);
    });
  }
}
