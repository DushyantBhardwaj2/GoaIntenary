"use client";
import { useRef,useState,type FormEvent } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { api,core,expenseCategories,type Expense,type ExpenseCategory,type ExpenseParticipant,type Trip } from '@/lib/client';
import { amountInput,money,parseINR } from '@/lib/money';
import { equalSplitPreview } from '@/lib/split-preview';
import { useSession } from './session';
import { Busy,Dialog,Notice } from './ui';
import styles from './expense-workspace.module.css';

export function ExpenseForm({trip,participants,expense,hasRepayments,onClose,onSaved}:{trip:Trip;participants:ExpenseParticipant[];expense?:Expense;hasRepayments:boolean;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const {user}=useSession();
  const [title,setTitle]=useState(expense?.title??''),[amount,setAmount]=useState(amountInput(expense?.amountPaise)),[category,setCategory]=useState<ExpenseCategory>(expense?.category??'other'),[date,setDate]=useState(expense?.date??trip.startDate),[payer,setPayer]=useState(expense?.paidByParticipantId??user?.id??'');
  const [mode,setMode]=useState<'equal'|'custom'|'none'>(expense?.splitMode??'equal');
  const [selected,setSelected]=useState<string[]>(expense?.shares.map(share=>share.participantId)??(user?[user.id]:[]));
  const [custom,setCustom]=useState<Record<string,string>>(Object.fromEntries(expense?.shares.map(share=>[share.participantId,amountInput(share.amountPaise)])??[]));
  const [acknowledged,setAcknowledged]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const attempt=useRef<{payload:string;key:string}|null>(null);
  const historical=new Set(expense?.shares.map(share=>share.participantId)??[]);
  const choices=participants.filter(person=>person.active||historical.has(person.id));
  const payers=participants.filter(person=>person.active||person.id===expense?.paidByParticipantId);
  let preview:{participantId:string;amountPaise:number}[]=[],previewMessage='Enter an amount and select the people who shared this bill.';
  try {
    const total=parseINR(amount,false);
    preview=mode==='equal'?equalSplitPreview(total,selected):mode==='custom'?selected.map(participantId=>({participantId,amountPaise:parseINR(custom[participantId]??'0')})):[];
    if(mode==='custom') {const sum=preview.reduce((value,share)=>value+BigInt(share.amountPaise),0n);previewMessage=sum===BigInt(total)?'Custom shares match the paid amount.':`${money(Number(BigInt(total)-sum))} still to allocate (a negative amount means too much).`;}
    else previewMessage=mode==='none'?'Recorded spending only. This bill will not affect anyone’s split balance.':!selected.length?'Select at least one person to share this bill.':`${selected.length} selected ${selected.length===1?'traveller':'travellers'} share ${money(total)}. Everyone else is excluded. Shares add up exactly, including any rounding.`;
  }catch{previewMessage=amount.trim()?'Use valid INR amounts with up to two decimal places.':'Enter the amount, then choose the people who shared this bill.';}
  function switchMode(value:'equal'|'custom'|'none') {
    if(value==='custom'&&mode==='equal'&&preview.length)setCustom(Object.fromEntries(preview.map(share=>[share.participantId,amountInput(share.amountPaise)])));
    setMode(value);
  }
  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const amountPaise=parseINR(amount,false);
      if(mode!=='none'&&!selected.length)throw new Error('Select at least one traveller sharing this bill.');
      const split=mode==='none'?{mode}:mode==='equal'?{mode,participantIds:selected}:{mode,shares:selected.map(participantId=>({participantId,amountPaise:parseINR(custom[participantId]??'0')}))};
      if(split.mode==='custom'&&split.shares!.reduce((value,share)=>value+BigInt(share.amountPaise),0n)!==BigInt(amountPaise))throw new Error('Custom shares must add up exactly to the paid amount.');
      const payload=JSON.stringify({title:title.trim(),amountPaise,category,date,paidByParticipantId:payer,split,...(expense?{version:expense.version,acknowledgeSettlementChange:acknowledged}:{})});
      if(!attempt.current||attempt.current.payload!==payload)attempt.current={payload,key:crypto.randomUUID()};
      await api(`${core}/trips/${trip.id}/expenses${expense?`/${expense.id}`:''}`,{method:expense?'PATCH':'POST',headers:expense?{}:{'Idempotency-Key':attempt.current.key},body:payload});await onSaved();onClose();
    }catch(err){setError(err instanceof Error?err.message:'Unable to save the expense.');}finally{setBusy(false);}
  }
  return <Dialog title={expense?'Edit expense':'Add an expense'} className={styles.financeDialog} onClose={onClose} busy={busy}><form className={`premium-form ${styles.financeForm}`} onSubmit={submit}>
    <p className="form-intro">One person paid. Choose exactly who shares the bill — two, four, or whoever was there.</p>
    <label>What was it for?<input autoFocus required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)} placeholder="Dinner for four by the sea"/></label>
    <div className="form-two"><label>Amount in INR<div className="money-input"><span>₹</span><input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="4000.00"/></div></label><label>Date paid<input required type="date" value={date} onChange={event=>setDate(event.target.value)}/></label></div>
    <div className="form-two"><label>Category<select value={category} onChange={event=>setCategory(event.target.value as ExpenseCategory)}>{expenseCategories.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label>Paid by<select required value={payer} onChange={event=>setPayer(event.target.value)}>{payers.map(person=><option key={person.id} value={person.id}>{person.displayName}{person.kind==='guest'?' (guest)':''}{!person.active?' (historical)':''}</option>)}</select></label></div>
    <div className={styles.splitModes} role="group" aria-label="How to split the expense">{([{value:'equal',label:'Split equally'},{value:'custom',label:'Custom amounts'},{value:'none',label:'Don’t split'}] as const).map(option=><button type="button" key={option.value} aria-pressed={mode===option.value} onClick={()=>switchMode(option.value)}>{option.label}</button>)}</div>
    {mode!=='none'&&<fieldset className={styles.splitFieldset}><legend>Who shared this bill? <span>{selected.length} of {choices.length} selected</span></legend><div className={styles.selectionHeading}><p>Only checked people get a share.</p><div><button type="button" className={styles.textButton} onClick={()=>setSelected(choices.map(person=>person.id))}>Select all</button><button type="button" className={styles.textButton} onClick={()=>setSelected([])}>Clear</button></div></div><div className={styles.splitPeople}>{choices.map(person=><div className={styles.splitPerson} data-selected={selected.includes(person.id)} key={person.id}><label><input type="checkbox" checked={selected.includes(person.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,person.id]:ids.filter(id=>id!==person.id))}/><span className={styles.splitIdentity}>{person.displayName}<small>{person.kind==='guest'?'Named guest':'Joined member'}{!person.active?' · historical':''}{person.id===payer?' · paid this bill':''}</small></span></label>{selected.includes(person.id)&&(mode==='custom'?<label className={styles.customShare}><span className={styles.srOnly}>Share in INR for {person.displayName}</span><input aria-label={`Share in INR for ${person.displayName}`} inputMode="decimal" value={custom[person.id]??''} placeholder="0.00" onChange={event=>setCustom(values=>({...values,[person.id]:event.target.value}))}/></label>:<strong>{money(preview.find(share=>share.participantId===person.id)?.amountPaise??0)}</strong>)}</div>)}</div></fieldset>}
    <p className={styles.splitPreview} aria-live="polite">{previewMessage}</p>
    {expense&&hasRepayments&&<div className="correction-note"><p>Repayments are already recorded. This organiser correction changes balances and keeps all repayment history.</p><label className={styles.confirmation}><input required type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>I confirm this correction with the group.</label></div>}
    {error&&<Notice>{error}</Notice>}<div className="dialog-actions"><button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy?<Busy text="Saving…"/>:<>Save expense<ArrowUpRight size={17}/></>}</button></div>
  </form></Dialog>;
}
