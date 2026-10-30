import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@heroui/button';
import { Card, CardBody } from '@heroui/card';
import { Chip } from '@heroui/chip';
import { Input } from '@heroui/input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/modal';
import { Spinner } from '@heroui/spinner';
import toast from 'react-hot-toast';
import ServiceHistory from '@/components/service-history';
import { loadPlans,savePlan,loadCatalog,assignPlan,renewService,loadServiceLines,loadRenewalRequests,rejectRenewal,loadServiceHistory,loadServiceReminders,lineKey,lineName,fmtDate,fmtGB,newOperationKey,statusLabel } from '@/api/service-center';
import type { ServicePlan,Catalog,ServiceLine,RenewalRequest,RenewPayload,ActionRecord } from '@/api/service-center';

const selectClass='w-full rounded-xl bg-default-100 p-3 text-sm text-foreground border border-divider';
const emptyPlan:ServicePlan={name:'',nodeId:0,landingId:null,quotaGb:100,durationDays:30,speedId:null,active:1,remark:''};
type BatchRow={userId:number;name:string;key:string;status:string;message:string};
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block space-y-2 text-sm"><span className="text-default-600">{label}</span>{children}</label>;}

export default function ServiceCenterPage(){
  const [params]=useSearchParams();
  const [tab,setTab]=useState(params.get('userId')?'renew':'plans');
  const [catalog,setCatalog]=useState<Catalog>({users:[],routes:[],speeds:[]});
  const [plans,setPlans]=useState<ServicePlan[]>([]);
  const [requests,setRequests]=useState<RenewalRequest[]>([]);
  const [reminders,setReminders]=useState<ServiceLine[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [editor,setEditor]=useState<ServicePlan|null>(null);
  const [saving,setSaving]=useState(false);
  const [planId,setPlanId]=useState('');
  const [selected,setSelected]=useState<number[]>([]);
  const [userSearch,setUserSearch]=useState('');
  const [batchNote,setBatchNote]=useState('');
  const [batch,setBatch]=useState<BatchRow[]>([]);
  const [batchRunning,setBatchRunning]=useState(false);
  const [batchConfirm,setBatchConfirm]=useState(false);
  const batchStop=useRef(false),alive=useRef(true);
  const [userId,setUserId]=useState(Number(params.get('userId'))||0);
  const [lines,setLines]=useState<ServiceLine[]>([]);
  const [lineLoading,setLineLoading]=useState(false);
  const [lineError,setLineError]=useState('');
  const [selectedLine,setSelectedLine]=useState(params.get('nodeId')?`${params.get('nodeId')}:${params.get('landingId')||0}`:'');
  const [requestId,setRequestId]=useState<number|undefined>();
  const [days,setDays]=useState(30);
  const [quotaMode,setQuotaMode]=useState<'keep'|'add'|'set'>('keep');
  const [quotaGb,setQuotaGb]=useState(0);
  const [renewNote,setRenewNote]=useState('');
  const [renewConfirm,setRenewConfirm]=useState<{payload:RenewPayload;name:string;expiry:number;quota:number}|null>(null);
  const [renewing,setRenewing]=useState(false);
  const [rejecting,setRejecting]=useState<RenewalRequest|null>(null);
  const [response,setResponse]=useState('');
  const [rejectBusy,setRejectBusy]=useState(false);
  const [history,setHistory]=useState<ActionRecord[]>([]);
  const [historyPage,setHistoryPage]=useState(1);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState('');
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;batchStop.current=true;};},[]);
  useEffect(()=>{
    if(!batchRunning)return;
    const guard=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',guard);
    return()=>window.removeEventListener('beforeunload',guard);
  },[batchRunning]);
  useEffect(()=>{
    let current=true;setLoading(true);setError('');
    Promise.all([loadCatalog(),loadPlans(),loadRenewalRequests(),loadServiceReminders()]).then(([c,p,r,m])=>{
      if(!current)return;
      const failures=[c,p,r,m].filter(x=>x.code!==0);
      if(failures.length)setError(failures.map(x=>x.msg).join('；'));
      if(c.code===0)setCatalog(c.data);if(p.code===0)setPlans(p.data);if(r.code===0)setRequests(r.data);if(m.code===0)setReminders(m.data);
    }).catch(()=>current&&setError('加载失败，请重试')).finally(()=>current&&setLoading(false));return()=>{current=false;};
  },[revision]);
  useEffect(()=>{
    setLines([]);setLineError('');if(!userId)return;
    let current=true;setLineLoading(true);
    loadServiceLines(userId).then(r=>{if(!current)return;if(r.code===0)setLines(r.data);else setLineError(r.msg||'线路加载失败');})
      .catch(()=>current&&setLineError('线路加载失败')).finally(()=>current&&setLineLoading(false));return()=>{current=false;};
  },[userId,revision]);
  useEffect(()=>{
    if(tab!=='history')return;let current=true;setHistoryLoading(true);setHistoryError('');
    loadServiceHistory(historyPage).then(r=>{if(!current)return;if(r.code===0)setHistory(r.data);else setHistoryError(r.msg||'记录加载失败');})
      .catch(()=>current&&setHistoryError('记录加载失败')).finally(()=>current&&setHistoryLoading(false));return()=>{current=false;};
  },[tab,historyPage,revision]);

  const currentLine=lines.find(l=>lineKey(l)===selectedLine)||lines[0];
  const plan=plans.find(p=>String(p.id)===planId);
  const visibleUsers=catalog.users.filter(u=>u.name.toLowerCase().includes(userSearch.toLowerCase())||String(u.id).includes(userSearch));
  const save=async()=>{
    if(!editor||saving)return;
    if(!editor.name.trim()||!editor.nodeId||!Number.isInteger(editor.quotaGb)||editor.quotaGb<0||editor.quotaGb>1000000||!Number.isInteger(editor.durationDays)||editor.durationDays<1||editor.durationDays>3650){toast.error('请填写名称、线路及有效的整数额度和天数');return;}
    setSaving(true);try{const r=await savePlan(editor);if(r.code===0){toast.success('模板已保存，不影响已分配线路');setEditor(null);setRevision(v=>v+1);}else toast.error(r.msg);}catch{toast.error('保存失败');}finally{setSaving(false);}
  };
  const startBatch=async(ids:number[]=selected)=>{
    if(!plan||plan.active!==1||batchRunning)return;
    const rows=ids.map(id=>({userId:id,name:catalog.users.find(u=>u.id===id)?.name||`用户 #${id}`,key:newOperationKey(),status:'waiting',message:''}));
    const chosen={...plan};setBatch(rows);setBatchRunning(true);setBatchConfirm(false);batchStop.current=false;
    for(const row of rows){
      if(batchStop.current||!alive.current)break;
      setBatch(old=>old.map(r=>r.key===row.key?{...r,status:'running'}:r));
      try{const r=await assignPlan(chosen,row.userId,row.key,batchNote);if(!alive.current)break;setBatch(old=>old.map(x=>x.key!==row.key?x:r.code===0?{...x,status:r.data.status,message:r.data.message}:{...x,status:r.code===-1?'unknown':'failed',message:r.msg||'请求失败，请到记录中确认结果'}));}
      catch{if(alive.current)setBatch(old=>old.map(x=>x.key===row.key?{...x,status:'unknown',message:'连接中断，请到操作记录确认结果，避免重复提交'}:x));}
    }
    if(alive.current){setBatch(old=>old.map(x=>x.status==='waiting'?{...x,status:'stopped',message:'尚未提交，可重新选择分配'}:x));setBatchRunning(false);setRevision(v=>v+1);}
  };
  const openRenew=(line:{userId:number;nodeId:number;landingId:number|null},id?:number)=>{setUserId(line.userId);setSelectedLine(lineKey(line));setRequestId(id);setDays(30);setQuotaMode('keep');setQuotaGb(0);setRenewNote('');setTab('renew');};
  const previewRenew=()=>{
    if(!currentLine)return;
    if(!Number.isInteger(days)||days<0||days>3650||!Number.isInteger(quotaGb)||quotaGb<0||quotaGb>1000000){toast.error('天数或额度超出范围');return;}
    if(days>0&&!currentLine.expTime){toast.error('该线路不单独限期，请将增加天数设为 0，只调整流量');return;}
    if(quotaMode==='add'&&!(currentLine.quotaGb&&currentLine.quotaGb>0)){toast.error('该线路不单独限额，无需追加流量');return;}
    const quota=quotaMode==='keep'?(currentLine.quotaGb||0):quotaMode==='set'?quotaGb:(currentLine.quotaGb||0)+quotaGb;
    if(quota>1000000){toast.error('调整后额度过大');return;}
    if(days===0&&quota===(currentLine.quotaGb||0)){toast.error('请至少修改有效期或额度');return;}
    setRenewConfirm({payload:{requestKey:newOperationKey(),userId,nodeId:currentLine.nodeId,landingId:currentLine.landingId,days,quotaMode,quotaGb,note:renewNote,renewalRequestId:requestId},name:`${currentLine.userName} #${userId} · ${lineName(currentLine)}`,quota,expiry:days?Math.max(currentLine.expTime||0,Date.now())+days*86400000:(currentLine.expTime||0)});
  };
  const submitRenew=async()=>{
    if(!renewConfirm||renewing)return;setRenewing(true);
    try{const r=await renewService(renewConfirm.payload);if(r.code!==0){toast.error(r.msg);return;}
      if(r.data.status==='completed'){toast.success(r.data.message);setRenewConfirm(null);setRequestId(undefined);setRevision(v=>v+1);}
      else if(r.data.status==='partial'){toast(r.data.message,{duration:8000});setRenewConfirm(null);setRequestId(undefined);setTab('history');setRevision(v=>v+1);}
      else {toast.error(r.data.message||'处理中，请查看记录');if(r.data.status==='failed')setRenewConfirm(null);}
    }catch{toast.error('连接中断。请使用同一确认窗口重试，或到操作记录核对。');}finally{setRenewing(false);}
  };
  const reject=async()=>{if(!rejecting||!response.trim()||rejectBusy)return;setRejectBusy(true);try{const r=await rejectRenewal(rejecting.id,response);if(r.code===0){toast.success('已回复申请');setRejecting(null);setRevision(v=>v+1);}else toast.error(r.msg);}catch{toast.error('处理失败');}finally{setRejectBusy(false);}};

  return <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-5">
    <div className="flex justify-between items-start gap-3 flex-wrap"><div><h1 className="text-2xl font-bold">套餐与续期</h1><p className="text-sm text-default-500 mt-1">模板分配、人工续期和站内提醒，操作结果可追溯</p></div><Button variant="flat" isLoading={loading} isDisabled={batchRunning||renewing} onPress={()=>setRevision(v=>v+1)}>刷新数据</Button></div>
    {error&&<p role="alert" className="rounded-xl bg-danger/10 p-3 text-danger text-sm">{error}</p>}
    <div className="grid grid-cols-3 gap-3">{[['启用模板',plans.filter(p=>p.active===1).length],['待处理申请',requests.filter(r=>r.status==='pending').length],['需关注线路',reminders.length]].map(([label,value])=><Card key={label}><CardBody className="p-4 gap-2"><span className="text-xs text-default-500">{label}</span><b className="text-2xl">{value}</b></CardBody></Card>)}</div>
    <div role="tablist" aria-label="套餐管理栏目" className="flex gap-2 flex-wrap">{[['plans','套餐模板'],['batch','批量分配'],['renew','人工续期'],['requests','续期申请'],['reminders','到期与用量提醒'],['history','操作记录']].map(([key,label])=><Button key={key} role="tab" aria-selected={tab===key} color={tab===key?'primary':'default'} variant={tab===key?'solid':'flat'} onPress={()=>setTab(key)}>{label}</Button>)}</div>
    {tab==='plans'&&<div className="space-y-3"><div className="flex justify-between items-center gap-3"><p className="text-xs text-default-500">一个模板对应一条直连或中转线路。修改或停用模板不会改变已经分配的套餐。</p><Button color="primary" onPress={()=>setEditor({...emptyPlan})}>新增模板</Button></div>
      {!plans.length&&!loading&&<p className="text-center py-12 text-default-500">暂无套餐模板，先创建一个。</p>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{plans.map(p=><Card key={p.id}><CardBody className="space-y-3 p-4"><div className="flex justify-between gap-2"><h2 className="font-semibold">{p.name}</h2><Chip size="sm" variant="flat" color={p.active?'success':'default'}>{p.active?'启用':'停用'}</Chip></div><p className="text-sm">{p.nodeName||'已删除节点'} · {p.landingName||'直连'}</p><p className="text-xl font-semibold">{p.quotaGb>0?`${p.quotaGb} GB`:'不单独限额'} <span className="text-sm text-default-500">/ {p.durationDays} 天</span></p><p className="text-xs text-default-500">{p.speedName||'不设置独立限速'} · 版本 {p.version}</p>{p.remark&&<p className="text-xs text-default-400">{p.remark}</p>}<div className="flex gap-2"><Button size="sm" variant="flat" onPress={()=>setEditor({...p})}>编辑模板</Button><Button size="sm" color="primary" variant="flat" isDisabled={!p.active} onPress={()=>{setPlanId(String(p.id));setTab('batch');}}>选择并分配</Button></div></CardBody></Card>)}</div>
    </div>}
    {tab==='batch'&&<div className="space-y-4"><Card><CardBody className="space-y-4 p-4">
      <Field label="选择套餐模板"><select aria-label="批量分配模板" className={selectClass} value={planId} disabled={batchRunning} onChange={e=>setPlanId(e.target.value)}><option value="">请选择</option>{plans.filter(p=>p.active===1).map(p=><option key={p.id} value={p.id}>{p.name} · {p.nodeName} · {p.quotaGb||'不限'} GB / {p.durationDays} 天</option>)}</select></Field>
      <p className="text-xs text-default-500">已有同线路会跳过，未分配用户从实际执行时起计算有效期。每次最多 50 人。关闭或离开本页面后，尚未提交的用户不会继续分配；已提交操作可在记录中查看。</p>
      <Input aria-label="搜索分配用户" placeholder="搜索用户名或 ID" value={userSearch} onValueChange={setUserSearch}/>
      <div className="flex gap-2 items-center"><Button size="sm" variant="flat" isDisabled={batchRunning} onPress={()=>setSelected(visibleUsers.filter(u=>u.status===1).slice(0,50).map(u=>u.id))}>选择当前筛选的前 50 人</Button><Button size="sm" variant="light" isDisabled={batchRunning} onPress={()=>setSelected([])}>清空选择</Button><span className="text-xs text-default-500">已选 {selected.length} 人</span></div>
      <div className="max-h-64 overflow-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{visibleUsers.map(u=><label key={u.id} className="flex gap-2 items-center p-3 rounded-xl bg-default-100 text-sm"><input type="checkbox" aria-label={`选择用户 ${u.name}`} checked={selected.includes(u.id)} disabled={batchRunning||u.status!==1} onChange={e=>{if(e.target.checked&&selected.length>=50){toast.error('每批最多50人');return;}setSelected(old=>e.target.checked?[...old,u.id]:old.filter(id=>id!==u.id));}}/><span>{u.name} <span className="text-default-400">#{u.id}{u.status!==1?' · 停用':''}</span></span></label>)}</div>
      <Input aria-label="批量分配备注" label="内部备注（可选）" maxLength={500} value={batchNote} isDisabled={batchRunning} onValueChange={setBatchNote}/>
      <div className="flex gap-2"><Button color="primary" isDisabled={!plan||!selected.length||!!error} isLoading={batchRunning} onPress={()=>setBatchConfirm(true)}>预览批量分配</Button>{batchRunning&&<Button variant="flat" onPress={()=>{batchStop.current=true;toast('当前用户处理完后停止后续分配');}}>停止后续分配</Button>}</div>
    </CardBody></Card>
      {!!batch.length&&<Card><CardBody className="space-y-3"><h2 className="font-semibold">本批次进度 · {batch.filter(r=>!['waiting','running'].includes(r.status)).length}/{batch.length}</h2>{batch.map(r=><div key={r.key} className="border-b border-divider py-2 text-sm"><div className="flex items-center gap-2"><b>{r.name}</b><Chip size="sm" variant="flat" color={r.status==='completed'?'success':r.status==='partial'||r.status==='unknown'?'warning':'default'}>{statusLabel(r.status)}</Chip></div>{r.message&&<p className="text-default-500 mt-1">{r.message}</p>}</div>)}{!batchRunning&&batch.some(r=>r.status==='failed')&&<Button size="sm" variant="flat" onPress={()=>{setSelected(batch.filter(r=>r.status==='failed').map(r=>r.userId));toast('已选择明确失败的用户，请核对原因后重新预览分配');}}>选择失败项重试</Button>}</CardBody></Card>}
    </div>}
    {tab==='renew'&&<Card><CardBody className="p-5 space-y-4">
      <h2 className="font-semibold">人工续期与额度调整</h2>
      {!!requestId&&<p className="text-sm text-primary">正在处理申请 #{requestId} <Button size="sm" variant="light" onPress={()=>setRequestId(undefined)}>取消关联申请</Button></p>}
      <div className="grid md:grid-cols-2 gap-4"><Field label="用户"><select aria-label="续期用户" className={selectClass} value={userId||''} onChange={e=>{setUserId(Number(e.target.value));setSelectedLine('');setRequestId(undefined);}}><option value="">请选择用户</option>{catalog.users.map(u=><option key={u.id} value={u.id}>{u.name} #{u.id}</option>)}</select></Field>
      <Field label="线路"><select aria-label="续期线路" className={selectClass} disabled={lineLoading} value={currentLine?lineKey(currentLine):''} onChange={e=>{setSelectedLine(e.target.value);setRequestId(undefined);}}><option value="">{lineLoading?'加载中…':'请选择线路'}</option>{lines.map(l=><option key={l.id} value={lineKey(l)}>{lineName(l)}</option>)}</select></Field></div>
      {lineError&&<p className="text-danger text-sm">{lineError}</p>}{userId>0&&!lineLoading&&!lines.length&&!lineError&&<p className="text-default-500">该用户暂无线路，请先分配套餐。</p>}
      {currentLine&&<><div className="rounded-xl bg-default-100 p-4 text-sm space-y-2"><b>{lineName(currentLine)}</b><p>当前到期：{fmtDate(currentLine.expTime)} · 已用 {fmtGB(currentLine.usedBytes)} / {currentLine.quotaGb?`${currentLine.quotaGb} GB`:'不单独限额'}</p>{currentLine.warnings.length>0&&<p className="text-warning">{currentLine.warnings.join(' · ')}</p>}</div>
      <div className="grid md:grid-cols-3 gap-4"><Input type="number" min={0} max={3650} step={1} label="增加有效期（天，0=不改）" value={String(days)} onValueChange={v=>setDays(Number(v))}/><Field label="流量调整方式"><select aria-label="流量调整方式" className={selectClass} value={quotaMode} onChange={e=>setQuotaMode(e.target.value as 'keep'|'add'|'set')}><option value="keep">保持当前额度</option><option value="add">追加额度</option><option value="set">设置总额度</option></select></Field><Input type="number" min={0} max={1000000} step={1} label="额度（GB，设置为0=不单独限）" value={String(quotaGb)} isDisabled={quotaMode==='keep'} onValueChange={v=>setQuotaGb(Number(v))}/></div>
      <p className="text-xs text-default-500">未到期从原到期日顺延，已到期从当前时间起算。不会清零已用流量，不会更换订阅。账号停用、账号总额度及账号到期需在用户管理单独处理。</p>
      <Input label="内部续期备注（可选）" maxLength={500} value={renewNote} onValueChange={setRenewNote}/><Button className="self-start" color="primary" onPress={previewRenew}>预览续期变更</Button></>}
    </CardBody></Card>}
    {tab==='requests'&&<div className="space-y-3"><p className="text-xs text-default-500">显示最近 200 条申请，待处理优先。处理时会打开人工续期表单，确认后才修改额度。</p>{!requests.length&&<p className="py-10 text-center text-default-500">暂无续期申请</p>}{requests.map(r=><Card key={r.id}><CardBody className="space-y-3 text-sm"><div className="flex gap-2 items-center flex-wrap"><b>{r.userName||`用户 #${r.userId}`}</b><span>{lineName(r)}</span><Chip size="sm" variant="flat">{statusLabel(r.status)}</Chip><span className="ml-auto text-xs text-default-400">{fmtDate(r.createdAt)}</span></div><p>用户留言：{r.message||'未填写'}</p>{r.response&&<p className="text-default-500">回复：{r.response}</p>}{r.status==='pending'&&<div className="flex gap-2"><Button size="sm" color="primary" onPress={()=>openRenew(r,r.id)}>处理续期</Button><Button size="sm" variant="flat" onPress={()=>{setRejecting(r);setResponse('');}}>不通过并回复</Button></div>}</CardBody></Card>)}</div>}
    {tab==='reminders'&&<div className="space-y-3"><p className="text-xs text-default-500">站内提醒：到期前 7 天、流量达到 80%，以及账号或线路异常。刷新后重新计算，不会自动发送邮件或外部消息。</p>{!reminders.length&&<p className="text-center py-10 text-default-500">当前没有需要关注的线路</p>}{reminders.map(l=><Card key={l.id}><CardBody className="space-y-2"><div className="flex gap-2 flex-wrap items-center"><b>{l.userName||`用户 #${l.userId}`}</b><span className="text-sm">{lineName(l)}</span><Button size="sm" className="ml-auto" variant="flat" color="primary" onPress={()=>openRenew(l)}>人工处理</Button></div><div className="flex gap-1 flex-wrap">{l.warnings.map(w=><Chip size="sm" color="warning" variant="flat" key={w}>{w}</Chip>)}</div><p className="text-xs text-default-500">到期 {fmtDate(l.expTime)} · 已用 {fmtGB(l.usedBytes)} / {l.quotaGb?`${l.quotaGb} GB`:'不单独限额'}</p></CardBody></Card>)}</div>}
    {tab==='history'&&<div className="space-y-3"><p className="text-xs text-default-500">记录实际执行结果和变更前后值。需核对或长时间处理中时，先检查线路和节点，避免重复续期。</p>{historyError&&<p role="alert" className="text-danger">{historyError}</p>}{historyLoading?<Spinner/>:<ServiceHistory rows={history} admin/>}<div className="flex gap-3 items-center justify-end"><Button size="sm" isDisabled={historyPage===1||historyLoading} onPress={()=>setHistoryPage(p=>p-1)}>上一页</Button><span>第 {historyPage} 页</span><Button size="sm" isDisabled={history.length<50||historyLoading} onPress={()=>setHistoryPage(p=>p+1)}>下一页</Button></div></div>}

    <Modal isOpen={!!editor} onClose={()=>!saving&&setEditor(null)} isDismissable={!saving} size="2xl" scrollBehavior="inside"><ModalContent><ModalHeader>{editor?.id?'编辑套餐模板':'新增套餐模板'}</ModalHeader><ModalBody>{editor&&<div className="space-y-4"><Input label="模板名称" maxLength={80} value={editor.name} onValueChange={v=>setEditor({...editor,name:v})}/><Field label="线路"><select aria-label="模板线路" className={selectClass} value={editor.nodeId?lineKey(editor):''} onChange={e=>{const route=catalog.routes.find(r=>lineKey(r)===e.target.value);if(route)setEditor({...editor,nodeId:route.nodeId,landingId:route.landingId});}}><option value="">请选择线路</option>{catalog.routes.map(r=><option key={lineKey(r)} value={lineKey(r)}>{lineName(r)}{r.status!==1?'（离线）':''}</option>)}</select></Field><div className="grid grid-cols-2 gap-3"><Input label="流量额度（GB，0=不单独限）" type="number" min={0} max={1000000} value={String(editor.quotaGb)} onValueChange={v=>setEditor({...editor,quotaGb:Number(v)})}/><Input label="有效期（天）" type="number" min={1} max={3650} value={String(editor.durationDays)} onValueChange={v=>setEditor({...editor,durationDays:Number(v)})}/></div><Field label="限速规则"><select aria-label="模板限速规则" className={selectClass} value={editor.speedId??''} onChange={e=>setEditor({...editor,speedId:e.target.value?Number(e.target.value):null})}><option value="">不设置独立限速</option>{catalog.speeds.map(s=><option key={s.id} value={s.id}>{s.name} · {s.speed} Mbps</option>)}</select></Field><p className="text-xs text-default-500">现有架构按同用户、同前置机共享限速；已有其他线路时，不自动覆盖其限速。</p><Field label="模板状态"><select aria-label="模板状态" className={selectClass} value={editor.active} onChange={e=>setEditor({...editor,active:Number(e.target.value)})}><option value={1}>启用</option><option value={0}>停用</option></select></Field><Input label="模板说明" maxLength={500} value={editor.remark} onValueChange={v=>setEditor({...editor,remark:v})}/></div>}</ModalBody><ModalFooter><Button variant="flat" isDisabled={saving} onPress={()=>setEditor(null)}>取消</Button><Button color="primary" isLoading={saving} onPress={save}>保存模板</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={batchConfirm} onClose={()=>setBatchConfirm(false)}><ModalContent><ModalHeader>确认批量分配</ModalHeader><ModalBody><p>将「{plan?.name}」分配给 {selected.length} 位用户。</p><p className="text-sm text-default-500">{plan?.quotaGb?`${plan.quotaGb} GB`:'不单独限额'} / {plan?.durationDays} 天 · 已有线路会跳过。</p><p className="text-sm break-words">{catalog.users.filter(u=>selected.includes(u.id)).map(u=>u.name).join('、')}</p></ModalBody><ModalFooter><Button variant="flat" onPress={()=>setBatchConfirm(false)}>取消</Button><Button color="primary" onPress={()=>startBatch()}>确认分配</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!renewConfirm} onClose={()=>!renewing&&setRenewConfirm(null)} isDismissable={!renewing}><ModalContent><ModalHeader>确认人工续期</ModalHeader><ModalBody><p>{renewConfirm?.name}</p><p className="text-sm">调整后额度：{renewConfirm?.quota?`${renewConfirm.quota} GB`:'不单独限额'}</p><p className="text-sm">预计到期：{fmtDate(renewConfirm?.expiry)}</p><p className="text-xs text-default-500">保留已用流量和订阅链接。已过期线路以实际提交时间起算。</p></ModalBody><ModalFooter><Button variant="flat" isDisabled={renewing} onPress={()=>setRenewConfirm(null)}>取消</Button><Button color="primary" isLoading={renewing} onPress={submitRenew}>确认续期</Button></ModalFooter></ModalContent></Modal>
    <Modal isOpen={!!rejecting} onClose={()=>!rejectBusy&&setRejecting(null)} isDismissable={!rejectBusy}><ModalContent><ModalHeader>回复续期申请</ModalHeader><ModalBody><p className="text-sm">{rejecting&&lineName(rejecting)}</p><textarea aria-label="申请回复" maxLength={500} rows={4} className={selectClass} value={response} onChange={e=>setResponse(e.target.value)}/><p className="text-xs text-default-500">回复会显示在用户自助中心，提交后该申请标记为未通过。</p></ModalBody><ModalFooter><Button variant="flat" isDisabled={rejectBusy} onPress={()=>setRejecting(null)}>取消</Button><Button color="primary" isDisabled={!response.trim()} isLoading={rejectBusy} onPress={reject}>提交回复</Button></ModalFooter></ModalContent></Modal>
    <p className="text-xs text-default-400">本模块不收款、不扣费。<Link to="/my-sub" className="text-primary">查看我的自助中心</Link></p>
  </div>;
}
