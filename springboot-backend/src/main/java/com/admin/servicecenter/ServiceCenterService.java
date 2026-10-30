package com.admin.servicecenter;

import com.admin.common.dto.InboundUserDto;
import com.admin.common.lang.R;
import com.admin.service.InboundService;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import javax.annotation.Resource;
import java.util.*;
import java.util.function.Supplier;

@Service
public class ServiceCenterService {
    @Resource private JdbcTemplate jdbc;
    @Resource private InboundService inboundService;
    @Resource private PlatformTransactionManager transactionManager;
    private static final long DAY = 86400000L, GB = 1024L * 1024 * 1024;
    private TransactionTemplate tx() { return new TransactionTemplate(transactionManager); }
    static long number(Object v) { return v == null ? 0 : ((Number) v).longValue(); }
    private static Long nullableId(Object v) { return v == null ? null : number(v); }
    private static String text(Object v) { return v == null ? "" : String.valueOf(v); }
    private static String route(long user, long node, Long landing) { return user + ":" + node + ":" + (landing == null ? 0 : landing); }
    private static String note(String n) { return n == null ? "" : n.trim(); }
    private List<Map<String,Object>> query(String sql, Object... args) { return jdbc.queryForList(sql, args); }
    private Map<String,Object> one(String sql, Object... args) { List<Map<String,Object>> r = query(sql, args); return r.isEmpty() ? null : r.get(0); }

    public R plans() {
        return R.ok(query("SELECT p.id,p.name,p.node_id nodeId,p.landing_id landingId,p.quota_gb quotaGb,p.duration_days durationDays,p.speed_id speedId,p.active,p.remark,p.version,n.name nodeName,l.name landingName,s.name speedName FROM service_plan p LEFT JOIN node n ON n.id=p.node_id LEFT JOIN landing l ON l.id=p.landing_id LEFT JOIN speed_limit s ON s.id=p.speed_id ORDER BY p.id DESC"));
    }
    public R catalog() {
        return R.ok(Map.of(
            "users",query("SELECT id,user name,status,exp_time expTime FROM user ORDER BY id DESC"),
            "routes",query("SELECT DISTINCT n.id nodeId,n.name nodeName,n.status,i.landing_id landingId,l.name landingName FROM inbound i JOIN node n ON n.id=i.node_id LEFT JOIN landing l ON l.id=i.landing_id WHERE i.status=1 ORDER BY n.id,i.landing_id"),
            "speeds",query("SELECT id,name,speed FROM speed_limit ORDER BY id DESC")));
    }
    public R reminders() {
        List<Map<String,Object>> all = lines(null,false);
        all.removeIf(row -> ((List<?>)row.get("warnings")).isEmpty());
        return R.ok(all);
    }
    public R savePlan(ServiceCenterRequest.Plan p) {
        if (p.getActive() == 1 && !routeAvailable(p.getNodeId(), p.getLandingId())) return R.err("目标线路不存在或没有启用的协议");
        if (p.getActive() == 1 && p.getSpeedId() != null && one("SELECT id FROM speed_limit WHERE id=?", p.getSpeedId()) == null) return R.err("限速规则不存在");
        long now = System.currentTimeMillis();
        if (p.getId() == null) {
            jdbc.update("INSERT INTO service_plan(name,node_id,landing_id,quota_gb,duration_days,speed_id,active,remark,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    p.getName().trim(),p.getNodeId(),p.getLandingId(),p.getQuotaGb(),p.getDurationDays(),p.getSpeedId(),p.getActive(),note(p.getRemark()),now,now);
        } else {
            if (p.getVersion() == null) return R.err("请刷新模板后再编辑");
            int n = jdbc.update("UPDATE service_plan SET name=?,node_id=?,landing_id=?,quota_gb=?,duration_days=?,speed_id=?,active=?,remark=?,updated_at=?,version=version+1 WHERE id=? AND version=?",
                    p.getName().trim(),p.getNodeId(),p.getLandingId(),p.getQuotaGb(),p.getDurationDays(),p.getSpeedId(),p.getActive(),note(p.getRemark()),now,p.getId(),p.getVersion());
            if (n == 0) return R.err(409,"模板已被修改，请刷新后重试");
        }
        return R.ok();
    }
    private boolean routeAvailable(Long node, Long landing) {
        return number(jdbc.queryForObject("SELECT COUNT(*) FROM inbound i JOIN node n ON n.id=i.node_id LEFT JOIN landing l ON l.id=i.landing_id WHERE i.node_id=? AND COALESCE(i.landing_id,0)=COALESCE(?,0) AND i.status=1 AND (i.landing_id IS NULL OR l.status=1)",Long.class,node,landing)) > 0;
    }
    private Map<String,Object> line(Long user, Long node, Long landing) {
        return one("SELECT id,user_id userId,node_id nodeId,landing_id landingId,flow quotaGb,exp_time expTime,status FROM inbound_line WHERE user_id=? AND node_id=? AND COALESCE(landing_id,0)=COALESCE(?,0) ORDER BY id DESC LIMIT 1",user,node,landing);
    }
    private String snapshot(Map<String,Object> line) {
        if (line == null) return "{}";
        Map<String,Object> s = new LinkedHashMap<>();
        for (String k : List.of("quotaGb","expTime","status")) s.put(k,line.get(k));
        return JSON.toJSONString(s);
    }
    private record Outcome(String status, String message) {}

    /** Durable idempotency + cross-process route lock. Remote calls do not hold a DB transaction. */
    private R operation(long actor, long user, long node, Long landing, String key, String kind, Long planId,
                        String planName, String payload, String note, Supplier<Outcome> execute) {
        Map<String,Object> existing = one("SELECT actor_id actorId,payload FROM service_action WHERE request_key=?",key);
        if (existing != null) {
            if (number(existing.get("actorId")) != actor || !payload.equals(existing.get("payload"))) return R.err(409,"操作编号已使用，请刷新页面");
            return action(key);
        }
        try {
            tx().executeWithoutResult(s -> {
                jdbc.update("INSERT INTO service_operation_lock(route_key,request_key,created_at) VALUES(?,?,?)",route(user,node,landing),key,System.currentTimeMillis());
                jdbc.update("INSERT INTO service_action(request_key,actor_id,user_id,node_id,landing_id,plan_id,plan_name,action_type,status,note,payload,before_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        key,actor,user,node,landing,planId,planName,kind,"running",note,payload,snapshot(line(user,node,landing)),System.currentTimeMillis());
            });
        } catch (DuplicateKeyException e) { return R.err(409,"该线路已有处理中操作，请查看操作记录后再试"); }
        Outcome result;
        try { result = execute.get(); }
        catch (Exception e) { result = new Outcome("partial","执行中断，可能已有部分变更。请核对线路和节点状态，不要直接重复提交"); }
        Outcome finalResult = result;
        tx().executeWithoutResult(s -> {
            jdbc.update("UPDATE service_action SET status=?,message=?,after_json=?,finished_at=? WHERE request_key=?",
                    finalResult.status(),finalResult.message(),snapshot(line(user,node,landing)),System.currentTimeMillis(),key);
            jdbc.update("DELETE FROM service_operation_lock WHERE request_key=?",key);
        });
        return action(key);
    }
    private R action(String key) {
        return R.ok(one("SELECT id,request_key requestKey,status,message,action_type actionType,created_at createdAt,finished_at finishedAt FROM service_action WHERE request_key=?",key));
    }

    public R assign(long actor, ServiceCenterRequest.Assign r) {
        Map<String,Object> p = one("SELECT * FROM service_plan WHERE id=?",r.getPlanId());
        if (p == null) return R.err("套餐模板不存在");
        long node = number(p.get("node_id")); Long landing = nullableId(p.get("landing_id"));
        String payload = "assign:" + JSON.toJSONString(r);
        return operation(actor,r.getUserId(),node,landing,r.getRequestKey(),"assign",r.getPlanId(),text(p.get("name")),payload,note(r.getNote()),() -> {
            if (number(p.get("version")) != r.getPlanVersion() || number(p.get("active")) != 1) return new Outcome("failed","模板已变更或停用，请刷新后重新选择");
            Map<String,Object> user = one("SELECT id,status,exp_time FROM user WHERE id=?",r.getUserId());
            if (user == null || number(user.get("status")) != 1 || (number(user.get("exp_time")) > 0 && number(user.get("exp_time")) <= System.currentTimeMillis())) return new Outcome("failed","用户不存在、已停用或账号已到期，请先在用户管理处理");
            if (line(r.getUserId(),node,landing) != null || number(jdbc.queryForObject("SELECT COUNT(*) FROM inbound_user iu JOIN inbound i ON i.id=iu.inbound_id WHERE iu.user_id=? AND i.node_id=? AND COALESCE(i.landing_id,0)=COALESCE(?,0)",Long.class,r.getUserId(),node,landing)) > 0)
                return new Outcome("skipped","用户已有这条线路，已跳过，原配额和订阅保持不变");
            if (!routeAvailable(node,landing)) return new Outcome("failed","线路不存在或没有启用的协议");
            Map<String,Object> n = one("SELECT status FROM node WHERE id=?",node);
            if (n == null || number(n.get("status")) != 1) return new Outcome("failed","前置机离线，未执行分配");
            if (p.get("speed_id") != null && number(jdbc.queryForObject("SELECT COUNT(*) FROM inbound_line WHERE user_id=? AND node_id=?",Long.class,r.getUserId(),node)) > 0)
                return new Outcome("failed","同用户在该机已有其他线路；为避免改动共享限速，请使用不设置限速的模板");
            InboundUserDto dto = new InboundUserDto(); dto.setUserId(r.getUserId()); dto.setNodeId(node);
            dto.setLandingId(landing); dto.setRelay(landing != null); dto.setFlow(number(p.get("quota_gb")));
            dto.setExpTime(System.currentTimeMillis()+number(p.get("duration_days"))*DAY);
            dto.setSpeedId(p.get("speed_id") == null ? null : ((Number)p.get("speed_id")).intValue());
            R assigned = inboundService.assignAllToUser(dto);
            JSONObject data = assigned.getData() == null ? new JSONObject() : (JSONObject) JSON.toJSON(assigned.getData());
            if (assigned.getCode() != 0 || data.getString("firstError") != null) return new Outcome("partial","分配未全部完成，请到线路详情核对协议和转发；已有记录不会自动删除");
            R pushed = inboundService.pushNodeConfig(node);
            return pushed.getCode() == 0 ? new Outcome("completed","套餐已分配，节点配置已下发") : new Outcome("partial","套餐已保存，节点配置下发失败，请在协议管理重新下发配置");
        });
    }

    public R renew(long actor, ServiceCenterRequest.Renew r) {
        String payload = "renew:" + JSON.toJSONString(r);
        return operation(actor,r.getUserId(),r.getNodeId(),r.getLandingId(),r.getRequestKey(),"renew",null,null,payload,note(r.getNote()),() -> {
            Map<String,Object> before = line(r.getUserId(),r.getNodeId(),r.getLandingId());
            if (before == null) return new Outcome("failed","线路不存在");
            if (r.getRenewalRequestId() != null) {
                Map<String,Object> request = one("SELECT user_id,node_id,landing_id,status FROM service_renewal_request WHERE id=?",r.getRenewalRequestId());
                if (request == null || !"pending".equals(request.get("status")) || number(request.get("user_id")) != r.getUserId() || number(request.get("node_id")) != r.getNodeId() || !Objects.equals(nullableId(request.get("landing_id")),r.getLandingId()))
                    return new Outcome("failed","续期申请已处理或不属于该用户线路");
            }
            RenewalPolicy.Target target;
            try { target = RenewalPolicy.calculate(nullableId(before.get("quotaGb")),nullableId(before.get("expTime")),r.getDays(),r.getQuotaMode(),r.getQuotaGb(),System.currentTimeMillis()); }
            catch (IllegalArgumentException | ArithmeticException e) { return new Outcome("failed",e.getMessage()); }
            R updated = inboundService.updateLine(r.getUserId(),r.getNodeId(),r.getLandingId(),target.quotaGb(),target.expTime(),null);
            if (updated.getCode() != 0) return new Outcome("partial","更新未完整完成，请核对线路额度、到期和节点状态");
            JSONObject data = updated.getData() == null ? new JSONObject() : (JSONObject) JSON.toJSON(updated.getData());
            boolean partial = data.getIntValue("syncErrors") > 0;
            if (r.getRenewalRequestId() != null) jdbc.update("UPDATE service_renewal_request SET status='handled',pending_key=NULL,response=?,handled_by=?,updated_at=? WHERE id=? AND status='pending'",
                    partial ? "续期额度和时间已保存，节点同步待管理员确认" : "人工续期已完成，请刷新订阅。账号总额度及账号状态仍独立生效",actor,System.currentTimeMillis(),r.getRenewalRequestId());
            return new Outcome(partial ? "partial" : "completed",partial ? "额度和到期已保存，部分节点同步失败，请勿重复增加天数" : "续期已保存，订阅链接和已用流量保持不变；账号总额度及账号状态仍独立生效");
        });
    }

    /** Fixed-number batch reads, never serialize credential-bearing entities. */
    public List<Map<String,Object>> lines(Long userId, boolean tokens) {
        String filter = userId == null ? "" : " WHERE il.user_id=?";
        Object[] args = userId == null ? new Object[]{} : new Object[]{userId};
        List<Map<String,Object>> rows = query("SELECT il.id,il.user_id userId,u.user userName,il.node_id nodeId,n.name nodeName,il.landing_id landingId,l.name landingName,il.flow quotaGb,il.exp_time expTime,il.status lineStatus,u.status accountStatus,u.exp_time accountExpTime" +
                (tokens ? ",il.sub_token subToken" : "") + " FROM inbound_line il LEFT JOIN user u ON u.id=il.user_id LEFT JOIN node n ON n.id=il.node_id LEFT JOIN landing l ON l.id=il.landing_id"+filter+" ORDER BY il.id DESC",args);
        if (rows.isEmpty()) return rows;
        Map<String,Long> usage = new HashMap<>();
        String usageFilter = userId == null ? "" : " AND iu.user_id=?";
        for (Map<String,Object> f : query("SELECT DISTINCT iu.user_id userId,i.node_id nodeId,i.landing_id landingId,f.id,COALESCE(f.in_flow,0)+COALESCE(f.out_flow,0) used FROM inbound_user iu JOIN inbound i ON i.id=iu.inbound_id JOIN forward f ON f.id=iu.gost_forward_id AND f.user_id=iu.user_id WHERE 1=1"+usageFilter,args))
            usage.merge(route(number(f.get("userId")),number(f.get("nodeId")),nullableId(f.get("landingId"))),number(f.get("used")),Long::sum);
        Map<String,Integer> protocols = new HashMap<>();
        for (Map<String,Object> f : query("SELECT iu.user_id userId,i.node_id nodeId,i.landing_id landingId,COUNT(DISTINCT i.id) protocolCount FROM inbound_user iu JOIN inbound i ON i.id=iu.inbound_id WHERE 1=1"+usageFilter+" GROUP BY iu.user_id,i.node_id,i.landing_id",args))
            protocols.put(route(number(f.get("userId")),number(f.get("nodeId")),nullableId(f.get("landingId"))),(int)number(f.get("protocolCount")));
        long now = System.currentTimeMillis();
        for (Map<String,Object> row : rows) {
            String key = route(number(row.get("userId")),number(row.get("nodeId")),nullableId(row.get("landingId")));
            long used = usage.getOrDefault(key,0L), quota = number(row.get("quotaGb")), expiry = number(row.get("expTime"));
            row.put("usedBytes",used); row.put("protocolCount",protocols.getOrDefault(key,0));
            List<String> warnings = new ArrayList<>();
            if (row.get("userName") == null) warnings.add("账号已删除");
            else if (number(row.get("accountStatus")) != 1) warnings.add("账号已停用");
            if (number(row.get("accountExpTime")) > 0 && number(row.get("accountExpTime")) <= now) warnings.add("账号已到期");
            if (row.get("nodeName") == null || (row.get("landingId") != null && row.get("landingName") == null)) warnings.add("线路资源已删除");
            if (number(row.get("lineStatus")) == 0) warnings.add("线路已停用");
            if (expiry > 0 && expiry <= now) warnings.add("线路已到期");
            else if (expiry > 0 && expiry <= now+7*DAY) warnings.add("线路将在7天内到期");
            if (quota > 0 && used >= quota*GB) warnings.add("线路流量已用完");
            else if (quota > 0 && used >= quota*GB*0.8) warnings.add("线路流量已使用80%以上");
            row.put("warnings",warnings);
        }
        return rows;
    }
    public R self(long user) {
        Map<String,Object> account = one("SELECT id,user name,status,exp_time expTime,flow quotaGb,COALESCE(in_flow,0)+COALESCE(out_flow,0) usedBytes FROM user WHERE id=?",user);
        if (account == null) return R.err(401,"账号不存在，请重新登录");
        R legacy = inboundService.getUserLines(user);
        JSONObject subscriptions = legacy.getCode() == 0 && legacy.getData() != null ? (JSONObject)JSON.toJSON(legacy.getData()) : new JSONObject();
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("account",account); out.put("lines",lines(user,true)); out.put("allSubToken",subscriptions.getString("allSubToken"));
        out.put("requests",requests(user)); out.put("history",history(user,1,false)); out.put("updatedAt",System.currentTimeMillis());
        return R.ok(out);
    }
    public List<Map<String,Object>> requests(Long user) {
        String where = user == null ? "" : " WHERE r.user_id=?";
        return query("SELECT r.id,r.user_id userId,u.user userName,r.node_id nodeId,n.name nodeName,r.landing_id landingId,l.name landingName,r.status,r.message,r.response,r.created_at createdAt,r.updated_at updatedAt FROM service_renewal_request r LEFT JOIN user u ON u.id=r.user_id LEFT JOIN node n ON n.id=r.node_id LEFT JOIN landing l ON l.id=r.landing_id"+where+" ORDER BY (r.status='pending') DESC,r.id DESC LIMIT 200",user == null ? new Object[]{} : new Object[]{user});
    }
    public R requestRenewal(long user, ServiceCenterRequest.RenewalRequest r) {
        if (line(user,r.getNodeId(),r.getLandingId()) == null) return R.err(404,"该线路不属于当前账号");
        String key = route(user,r.getNodeId(),r.getLandingId());
        try {
            long now=System.currentTimeMillis();
            jdbc.update("INSERT INTO service_renewal_request(user_id,node_id,landing_id,pending_key,message,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",user,r.getNodeId(),r.getLandingId(),key,note(r.getMessage()),now,now);
        } catch (DuplicateKeyException e) { return R.err(409,"已有待处理申请，请等待管理员处理"); }
        return R.ok();
    }
    public R reject(long actor, ServiceCenterRequest.Resolve r) {
        Map<String,Object> request = one("SELECT * FROM service_renewal_request WHERE id=?",r.getId());
        if (request == null) return R.err(404,"申请不存在");
        // Do not race an in-flight renewal for the same route.
        String key = route(number(request.get("user_id")),number(request.get("node_id")),nullableId(request.get("landing_id")));
        return tx().execute(s -> {
            try { jdbc.update("INSERT INTO service_operation_lock(route_key,request_key,created_at) VALUES(?,?,?)",key,UUID.randomUUID().toString(),System.currentTimeMillis()); }
            catch (DuplicateKeyException e) { return R.err(409,"该线路正在处理，请稍后再试"); }
            int n=jdbc.update("UPDATE service_renewal_request SET status='rejected',pending_key=NULL,response=?,handled_by=?,updated_at=? WHERE id=? AND status='pending'",note(r.getResponse()),actor,System.currentTimeMillis(),r.getId());
            jdbc.update("DELETE FROM service_operation_lock WHERE route_key=?",key);
            return n == 1 ? R.ok() : R.err(409,"申请已处理，请刷新");
        });
    }
    public List<Map<String,Object>> history(Long user, int page, boolean admin) {
        String where = user == null ? "" : " WHERE a.user_id=?";
        List<Object> args = new ArrayList<>(); if(user != null) args.add(user); args.add((Math.min(page,10000)-1)*50);
        return query("SELECT a.id,a.user_id userId,u.user userName,a.node_id nodeId,n.name nodeName,a.landing_id landingId,l.name landingName,a.plan_name planName,a.action_type actionType,a.status,a.message,a.before_json beforeJson,a.after_json afterJson,a.created_at createdAt,a.finished_at finishedAt"+
                (admin ? ",a.note,a.actor_id actorId,actor.user actorName" : "")+
                " FROM service_action a LEFT JOIN user u ON u.id=a.user_id LEFT JOIN node n ON n.id=a.node_id LEFT JOIN landing l ON l.id=a.landing_id LEFT JOIN user actor ON actor.id=a.actor_id"+where+" ORDER BY a.id DESC LIMIT 50 OFFSET ?",args.toArray());
    }
}
