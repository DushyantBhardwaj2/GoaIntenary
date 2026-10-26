// Draft display only. Stored shares and balances always come from the core API.
export function equalSplitPreview(amount:number,ids:string[]):{participantId:string;amountPaise:number}[] {
  if(!Number.isSafeInteger(amount)||amount<1||!ids.length||ids.length>50||new Set(ids).size!==ids.length) return [];
  const count=BigInt(ids.length),total=BigInt(amount);
  return [...ids].sort().map((participantId,index)=>({participantId,amountPaise:Number(total/count+(BigInt(index)<total%count?1n:0n))}));
}
