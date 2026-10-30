import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardBody } from '@heroui/card';
import { Button } from '@heroui/button';
import { Input } from '@heroui/input';
import { Chip } from '@heroui/chip';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/modal';
import { Spinner } from '@heroui/spinner';
import toast from 'react-hot-toast';
import { SubQrToggle } from '@/components/sub-qr';
import ServiceHistory from '@/components/service-history';
import { copyTextToClipboard } from '@/utils/clipboard';
import { isAdmin } from '@/utils/auth';
import { deleteLine } from '@/api';
import { loadSelfCenter, requestRenewal, loadMyHistory, lineKey, lineName, fmtDate, fmtGB, statusLabel } from '@/api/service-center';
import type { SelfCenter, ServiceLine, ActionRecord } from '@/api/service-center';

export default function MySubPage() {
  const [data,setData]=useState<SelfCenter|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const [tab,setTab]=useState('lines');
  const [filter,setFilter]=useState('');
  const [target,setTarget]=useState<ServiceLine|null>(null);
  const [message,setMessage]=useState('');
  const [sending,setSending]=useState(false);
  const [history,setHistory]=useState<ActionRecord[]>([]);
  const [historyPage,setHistoryPage]=useState(1);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState('');
  useEffect(()=>{
    let alive=true;setLoading(true);setError('');
    loadSelfCenter().then(r=>{if(!alive)return;if(r.code===0){setData(r.data);setHistory(r.data.history);setHistoryPage(1);}else setError(r.msg||'加载失败');})
      .catch(()=>alive&&setError('加载失败，请重试')).finally(()=>alive&&setLoading(false));
    return()=>{alive=false;};
  },[revision]);
  useEffect(()=>{
    if(historyPage===1){setHistory(data?.history||[]);setHistoryError('');setHistoryLoading(false);return;}
    let alive=true;setHistoryLoading(true);setHistoryError('');
    loadMyHistory(historyPage).then(r=>{if(!alive)return;if(r.code===0)setHistory(r.data);else setHistoryError(r.msg||'记录加载失败');})
      .catch(()=>alive&&setHistoryError('记录加载失败')).finally(()=>alive&&setHistoryLoading(false));
    return()=>{alive=false;};
  },[historyPage,data]);
  const copy=async(value:string)=>{(await copyTextToClipboard(value))?toast.success('已复制，请在客户端中添加或更新订阅'):toast.error('复制失败，请选中链接手动复制');};
  const submit=async()=>{
    if(!target||sending)return;setSending(true);
    try {const r=await requestRenewal(target.nodeId,target.landingId,message);if(r.code===0){toast.success('申请已提交，等待管理员处理');setTarget(null);setTab('requests');setRevision(v=>v+1);}else toast.error(r.msg||'提交失败');}
    catch{toast.error('提交失败，请刷新确认申请状态');}finally{setSending(false);}
  };
  const subscription=(token:string,compact=false)=>{
    const url=`${window.location.origin}/api/v1/open_api/sub?token=${encodeURIComponent(token)}`;
    const clash=`${window.location.origin}/api/v1/open_api/clash?token=${encodeURIComponent(token)}`;
    return <div className="space-y-2"><Input aria-label={compact?'线路订阅链接':'全部线路订阅链接'} value={url} readOnly size="sm" onClick={e=>(e.target as HTMLInputElement).select()}/><div className="flex gap-2 flex-wrap items-start"><Button size="sm" color="primary" onPress={()=>copy(url)}>复制通用订阅</Button><SubQrToggle url={url}/><Button size="sm" variant="flat" onPress={()=>copy(clash)}>复制 Clash / Mihomo 订阅</Button></div></div>;
  };
  if(loading&&!data)return <div className="flex justify-center py-20"><Spinner label="加载自助中心"/></div>;
  if(!data)return <div className="p-8 text-center space-y-4"><p>{error||'暂时无法加载'}</p><Button onPress={()=>setRevision(v=>v+1)}>重试</Button></div>;
  const warnings=data.lines.filter(l=>l.warnings.length);
  const accountExpired=!!data.account.expTime&&data.account.expTime>0&&data.account.expTime<=Date.now();
  const accountDepleted=data.account.quotaGb>0&&data.account.usedBytes>=data.account.quotaGb*1024**3;
  const pending=data.requests.filter(r=>r.status==='pending');
  const lines=data.lines.filter(l=>lineName(l).toLowerCase().includes(filter.toLowerCase()));
  return <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">用户自助中心</h1><p className="text-sm text-default-500 mt-1">{data.account.name}，在这里查看线路、订阅和续期进度</p></div><div className="flex gap-2">{isAdmin()&&<Button as={Link} to="/service-center" variant="flat">套餐与续期管理</Button>}<Button isLoading={loading} variant="flat" onPress={()=>setRevision(v=>v+1)}>刷新</Button></div></div>
    {error&&<div role="alert" className="p-3 rounded-xl bg-warning/10 text-warning text-sm">刷新失败，以下为上次数据：{error}</div>}
    {(data.account.status!==1||accountExpired||accountDepleted)&&<Card className="border border-danger/30"><CardBody className="text-sm text-danger">账号{data.account.status!==1?'已停用':accountExpired?'已到期':'总流量已用完'}，可能影响所有线路。请联系管理员处理账号限制，单独续期线路不会解除账号限制。</CardBody></Card>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['我的线路',`${data.lines.length} 条`],['需要关注',`${warnings.length} 条`],['待处理申请',`${pending.length} 条`],['线路累计用量',fmtGB(data.lines.reduce((n,l)=>n+l.usedBytes,0))]].map(([name,value])=><Card key={name}><CardBody className="p-4 gap-2"><span className="text-xs text-default-500">{name}</span><b className="text-xl">{value}</b></CardBody></Card>)}</div>
    {!!warnings.length&&<Card className="border border-warning/30 bg-warning/5"><CardBody className="space-y-2"><h2 className="font-semibold">到期与用量提醒</h2>{warnings.map(l=><div key={l.id} className="flex flex-wrap gap-2 items-center text-sm"><span>{lineName(l)}</span>{l.warnings.map(w=><Chip key={w} size="sm" variant="flat" color="warning">{w}</Chip>)}</div>)}<p className="text-xs text-default-500">到期前 7 天、已用流量达到 80% 时在此提醒；刷新后更新。</p></CardBody></Card>}
    <div className="flex gap-2 flex-wrap" role="tablist" aria-label="自助中心栏目">{[['lines','我的线路'],['requests','续期申请'],['history','服务记录'],['help','使用帮助']].map(([key,label])=><Button key={key} role="tab" aria-selected={tab===key} color={tab===key?'primary':'default'} variant={tab===key?'solid':'flat'} onPress={()=>setTab(key)}>{label}</Button>)}</div>
    {tab==='lines'&&<div className="space-y-4">
      {data.allSubToken&&<Card className="border border-primary/30"><CardBody className="p-4 space-y-3"><div><h2 className="font-semibold">全部线路订阅</h2><p className="text-xs text-default-500 mt-1">新开通线路会随订阅更新出现。链接包含访问凭证，请勿公开分享。</p></div>{subscription(data.allSubToken)}</CardBody></Card>}
      <Input aria-label="筛选我的线路" placeholder="搜索线路名称" value={filter} onValueChange={setFilter} className="max-w-sm"/>
      {!lines.length&&<Card><CardBody className="py-10 text-center text-default-500">{data.lines.length?'没有匹配的线路':'暂无协议线路，请联系管理员分配套餐。已有普通转发可使用全部线路订阅。'}</CardBody></Card>}
      <div className="grid lg:grid-cols-2 gap-4">{lines.map(l=>{
        const quota=l.quotaGb&&l.quotaGb>0?l.quotaGb*1024**3:0;
        const hasRequest=pending.some(r=>lineKey(r)===lineKey(l));
        return <Card key={l.id}><CardBody className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{lineName(l)}</h2><Chip size="sm" variant="flat" color={l.warnings.length?'warning':'success'}>{l.warnings.length?'需要关注':'正常'}</Chip></div>
          <div className="grid grid-cols-2 gap-3 text-sm"><div><p className="text-xs text-default-500">已用 / 额度</p><b>{fmtGB(l.usedBytes)} / {quota?`${l.quotaGb} GB`:'不单独限额'}</b></div><div><p className="text-xs text-default-500">剩余流量</p><b>{quota?fmtGB(Math.max(0,quota-l.usedBytes)):'受账号总额度约束'}</b></div><div><p className="text-xs text-default-500">线路到期</p><span>{fmtDate(l.expTime)}</span></div><div><p className="text-xs text-default-500">已分配协议</p><span>{l.protocolCount} 个</span></div></div>
          {quota>0&&<div className="h-2 bg-default-100 rounded-full overflow-hidden" role="progressbar" aria-label="线路流量使用率" aria-valuenow={Math.min(100,Math.round(l.usedBytes/quota*100))} aria-valuemin={0} aria-valuemax={100}><div className={l.usedBytes/quota>=0.8?'h-full bg-warning':'h-full bg-primary'} style={{width:`${Math.min(100,l.usedBytes/quota*100)}%`}}/></div>}
          {!!l.warnings.length&&<p className="text-xs text-warning">{l.warnings.join(' · ')}</p>}
          {l.subToken?subscription(l.subToken,true):<p className="text-xs text-default-500">暂未生成订阅，请联系管理员检查分配。</p>}
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="flat" isDisabled={hasRequest} onPress={()=>{setTarget(l);setMessage('');}}>{hasRequest?'续期申请待处理':'申请人工续期'}</Button>{isAdmin()&&<Button size="sm" variant="light" color="danger" onPress={async()=>{if(!confirm(`确认删除「${lineName(l)}」？端口和订阅会失效，无法撤销。`))return;const r=await deleteLine(data.account.id,l.nodeId,l.landingId);if(r.code===0){toast.success('线路已删除');setRevision(v=>v+1);}else toast.error(r.msg);}}>删除</Button>}</div>
        </CardBody></Card>;
      })}</div>
      <p className="text-xs text-default-400">线路额度和账号额度同时生效。累计用量来自当前转发记录，清零或删除记录后会变化；此处不推算历史趋势。</p>
    </div>}
    {tab==='requests'&&<div className="space-y-3"><p className="text-xs text-default-500">提交申请不会自动扣款或修改套餐，等待管理员人工处理。显示最近 200 条，待处理优先。</p>{!data.requests.length&&<p className="py-10 text-center text-default-500">暂无续期申请</p>}{data.requests.map(r=><Card key={r.id}><CardBody className="space-y-2 text-sm"><div className="flex flex-wrap gap-2 items-center"><b>{lineName(r)}</b><Chip size="sm" variant="flat">{statusLabel(r.status)}</Chip><span className="ml-auto text-xs text-default-400">{fmtDate(r.createdAt)}</span></div>{r.message&&<p>我的留言：{r.message}</p>}<p className="text-default-500">{r.response||'管理员尚未处理，请耐心等待。'}</p></CardBody></Card>)}</div>}
    {tab==='history'&&<div className="space-y-3">{historyError&&<p role="alert" className="text-danger">{historyError}</p>}{historyLoading?<Spinner/>:<ServiceHistory rows={history}/>}<div className="flex gap-3 items-center justify-end"><Button size="sm" isDisabled={historyLoading||historyPage===1} onPress={()=>setHistoryPage(p=>p-1)}>上一页</Button><span className="text-sm">第 {historyPage} 页</span><Button size="sm" isDisabled={historyLoading||history.length<50} onPress={()=>setHistoryPage(p=>p+1)}>下一页</Button></div></div>}
    {tab==='help'&&<Card><CardBody className="p-5 space-y-4 text-sm"><h2 className="font-semibold">添加和更新订阅</h2><p>v2rayN / v2rayNG / Shadowrocket：复制“通用订阅”，在客户端的订阅管理中添加地址，再更新订阅。</p><p>Clash / Mihomo：使用对应的订阅按钮；通用订阅和 Clash 格式不能混用。</p><h3 className="font-semibold">续期后要做什么</h3><p>人工续期保留已有链接。刷新本页确认到期和额度，再在客户端更新订阅；如账号仍停用或总额度用完，请联系管理员。</p><h3 className="font-semibold">连不上时先检查</h3><p>查看本页的到期、流量和账号提醒；确认订阅已更新、客户端选对线路。仍无法使用时，将线路名称和错误提示交给管理员，不要公开发送完整订阅链接。</p></CardBody></Card>}
    <Modal isOpen={!!target} onClose={()=>!sending&&setTarget(null)} isDismissable={!sending}><ModalContent><ModalHeader>申请人工续期</ModalHeader><ModalBody><p className="text-sm">{target&&lineName(target)}</p><p className="text-xs text-default-500">写明希望续期的天数或流量需求。具体额度由管理员确认。</p><textarea aria-label="续期申请留言" maxLength={500} value={message} onChange={e=>setMessage(e.target.value)} rows={4} className="w-full rounded-xl bg-default-100 p-3 text-sm"/></ModalBody><ModalFooter><Button isDisabled={sending} variant="flat" onPress={()=>setTarget(null)}>取消</Button><Button color="primary" isLoading={sending} onPress={submit}>提交申请</Button></ModalFooter></ModalContent></Modal>
  </div>;
}
