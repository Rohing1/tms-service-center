package com.admin.servicecenter;

import com.admin.common.lang.R;
import com.admin.service.InboundService;
import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Actual SQL/transaction tests against a disposable in-memory database. Never loads application.yml. */
class ServiceCenterServiceTest {
    JdbcTemplate jdbc;
    ServiceCenterService service;
    InboundService inbound;
    long expiry;
    @BeforeEach void setup() {
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;NON_KEYWORDS=USER;DB_CLOSE_DELAY=-1","sa","");
        jdbc=new JdbcTemplate(ds);
        for(String sql:List.of(
            "CREATE TABLE user(id BIGINT PRIMARY KEY,user VARCHAR(50),status INT,exp_time BIGINT,flow BIGINT,in_flow BIGINT,out_flow BIGINT)",
            "CREATE TABLE node(id BIGINT PRIMARY KEY,name VARCHAR(50),status INT)",
            "CREATE TABLE landing(id BIGINT PRIMARY KEY,name VARCHAR(50),status INT)",
            "CREATE TABLE speed_limit(id BIGINT PRIMARY KEY,name VARCHAR(50),speed INT)",
            "CREATE TABLE inbound(id BIGINT PRIMARY KEY,node_id BIGINT,landing_id BIGINT,status INT)",
            "CREATE TABLE inbound_line(id BIGINT PRIMARY KEY AUTO_INCREMENT,user_id BIGINT,node_id BIGINT,landing_id BIGINT,flow BIGINT,exp_time BIGINT,status INT,sub_token VARCHAR(64))",
            "CREATE TABLE inbound_user(id BIGINT PRIMARY KEY,user_id BIGINT,inbound_id BIGINT,gost_forward_id BIGINT)",
            "CREATE TABLE forward(id BIGINT PRIMARY KEY,user_id BIGINT,in_flow BIGINT,out_flow BIGINT)")) jdbc.execute(sql);
        for(String sql:ServiceCenterSchema.DDL)jdbc.execute(sql);
        jdbc.update("INSERT INTO user VALUES(1,'alice',1,0,500,0,0),(2,'bob',1,0,500,0,0),(9,'admin',1,0,500,0,0)");
        jdbc.update("INSERT INTO node VALUES(10,'entry',1)");
        jdbc.update("INSERT INTO landing VALUES(20,'exit',1)");
        jdbc.update("INSERT INTO inbound VALUES(100,10,NULL,1),(101,10,20,1)");
        expiry=System.currentTimeMillis()+10*86400000L;
        jdbc.update("INSERT INTO inbound_line(user_id,node_id,landing_id,flow,exp_time,status,sub_token) VALUES(1,10,NULL,100,?,0,'alice-token'),(2,10,20,200,?,1,'bob-token')",expiry,expiry);
        jdbc.update("INSERT INTO forward VALUES(1000,1,1024,2048),(1001,2,9999,1111)");
        jdbc.update("INSERT INTO inbound_user VALUES(1,1,100,1000),(2,1,100,1000),(3,2,101,1001)");
        inbound=mock(InboundService.class);service=new ServiceCenterService();
        ReflectionTestUtils.setField(service,"jdbc",jdbc);
        ReflectionTestUtils.setField(service,"inboundService",inbound);
        ReflectionTestUtils.setField(service,"transactionManager",new DataSourceTransactionManager(ds));
    }
    private ServiceCenterRequest.Renew renewal(String key) {
        var r=new ServiceCenterRequest.Renew();r.setRequestKey(key);r.setUserId(1L);r.setNodeId(10L);
        r.setDays(30);r.setQuotaMode("add");r.setQuotaGb(50L);r.setNote("internal operator note");return r;
    }
    private void successfulRenewal() {
        when(inbound.updateLine(eq(1L),eq(10L),isNull(),anyLong(),anyLong(),isNull())).thenAnswer(call->{
            jdbc.update("UPDATE inbound_line SET flow=?,exp_time=?,status=1 WHERE user_id=1",new Object[]{call.getArgument(3),call.getArgument(4)});
            return R.ok(Map.of("syncErrors",0));
        });
    }
    @Test void renewalIsIdempotentAndRetainsTokensUsageAndOtherUsers() {
        successfulRenewal();var r=renewal("renewal-idempotent-001");
        assertEquals(0,service.renew(9,r).getCode());assertEquals(0,service.renew(9,r).getCode());
        verify(inbound,times(1)).updateLine(anyLong(),anyLong(),isNull(),anyLong(),anyLong(),isNull());
        assertEquals(expiry+30*86400000L,jdbc.queryForObject("SELECT exp_time FROM inbound_line WHERE user_id=1",Long.class));
        assertEquals(150,jdbc.queryForObject("SELECT flow FROM inbound_line WHERE user_id=1",Long.class));
        assertEquals("alice-token",jdbc.queryForObject("SELECT sub_token FROM inbound_line WHERE user_id=1",String.class));
        assertEquals(1024,jdbc.queryForObject("SELECT in_flow FROM forward WHERE id=1000",Long.class));
        assertEquals(200,jdbc.queryForObject("SELECT flow FROM inbound_line WHERE user_id=2",Long.class));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM service_action",Integer.class));
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM service_operation_lock",Integer.class));
        r.setDays(60);assertEquals(409,service.renew(9,r).getCode());
    }
    @Test void activeRouteLockBlocksAnotherRenewal() {
        jdbc.update("INSERT INTO service_operation_lock VALUES('1:10:0','existing-operation',?)",System.currentTimeMillis());
        assertEquals(409,service.renew(9,renewal("another-operation-001")).getCode());verifyNoInteractions(inbound);
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM service_action",Integer.class));
    }
    @Test void failedRemoteOperationIsRecordedAsPartialWithoutAutomaticRetry() {
        when(inbound.updateLine(anyLong(),anyLong(),isNull(),anyLong(),anyLong(),isNull())).thenThrow(new RuntimeException("private-credentials-must-not-leak"));
        var r=renewal("partial-operation-001");service.renew(9,r);service.renew(9,r);
        assertEquals("partial",jdbc.queryForObject("SELECT status FROM service_action",String.class));
        assertFalse(jdbc.queryForObject("SELECT message FROM service_action",String.class).contains("private-credentials"));
        verify(inbound,times(1)).updateLine(anyLong(),anyLong(),isNull(),anyLong(),anyLong(),isNull());
    }
    @Test void selfViewIncludesStoppedLinesButNeverAnotherUsersTokensOrInternalNotes() {
        successfulRenewal();service.renew(9,renewal("self-history-operation"));
        jdbc.update("UPDATE inbound_line SET status=0 WHERE user_id=1");
        when(inbound.getUserLines(1L)).thenReturn(R.ok(new JSONObject(Map.of("allSubToken","alice-all-token"))));
        Map<?,?> result=(Map<?,?>)service.self(1).getData();
        List<?> lines=(List<?>)result.get("lines");assertEquals(1,lines.size());
        Map<?,?> line=(Map<?,?>)lines.get(0);assertEquals(3072L,ServiceCenterService.number(line.get("usedBytes")));
        assertEquals("alice-token",line.get("subToken"));assertTrue(((List<?>)line.get("warnings")).contains("线路已停用"));
        String json=JSONObject.toJSONString(result);assertFalse(json.contains("bob-token"));assertFalse(json.contains("internal operator note"));
        assertFalse(service.lines(1L,false).get(0).containsKey("subToken"));
    }
    @Test void renewalRequestsEnforceOwnershipAndDeduplicatePendingRequests() {
        var request=new ServiceCenterRequest.RenewalRequest();request.setNodeId(10L);request.setLandingId(20L);
        assertEquals(404,service.requestRenewal(1,request).getCode());
        request.setLandingId(null);assertEquals(0,service.requestRenewal(1,request).getCode());assertEquals(409,service.requestRenewal(1,request).getCode());
        assertEquals(1,service.requests(1L).size());assertTrue(service.requests(2L).isEmpty());
        var reply=new ServiceCenterRequest.Resolve();reply.setId(ServiceCenterService.number(service.requests(1L).get(0).get("id")));reply.setResponse("请联系管理员确认需求");
        assertEquals(0,service.reject(9,reply).getCode());assertEquals(409,service.reject(9,reply).getCode());
        assertEquals(0,service.requestRenewal(1,request).getCode());
    }
    @Test void processingRequestCannotBeRejectedConcurrently() {
        var r=new ServiceCenterRequest.RenewalRequest();r.setNodeId(10L);service.requestRenewal(1,r);
        jdbc.update("INSERT INTO service_operation_lock VALUES('1:10:0','active-renewal',?)",System.currentTimeMillis());
        var reply=new ServiceCenterRequest.Resolve();reply.setId(1L);reply.setResponse("no");
        assertEquals(409,service.reject(9,reply).getCode());assertEquals("pending",service.requests(1L).get(0).get("status"));
    }
    @Test void processingAnApplicationClosesItAndCannotExtendTwiceWithAnotherKey() {
        successfulRenewal();
        var request=new ServiceCenterRequest.RenewalRequest();request.setNodeId(10L);service.requestRenewal(1,request);
        var renewal=renewal("handle-application-001");renewal.setRenewalRequestId(1L);
        service.renew(9,renewal);
        assertEquals("handled",service.requests(1L).get(0).get("status"));
        assertNull(jdbc.queryForObject("SELECT pending_key FROM service_renewal_request WHERE id=1",String.class));
        renewal.setRequestKey("handle-application-002");service.renew(9,renewal);
        verify(inbound,times(1)).updateLine(anyLong(),anyLong(),isNull(),anyLong(),anyLong(),isNull());
        assertEquals("failed",jdbc.queryForObject("SELECT status FROM service_action WHERE request_key='handle-application-002'",String.class));
        assertEquals(expiry+30*86400000L,jdbc.queryForObject("SELECT exp_time FROM inbound_line WHERE user_id=1",Long.class));
    }
    private ServiceCenterRequest.Plan plan() {
        var p=new ServiceCenterRequest.Plan();p.setName("monthly");p.setNodeId(10L);p.setQuotaGb(100L);p.setDurationDays(30);p.setActive(1);return p;
    }
    @Test void plansUseOptimisticVersionAndExistingLinesAreSkipped() {
        var p=plan();assertEquals(0,service.savePlan(p).getCode());p.setId(1L);p.setVersion(1);p.setQuotaGb(500L);
        assertEquals(0,service.savePlan(p).getCode());assertEquals(409,service.savePlan(p).getCode());
        var a=new ServiceCenterRequest.Assign();a.setPlanId(1L);a.setPlanVersion(2);a.setUserId(1L);a.setRequestKey("batch-existing-line-001");
        service.assign(9,a);assertEquals("skipped",jdbc.queryForObject("SELECT status FROM service_action",String.class));
        assertEquals(100,jdbc.queryForObject("SELECT flow FROM inbound_line WHERE user_id=1",Long.class));verifyNoInteractions(inbound);
    }
    @Test void assignmentFailureAndPushFailureAreNotReportedAsCompleted() {
        service.savePlan(plan());
        when(inbound.assignAllToUser(any())).thenReturn(R.ok(new JSONObject(Map.of("assigned",3))));
        when(inbound.pushNodeConfig(10L)).thenReturn(R.err());
        var a=new ServiceCenterRequest.Assign();a.setPlanId(1L);a.setPlanVersion(1);a.setUserId(2L);a.setRequestKey("batch-new-direct-001");
        service.assign(9,a);assertEquals("partial",jdbc.queryForObject("SELECT status FROM service_action",String.class));
    }
    @Test void remindersUseExpiryAndEightyPercentBoundary() {
        jdbc.update("UPDATE inbound_line SET status=1,flow=1,exp_time=? WHERE user_id=1",System.currentTimeMillis()+5*86400000L);
        jdbc.update("UPDATE forward SET in_flow=?,out_flow=0 WHERE id=1000",900000000L);
        Map<String,Object> line=service.lines(1L,false).get(0);
        List<?> warnings=(List<?>)line.get("warnings");assertTrue(warnings.contains("线路将在7天内到期"));assertTrue(warnings.contains("线路流量已使用80%以上"));
    }
}
