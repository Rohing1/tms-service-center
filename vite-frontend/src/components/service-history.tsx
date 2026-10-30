import { Card, CardBody } from '@heroui/card';
import { Chip } from '@heroui/chip';
import type { ActionRecord } from '@/api/service-center';
import { fmtDate, lineName, statusLabel } from '@/api/service-center';

function snapshot(raw?:string) {
  try {
    const s=JSON.parse(raw||'{}');
    if(!('quotaGb' in s)) return '尚无线路';
    return `${s.quotaGb>0?s.quotaGb+' GB':'不单独限额'} / ${fmtDate(s.expTime)}`;
  } catch { return '记录不可用'; }
}
export default function ServiceHistory({rows,admin=false}:{rows:ActionRecord[];admin?:boolean}) {
  return <div className="space-y-3">{!rows.length&&<p className="text-default-500 text-center py-8">暂无操作记录</p>}{rows.map(r=><Card key={r.id}><CardBody className="space-y-2 text-sm">
    <div className="flex gap-2 flex-wrap items-center"><Chip size="sm" color={r.status==='completed'?'success':r.status==='partial'?'warning':'default'} variant="flat">{statusLabel(r.status)}</Chip><b>{r.actionType==='assign'?'套餐分配':'人工续期'}</b>{admin&&<span>{r.userName||`用户 #${r.userId}`}</span>}<span className="text-default-500">{lineName(r)}</span><span className="ml-auto text-xs text-default-400">{fmtDate(r.createdAt)}</span></div>
    {r.planName&&<p>套餐：{r.planName}</p>}<p className="text-default-600">{r.message||'操作正在处理，结果将保存在此处'}</p>
    {r.beforeJson&&<div className="text-xs text-default-500 space-y-1"><p>变更前：{snapshot(r.beforeJson)}</p><p>变更后：{r.afterJson?snapshot(r.afterJson):'等待结果'}</p></div>}
    {admin&&<p className="text-xs text-default-400">操作人：{r.actorName||'未知'}{r.note&&` · 备注：${r.note}`} · 记录 #{r.id}</p>}
  </CardBody></Card>)}</div>;
}
