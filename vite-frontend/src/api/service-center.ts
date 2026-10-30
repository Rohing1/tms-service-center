import Network from './network';

export interface ServiceLine {
  id:number; userId:number; userName:string; nodeId:number; nodeName:string; landingId:number|null; landingName:string|null;
  quotaGb:number|null; expTime:number|null; lineStatus:number; accountStatus:number; accountExpTime:number|null;
  usedBytes:number; protocolCount:number; warnings:string[]; subToken?:string;
}
export interface ServicePlan { id?:number; name:string; nodeId:number; nodeName?:string; landingId:number|null; landingName?:string; quotaGb:number; durationDays:number; speedId:number|null; speedName?:string; active:number; remark:string; version?:number }
export interface RenewalRequest { id:number; userId:number; userName:string; nodeId:number; nodeName:string; landingId:number|null; landingName:string|null; status:string; message:string; response:string; createdAt:number; updatedAt:number }
export interface ActionRecord { id:number; userId:number; userName:string; nodeId:number; nodeName:string; landingId:number|null; landingName:string|null; planName?:string; actionType:string; status:string; message:string; note?:string; actorName?:string; beforeJson?:string; afterJson?:string; createdAt:number; finishedAt:number|null }
export interface Operation { id:number; requestKey:string; status:string; message:string }
export interface RenewPayload { requestKey:string; userId:number; nodeId:number; landingId:number|null; days:number; quotaMode:'keep'|'add'|'set'; quotaGb:number; note:string; renewalRequestId?:number }
export interface Catalog { users:{id:number;name:string;status:number;expTime:number|null}[]; routes:{nodeId:number;nodeName:string;landingId:number|null;landingName:string|null;status:number}[]; speeds:{id:number;name:string;speed:number}[] }
export interface SelfCenter { account:{id:number;name:string;status:number;expTime:number|null;quotaGb:number;usedBytes:number}; lines:ServiceLine[]; allSubToken:string|null; requests:RenewalRequest[]; history:ActionRecord[]; updatedAt:number }

export const loadSelfCenter=()=>Network.post<SelfCenter>('/service-center/self');
export const requestRenewal=(nodeId:number,landingId:number|null,message:string)=>Network.post('/service-center/request',{nodeId,landingId,message});
export const loadMyHistory=(page:number)=>Network.post<ActionRecord[]>('/service-center/my-history',{page});
export const loadPlans=()=>Network.post<ServicePlan[]>('/service-center/plans');
export const savePlan=(plan:ServicePlan)=>Network.post('/service-center/plan-save',plan);
export const loadCatalog=()=>Network.post<Catalog>('/service-center/catalog');
export const assignPlan=(plan:ServicePlan,userId:number,requestKey:string,note:string)=>Network.post<Operation>('/service-center/assign',{planId:plan.id,planVersion:plan.version,userId,requestKey,note});
export const renewService=(payload:RenewPayload)=>Network.post<Operation>('/service-center/renew',payload);
export const loadServiceLines=(userId:number)=>Network.post<ServiceLine[]>('/service-center/lines',{userId});
export const loadRenewalRequests=()=>Network.post<RenewalRequest[]>('/service-center/requests');
export const rejectRenewal=(id:number,response:string)=>Network.post('/service-center/reject',{id,response});
export const loadServiceHistory=(page:number,userId?:number)=>Network.post<ActionRecord[]>('/service-center/history',{page,userId});
export const loadServiceReminders=()=>Network.post<ServiceLine[]>('/service-center/reminders');
export const lineKey=(line:{nodeId:number;landingId:number|null})=>`${line.nodeId}:${line.landingId??0}`;
export const lineName=(line:{nodeName:string;landingName?:string|null})=>`${line.nodeName||'已删除节点'} · ${line.landingName||'直连'}`;
export const fmtGB=(bytes:number)=>`${(bytes/(1024**3)).toFixed(2)} GB`;
export const fmtDate=(value:number|null|undefined)=>value&&value>0?new Date(value).toLocaleString('zh-CN'):'不单独限期';
export const newOperationKey=()=>crypto.randomUUID();
export const statusLabel=(value:string)=>({completed:'已完成',partial:'需核对',failed:'未完成',skipped:'已跳过',running:'处理中',pending:'待处理',handled:'已处理',rejected:'未通过',waiting:'未提交',unknown:'结果待确认',stopped:'已停止'}[value]||value);
