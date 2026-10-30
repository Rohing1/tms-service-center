package com.admin.service;

import com.admin.common.dto.GostDto;
import com.admin.common.lang.R;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.mapper.*;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Read-only, administrator-facing view of a node + landing route. Never returns credentials. */
@Service
public class LineDetailService {
    @Resource private NodeMapper nodeMapper;
    @Resource private LandingMapper landingMapper;
    @Resource private InboundMapper inboundMapper;
    @Resource private InboundUserMapper inboundUserMapper;
    @Resource private InboundLineMapper inboundLineMapper;
    @Resource private ForwardMapper forwardMapper;
    @Resource private UserMapper userMapper;
    @Resource private LandingService landingService;

    public record NodeInfo(Long id, String name, String address, Integer status, Boolean singboxRunning) {}
    public record LandingInfo(Long id, String name, String type, Integer status) {}
    public record ProtocolInfo(Long id, String protocol, Integer status) {}
    public record UserInfo(Long id, String name, Integer accountStatus, Long accountExpTime,
                           Integer lineStatus, Long quotaGb, Long expTime, int protocolCount,
                           int missingForwards, long inFlow, long outFlow) {}
    public record Detail(NodeInfo node, LandingInfo landing, List<ProtocolInfo> protocols,
                         List<UserInfo> users, long inFlow, long outFlow, long updatedAt) {}
    public record Check(String state, String message, Double latencyMs, Double packetLoss, long timestamp) {}

    private static <T> QueryWrapper<T> route(Long nodeId, Long landingId) {
        QueryWrapper<T> q = new QueryWrapper<T>().eq("node_id", nodeId);
        return landingId == null ? q.isNull("landing_id") : q.eq("landing_id", landingId);
    }

    private List<Inbound> inbounds(Long nodeId, Long landingId) {
        return inboundMapper.selectList(LineDetailService.<Inbound>route(nodeId, landingId).orderByAsc("id"));
    }

    public R detail(Long nodeId, Long landingId) {
        Node node = nodeMapper.selectById(nodeId);
        if (node == null) return R.err(404, "前置机不存在");
        Landing landing = landingId == null ? null : landingMapper.selectById(landingId);
        if (landingId != null && landing == null) return R.err(404, "落地不存在");
        List<Inbound> ins = inbounds(nodeId, landingId);
        if (ins.isEmpty()) return R.err(404, "线路不存在或已删除");

        List<Long> inboundIds = ins.stream().map(Inbound::getId).collect(Collectors.toList());
        List<InboundUser> assignments = inboundUserMapper.selectList(new QueryWrapper<InboundUser>()
                .select("id", "inbound_id", "user_id", "gost_forward_id", "status")
                .in("inbound_id", inboundIds).orderByAsc("id"));
        // Include stopped lines and lines whose forward records are missing; do not silently hide faults.
        List<InboundLine> lines = inboundLineMapper.selectList(LineDetailService.<InboundLine>route(nodeId, landingId)
                .select("id", "user_id", "flow", "exp_time", "status").orderByAsc("id"));
        Set<Long> userIds = new LinkedHashSet<>();
        lines.forEach(l -> userIds.add(l.getUserId()));
        assignments.forEach(a -> userIds.add(a.getUserId()));
        userIds.remove(null);
        Set<Long> forwardIds = assignments.stream().map(InboundUser::getGostForwardId)
                .filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, Forward> forwards = forwardIds.isEmpty() ? Map.of() : forwardMapper.selectList(
                new QueryWrapper<Forward>().select("id", "user_id", "in_flow", "out_flow").in("id", forwardIds))
                .stream().collect(Collectors.toMap(Forward::getId, Function.identity()));
        Map<Long, User> users = userIds.isEmpty() ? Map.of() : userMapper.selectList(
                new QueryWrapper<User>().select("id", "user", "status", "exp_time").in("id", userIds))
                .stream().collect(Collectors.toMap(User::getId, Function.identity()));
        Map<Long, InboundLine> byUser = new HashMap<>();
        lines.forEach(l -> byUser.put(l.getUserId(), l));
        Map<Long, List<InboundUser>> assigned = assignments.stream().filter(a -> a.getUserId() != null)
                .collect(Collectors.groupingBy(InboundUser::getUserId));
        List<UserInfo> rows = new ArrayList<>();
        long totalIn = 0, totalOut = 0;
        for (Long id : userIds) {
            Set<Long> counted = new HashSet<>();
            Set<Long> protocols = new HashSet<>();
            int missing = 0;
            long in = 0, out = 0;
            for (InboundUser a : assigned.getOrDefault(id, List.of())) {
                protocols.add(a.getInboundId());
                Forward f = forwards.get(a.getGostForwardId());
                if (f == null || f.getUserId() == null || f.getUserId().longValue() != id) {
                    missing++;
                } else if (counted.add(f.getId())) {
                    in += f.getInFlow() == null ? 0 : f.getInFlow();
                    out += f.getOutFlow() == null ? 0 : f.getOutFlow();
                }
            }
            User u = users.get(id);
            InboundLine l = byUser.get(id);
            rows.add(new UserInfo(id, u == null ? "已删除用户 #" + id : u.getUser(),
                    u == null ? null : u.getStatus(), u == null ? null : u.getExpTime(),
                    l == null ? null : l.getStatus(), l == null ? null : l.getFlow(),
                    l == null ? null : l.getExpTime(), protocols.size(), missing, in, out));
            totalIn += in;
            totalOut += out;
        }
        return R.ok(new Detail(new NodeInfo(nodeId, node.getName(),
                node.getDomain() == null || node.getDomain().isBlank() ? node.getServerIp() : node.getDomain(),
                node.getStatus(), WebSocketServer.getSingboxRunning(nodeId)),
                landing == null ? null : new LandingInfo(landingId, landing.getName(), landing.getType(), landing.getStatus()),
                ins.stream().map(i -> new ProtocolInfo(i.getId(), i.getProtocol(), i.getStatus())).collect(Collectors.toList()),
                rows, totalIn, totalOut, System.currentTimeMillis()));
    }

    private static R check(String state, String message, Double latency, Double loss) {
        return R.ok(new Check(state, message, latency, loss, System.currentTimeMillis()));
    }

    /** One bounded check per request so the UI can display progress without a long blocking batch. */
    public R diagnose(Long nodeId, Long landingId, Long inboundId, String kind) {
        Node node = nodeMapper.selectById(nodeId);
        if (node == null) return R.err(404, "前置机不存在");
        List<Inbound> ins = inbounds(nodeId, landingId);
        if (ins.isEmpty()) return R.err(404, "线路不存在或已删除");
        if (!Objects.equals(node.getStatus(), 1)) return check("failed", "前置机离线，请先恢复节点连接", null, null);
        if ("landing".equals(kind)) {
            if (landingId == null) return R.err("直连线路没有独立落地");
            Landing l = landingMapper.selectById(landingId);
            if (l == null) return R.err(404, "落地不存在");
            if (!Objects.equals(l.getStatus(), 1)) return check("failed", "落地已停用", null, null);
            R result = landingService.testLanding(nodeId, l.getLink());
            if (result.getCode() != 0) return check("failed", "落地检测失败，请检查出口连接及节点日志", null, null);
            JSONObject data = (JSONObject) JSONObject.toJSON(result.getData());
            if (data == null) return check("unknown", "落地未返回检测结果", null, null);
            if (data.getBooleanValue("skipped")) return check("skipped", "该类型落地暂不支持在线测试，需使用客户端验证", null, null);
            return check(data.getBooleanValue("ok") ? "passed" : "failed",
                    data.getBooleanValue("ok") ? "前置机经落地访问测试目标成功" : "落地连通性测试失败",
                    data.getDouble("latencyMs"), null);
        }
        if (!"protocol".equals(kind)) return R.err("未知诊断类型");
        Inbound in = ins.stream().filter(i -> Objects.equals(i.getId(), inboundId)).findFirst().orElse(null);
        if (in == null) return R.err(404, "协议不属于当前线路");
        if (!Objects.equals(in.getStatus(), 1)) return check("failed", "协议已停用", null, null);
        if (Boolean.FALSE.equals(WebSocketServer.getSingboxRunning(nodeId)))
            return check("failed", "sing-box 未运行，请检查节点服务", null, null);
        if ("hysteria2".equals(in.getProtocol()) || "tuic".equals(in.getProtocol()))
            return check("skipped", "UDP 协议需通过客户端握手验证，当前 TCP 检测不适用", null, null);
        if (in.getListenPort() == null) return check("failed", "协议监听端口未配置", null, null);
        JSONObject payload = new JSONObject();
        payload.put("ip", "127.0.0.1");
        payload.put("port", in.getListenPort());
        payload.put("count", 2);
        payload.put("timeout", 3000);
        GostDto response = WebSocketServer.send_msg(nodeId, payload, "TcpPing");
        if (response == null || !"OK".equals(response.getMsg()))
            return check("failed", "节点未完成检测，请检查连接或稍后重试", null, null);
        JSONObject data = (JSONObject) JSONObject.toJSON(response.getData());
        if (data == null || !data.containsKey("success")) return check("unknown", "节点未返回有效检测结果", null, null);
        boolean ok = data.getBooleanValue("success");
        return check(ok ? "passed" : "failed", ok ? "节点本地协议 TCP 端口可连接" : "节点本地协议 TCP 端口连接失败",
                ok ? data.getDouble("averageTime") : null, data.getDouble("packetLoss"));
    }
}
