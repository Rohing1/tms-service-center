import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { diagnoseLineStep, getLineDetail, getNodeMetrics, getNodeProbes } from "@/api";
import type { LineCheck, LineDetail, MetricHistory, ProbeHistory } from "@/types/line-detail";

const GB = 1024 ** 3;
const COLORS = ["#6366f1", "#0891b2", "#d97706", "#db2777", "#059669", "#9333ea"];
const ranges = [{ key: "1h", label: "1 小时" }, { key: "24h", label: "24 小时" }, { key: "7d", label: "7 天" }, { key: "30d", label: "30 天" }];
const bytes = (value: number) => {
  if (!value) return "0 B";
  const i = Math.min(4, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
  return `${(value / 1024 ** i).toFixed(i ? 2 : 0)} ${["B", "KB", "MB", "GB", "TB"][i]}`;
};
const date = (value: number | null) => value && value > 0 ? new Date(value).toLocaleString("zh-CN") : "不单独限期";
const time = (value: number) => new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const proto = (value: string) => ({ hysteria2: "Hysteria2", tuic: "TUIC", anytls: "AnyTLS", shadowsocks: "Shadowsocks" }[value] || value.toUpperCase());
const stateText = { passed: "通过", failed: "失败", skipped: "未检测", unknown: "结果未知", pending: "等待", running: "检测中", cancelled: "已停止" };
type Result = { key: string; label: string; state: LineCheck["state"] | "pending" | "running" | "cancelled"; message?: string; latencyMs?: number | null; packetLoss?: number | null };

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-default-500" role="status">{children}</div>;
}

export default function LineDetailPage() {
  const { nodeId: rawId } = useParams();
  const [query] = useSearchParams();
  const nodeId = Number(rawId);
  const rawLanding = query.get("landingId");
  const landingId = rawLanding === null ? null : Number(rawLanding);
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0 || (landingId !== null && (!Number.isSafeInteger(landingId) || landingId <= 0))) {
    return <Empty>线路地址无效。<Link className="text-primary ml-2" to="/inbound">返回协议管理</Link></Empty>;
  }
  return <Detail key={`${nodeId}:${landingId}`} nodeId={nodeId} landingId={landingId} />;
}

function Detail({ nodeId, landingId }: { nodeId: number; landingId: number | null }) {
  const [data, setData] = useState<LineDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState("24h");
  const [metrics, setMetrics] = useState<MetricHistory | null>(null);
  const [probes, setProbes] = useState<ProbeHistory | null>(null);
  const [historyErrors, setHistoryErrors] = useState({ metrics: "", probes: "" });
  const [historyLoading, setHistoryLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [diagnosedAt, setDiagnosedAt] = useState<number | null>(null);
  const run = useRef(0);
  useEffect(() => () => { run.current++; }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    getLineDetail(nodeId, landingId).then(res => {
      if (!alive) return;
      if (res.code === 0) setData(res.data);
      else { setData(null); setError(res.msg || "线路加载失败"); }
    }).catch(() => alive && setError("线路加载失败，请重试"))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [nodeId, landingId, revision]);

  useEffect(() => {
    if (!data) return;
    let alive = true;
    setHistoryLoading(true);
    setMetrics(null); setProbes(null);
    setHistoryErrors({ metrics: "", probes: "" });
    Promise.allSettled([getNodeMetrics(nodeId, range), getNodeProbes(nodeId, range)]).then(([m, p]) => {
      if (!alive) return;
      if (m.status === "fulfilled" && m.value.code === 0) setMetrics(m.value.data);
      if (p.status === "fulfilled" && p.value.code === 0) setProbes(p.value.data);
      setHistoryErrors({
        metrics: m.status === "rejected" ? "节点流量历史加载失败" : m.value.code !== 0 ? m.value.msg || "节点流量历史加载失败" : "",
        probes: p.status === "rejected" ? "延迟丢包历史加载失败" : p.value.code !== 0 ? p.value.msg || "延迟丢包历史加载失败" : "",
      });
      setHistoryLoading(false);
    });
    return () => { alive = false; };
  }, [nodeId, range, data]);

  const diagnose = async () => {
    if (!data || running) return;
    const generation = ++run.current;
    setRunning(true); setDiagnosedAt(null);
    const steps: { key: string; label: string; kind: "protocol" | "landing"; inboundId?: number }[] = data.protocols.map(p => ({
      key: `protocol-${p.id}`, label: `${proto(p.protocol)} · 本地监听`, kind: "protocol", inboundId: p.id,
    }));
    if (landingId !== null) steps.push({ key: "landing", label: "前置机 → 落地出口", kind: "landing" });
    setResults(steps.map(s => ({ ...s, state: "pending" })));
    for (const step of steps) {
      if (generation !== run.current) return;
      setResults(old => old.map(r => r.key === step.key ? { ...r, state: "running" } : r));
      try {
        const res = await diagnoseLineStep(nodeId, landingId, step.kind, step.inboundId);
        if (generation !== run.current) return;
        setResults(old => old.map(r => r.key !== step.key ? r : res.code === 0 && res.data
          ? { ...r, ...res.data } : { ...r, state: "failed", message: res.msg || "检测失败" }));
      } catch {
        if (generation !== run.current) return;
        setResults(old => old.map(r => r.key === step.key ? { ...r, state: "failed", message: "检测请求失败，请重试" } : r));
      }
    }
    if (generation === run.current) { setRunning(false); setDiagnosedAt(Date.now()); }
  };
  const stop = () => {
    run.current++;
    setRunning(false);
    setResults(old => old.map(r => r.state === "pending" || r.state === "running" ? { ...r, state: "cancelled", message: "已停止后续检测，已发出的检测会自行结束" } : r));
  };

  if (loading && !data) return <div className="flex justify-center py-20"><Spinner label="正在加载线路" /></div>;
  if (!data || error) return <div className="p-6 space-y-4"><Link className="text-primary" to={landingId ? "/relay" : "/inbound"}>← 返回线路列表</Link><Empty>{error || "线路不存在"}</Empty><Button onPress={() => setRevision(r => r + 1)}>重试</Button></div>;

  const filtered = data.users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || String(u.id).includes(search));
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pages);
  const shownUsers = filtered.slice((currentPage - 1) * 10, currentPage * 10);
  const selectedTarget = probes?.targets.find(t => String(t.id) === target) || probes?.targets[0];
  const probePoints = (probes?.points || []).filter(p => p.targetId === selectedTarget?.id);
  const latestProbe = probePoints[probePoints.length - 1];
  const now = Date.now();
  const state = (u: LineDetail["users"][number]): string => {
    if (u.accountStatus === null) return "账号已删除";
    if (u.accountStatus !== 1) return "账号停用";
    if (u.accountExpTime && u.accountExpTime > 0 && u.accountExpTime <= now) return "账号到期";
    if (u.lineStatus === 0) return "线路停用";
    if (u.expTime && u.expTime > 0 && u.expTime <= now) return "线路到期";
    if (u.quotaGb && u.quotaGb > 0 && u.inFlow + u.outFlow >= u.quotaGb * GB) return "配额已用完";
    if (u.missingForwards) return "转发记录缺失";
    if (!u.protocolCount) return "未分配协议";
    return "正常";
  };
  const abnormal = data.users.filter(u => state(u) !== "正常").length;
  const tip = { backgroundColor: "hsl(var(--heroui-content1))", borderColor: "hsl(var(--heroui-divider))", borderRadius: 12 };

  return <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
    <div className="flex flex-wrap justify-between gap-4 items-start">
      <div className="space-y-2 min-w-0">
        <Link className="text-sm text-default-500 hover:text-primary" to={landingId ? "/relay" : "/inbound"}>← {landingId ? "中转线路" : "协议管理"}</Link>
        <h1 className="text-2xl font-bold break-words">{data.node.name}{data.landing ? ` → ${data.landing.name}` : " · 直连线路"}</h1>
        <p className="text-xs text-default-500">线路详情 · 数据更新于 {new Date(data.updatedAt).toLocaleTimeString("zh-CN")}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="flat" isLoading={loading} isDisabled={running} onPress={() => setRevision(r => r + 1)}>刷新数据</Button>
        <Button color="primary" isLoading={running} onPress={diagnose}>一键诊断</Button>
      </div>
    </div>

    <Card><CardBody className="p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-lg bg-default-100 px-4 py-3">用户客户端</span><span aria-hidden>→</span>
        <div className="rounded-lg bg-primary/10 px-4 py-3"><div className="font-semibold">{data.node.name}</div><div className="text-xs text-default-500 break-all">{data.node.address}</div></div>
        <Chip size="sm" variant="flat" color={data.node.status === 1 ? "success" : "danger"}>节点{data.node.status === 1 ? "在线" : "离线"}</Chip>
        <span aria-hidden>→</span>
        {data.landing && <><span className="rounded-lg bg-secondary/10 px-4 py-3">{data.landing.name} · {data.landing.type}{data.landing.status !== 1 ? "（已停用）" : ""}</span><span aria-hidden>→</span></>}
        <span className="rounded-lg bg-default-100 px-4 py-3">互联网</span>
      </div>
      <div className="flex gap-2 flex-wrap">
        {data.protocols.map(p => <Chip key={p.id} variant="flat" size="sm" color={p.status === 1 ? "primary" : "default"}>{proto(p.protocol)}{p.status !== 1 ? " · 停用" : ""}</Chip>)}
        <Chip size="sm" variant="flat" color={data.node.singboxRunning === false ? "danger" : "default"}>协议服务：{data.node.singboxRunning === null ? "等待上报" : data.node.singboxRunning ? "运行中" : "未运行"}</Chip>
      </div>
    </CardBody></Card>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[
        ["线路已用流量", bytes(data.inFlow + data.outFlow), "当前关联转发的计费流量合计"],
        ["下行 / 上行", `${bytes(data.inFlow)} / ${bytes(data.outFlow)}`, "与用户线路配额使用相同口径"],
        ["关联用户", `${data.users.length} 人`, !data.users.length ? "尚未分配用户" : abnormal ? `${abnormal} 人需要关注` : "账号与线路状态无异常"],
        ["协议数量", `${data.protocols.length} 个`, "包含已停用的协议"],
      ].map(([label, value, hint]) => <Card key={label}><CardBody className="p-4 gap-2"><span className="text-xs text-default-500">{label}</span><span className="text-xl font-semibold break-words">{value}</span><span className="text-xs text-default-400">{hint}</span></CardBody></Card>)}
    </div>
    <p className="text-xs text-default-500 -mt-2">线路流量来自各用户当前转发记录；清零或删除记录会影响累计值。下方历史图是前置机网卡数据，包含该机器上的其他线路。</p>

    <section className="space-y-3" aria-label="线路监控">
      <div className="flex flex-wrap justify-between items-center gap-3"><h2 className="text-lg font-semibold">流量与连接质量</h2><div className="flex gap-1 flex-wrap">{ranges.map(r => <Button key={r.key} size="sm" variant={range === r.key ? "solid" : "flat"} color={range === r.key ? "primary" : "default"} onPress={() => setRange(r.key)}>{r.label}</Button>)}</div></div>
      <Card><CardBody className="p-4 space-y-3">
        <h3 className="font-medium text-sm">前置机网卡流量趋势</h3>
        {historyLoading ? <Empty>正在加载历史数据…</Empty> : historyErrors.metrics ? <Empty>{historyErrors.metrics}</Empty> : !metrics?.points.length ? <Empty>所选时段暂无流量记录，节点上报后才会产生历史数据。</Empty> : <div className="h-60 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.points}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} /><XAxis dataKey="ts" tickFormatter={time} minTickGap={60} tick={{ fontSize: 11 }} /><YAxis tickFormatter={bytes} width={80} tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={v => time(Number(v))} formatter={v => bytes(Number(v))} contentStyle={tip} /><Legend />
            <Area dataKey="rx" name="接收" stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.12} isAnimationActive={false} /><Area dataKey="tx" name="发送" stroke={COLORS[1]} fill={COLORS[1]} fillOpacity={0.1} isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>
        </div>}
      </CardBody></Card>
      <Card><CardBody className="p-4 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3"><h3 className="font-medium text-sm">前置机到监测目标 · 延迟与丢包</h3>
          <select aria-label="监测目标" className="rounded-lg bg-default-100 text-foreground p-2 text-sm max-w-full" value={selectedTarget?.id || ""} onChange={e => setTarget(e.target.value)} disabled={!probes?.targets.length}>
            {!probes?.targets.length && <option value="">暂无监测目标</option>}{probes?.targets.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <p className="text-xs text-default-500">此处反映前置机到所选目标的 TCP 探测质量，不代表用户到节点或经落地出口的完整链路质量。</p>
        {historyLoading ? <Empty>正在加载探测数据…</Empty> : historyErrors.probes ? <Empty>{historyErrors.probes}</Empty> : probes && !probes.supported ? <Empty>当前节点版本不支持历史探测，请升级至 {probes.minVersion} 或更新版本。</Empty> : !probePoints.length ? <Empty>所选目标在该时段暂无探测记录，请检查监测目标配置。</Empty> : <>
          <div className="flex flex-wrap gap-3 text-sm"><span>最近延迟 <b>{latestProbe?.avg == null ? "无有效响应" : `${latestProbe.avg.toFixed(1)} ms`}</b></span><span>最近丢包 <b>{latestProbe?.loss == null ? "未知" : `${latestProbe.loss.toFixed(1)}%`}</b></span><span className="text-default-500">{time(latestProbe.ts)}{now - latestProbe.ts > 15 * 60_000 ? " · 数据已过时" : ""}</span></div>
          <div className="grid md:grid-cols-2 gap-4">{(["avg", "loss"] as const).map((field, index) => <div key={field} className="h-52 min-w-0">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={probePoints}>
              <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.15} /><XAxis dataKey="ts" tickFormatter={time} minTickGap={60} tick={{ fontSize: 11 }} /><YAxis domain={field === "loss" ? [0, 100] : [0, "auto"]} width={45} tick={{ fontSize: 11 }} />
              <Tooltip labelFormatter={v => time(Number(v))} formatter={v => `${v}${field === "loss" ? "%" : " ms"}`} contentStyle={tip} /><Legend />
              <Line dataKey={field} name={field === "loss" ? "丢包率 (%)" : "延迟 (ms)"} stroke={COLORS[index]} dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer>
          </div>)}</div>
        </>}
      </CardBody></Card>
    </section>

    <section className="space-y-3" aria-label="关联用户">
      <div className="flex flex-wrap justify-between gap-3 items-center"><h2 className="text-lg font-semibold">关联用户 <span className="text-default-400 text-sm font-normal">{data.users.length} 人</span></h2><Input aria-label="搜索关联用户" placeholder="搜索用户名或 ID" value={search} onValueChange={v => { setSearch(v); setPage(1); }} size="sm" className="max-w-xs" isClearable onClear={() => { setSearch(""); setPage(1); }} /></div>
      <Card><CardBody className="p-0"><div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap text-left">
        <thead className="bg-default-100 text-default-500"><tr>{["用户", "状态", "协议", "已用 / 配额", "剩余流量", "线路到期"].map(h => <th key={h} className="p-4 font-medium">{h}</th>)}</tr></thead>
        <tbody>{shownUsers.map(u => <tr key={u.id} className="border-t border-divider"><td className="p-4"><div className="font-medium">{u.name}</div><div className="text-xs text-default-400">ID {u.id}</div></td><td className="p-4"><Chip size="sm" variant="flat" color={state(u) === "正常" ? "success" : "warning"}>{state(u)}</Chip></td><td className="p-4">{u.protocolCount}</td><td className="p-4">{bytes(u.inFlow + u.outFlow)} / {u.quotaGb && u.quotaGb > 0 ? `${u.quotaGb} GB` : "不单独限额"}</td><td className="p-4">{u.quotaGb && u.quotaGb > 0 ? bytes(Math.max(0, u.quotaGb * GB - u.inFlow - u.outFlow)) : "受账号总额度约束"}</td><td className="p-4">{date(u.expTime)}</td></tr>)}</tbody>
      </table></div>{!filtered.length && <Empty>{data.users.length ? "没有匹配的用户" : "尚未分配用户，可返回线路列表进行分配。"}</Empty>}
        {pages > 1 && <div className="flex justify-end items-center gap-3 p-4"><Button size="sm" variant="flat" isDisabled={currentPage <= 1} onPress={() => setPage(currentPage - 1)}>上一页</Button><span className="text-xs">{currentPage} / {pages}</span><Button size="sm" variant="flat" isDisabled={currentPage >= pages} onPress={() => setPage(currentPage + 1)}>下一页</Button></div>}
      </CardBody></Card>
    </section>

    <section className="space-y-3" aria-label="一键诊断">
      <div className="flex justify-between items-center gap-3"><h2 className="text-lg font-semibold">一键诊断</h2>{running ? <Button size="sm" variant="flat" onPress={stop}>停止后续检测</Button> : <Button size="sm" color="primary" variant="flat" onPress={diagnose}>{results.length ? "重新诊断" : "开始诊断"}</Button>}</div>
      <Card><CardBody className="p-4 space-y-3">
        <p className="text-xs text-default-500">检查节点本地协议监听和可支持的落地连通性。不会修改配置。TCP 端口可连接不等于客户端认证、公网入口和 UDP 协议均正常；这些仍需客户端验证。</p>
        <div aria-live="polite" className="space-y-2">
          {!results.length && <Empty>点击“一键诊断”，逐项查看检测结果。</Empty>}
          {results.map(r => <div key={r.key} className="rounded-xl border border-divider p-3 flex items-start gap-3">
            <Chip size="sm" variant="flat" color={r.state === "passed" ? "success" : r.state === "failed" ? "danger" : r.state === "running" ? "primary" : "default"}>{stateText[r.state]}</Chip>
            <div className="min-w-0 text-sm"><div className="font-medium">{r.label}</div>{r.message && <p className="text-default-500 mt-1 break-words">{r.message}</p>}{(r.latencyMs != null || r.packetLoss != null) && <p className="text-xs text-default-400 mt-1">{r.latencyMs != null && `延迟 ${r.latencyMs} ms`}{r.packetLoss != null && ` · 探测失败率 ${r.packetLoss}%`}</p>}</div>
          </div>)}
        </div>
        {running && <p className="text-xs text-default-500">已完成 {results.filter(r => r.state !== "pending" && r.state !== "running").length} / {results.length} 项，请稍候…</p>}
        {diagnosedAt && <p className="text-xs text-default-500">检测完成于 {new Date(diagnosedAt).toLocaleTimeString("zh-CN")} · 通过 {results.filter(r => r.state === "passed").length} 项，失败 {results.filter(r => r.state === "failed").length} 项，其余请按提示验证。</p>}
      </CardBody></Card>
    </section>
  </div>;
}
