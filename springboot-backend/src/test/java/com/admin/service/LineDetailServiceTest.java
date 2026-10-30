package com.admin.service;

import com.admin.common.lang.R;
import com.admin.entity.*;
import com.admin.mapper.*;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class LineDetailServiceTest {
    @Mock NodeMapper nodeMapper;
    @Mock LandingMapper landingMapper;
    @Mock InboundMapper inboundMapper;
    @Mock InboundUserMapper inboundUserMapper;
    @Mock InboundLineMapper inboundLineMapper;
    @Mock ForwardMapper forwardMapper;
    @Mock UserMapper userMapper;
    @Mock LandingService landingService;
    @InjectMocks LineDetailService service;
    Node node;
    Inbound inbound;

    @BeforeEach
    void setup() {
        node = new Node(); node.setId(1L); node.setName("entry"); node.setStatus(1);
        node.setSecret("test-node-secret");
        inbound = new Inbound(); inbound.setId(10L); inbound.setNodeId(1L);
        inbound.setProtocol("vless"); inbound.setStatus(1); inbound.setListenPort(10001);
        when(nodeMapper.selectById(1L)).thenReturn(node);
    }

    private InboundUser assignment(long id, long uid, Long fid) {
        InboundUser a = new InboundUser(); a.setId(id); a.setInboundId(10L);
        a.setUserId(uid); a.setGostForwardId(fid); a.setPassword("test-protocol-secret");
        return a;
    }

    @Test
    void aggregatesEachForwardOnceAndKeepsStoppedOrBrokenUsersWithoutExposingSecrets() throws Exception {
        when(inboundMapper.selectList(any())).thenReturn(List.of(inbound));
        when(inboundUserMapper.selectList(any())).thenReturn(List.of(
                assignment(1, 7, 100L), assignment(2, 7, 100L), assignment(3, 7, 101L), assignment(4, 7, null)));
        InboundLine line = new InboundLine(); line.setUserId(8L); line.setStatus(0); line.setFlow(20L);
        line.setSubToken("test-sub-token");
        when(inboundLineMapper.selectList(any())).thenReturn(List.of(line));
        Forward f = new Forward(); f.setId(100L); f.setUserId(7); f.setInFlow(1024L); f.setOutFlow(2048L);
        Forward wrongOwner = new Forward(); wrongOwner.setId(101L); wrongOwner.setUserId(99); wrongOwner.setInFlow(99999L);
        when(forwardMapper.selectList(any())).thenReturn(List.of(f, wrongOwner));
        User u = new User(); u.setId(7L); u.setUser("alice"); u.setStatus(1); u.setPwd("test-user-secret");
        when(userMapper.selectList(any())).thenReturn(List.of(u));

        R response = service.detail(1L, null);
        assertEquals(0, response.getCode());
        LineDetailService.Detail d = (LineDetailService.Detail) response.getData();
        assertEquals(1024, d.inFlow()); assertEquals(2048, d.outFlow());
        assertEquals(2, d.users().size());
        LineDetailService.UserInfo alice = d.users().stream().filter(row -> row.id() == 7).findFirst().orElseThrow();
        assertEquals(1, alice.protocolCount()); assertEquals(2, alice.missingForwards());
        assertEquals(0, d.users().stream().filter(row -> row.id() == 8).findFirst().orElseThrow().lineStatus());
        String json = new ObjectMapper().writeValueAsString(d);
        assertFalse(json.contains("test-node-secret")); assertFalse(json.contains("test-user-secret"));
        assertFalse(json.contains("test-protocol-secret")); assertFalse(json.contains("test-sub-token"));
        verify(forwardMapper, times(1)).selectList(any());
        verify(userMapper, times(1)).selectList(any());
        ArgumentCaptor<QueryWrapper<Inbound>> scope = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(inboundMapper).selectList(scope.capture());
        assertTrue(scope.getValue().getSqlSegment().contains("landing_id IS NULL"));
    }

    @Test
    void scopesRelayToItsLandingAndDoesNotFetchAllUsersForUnassignedLine() {
        Landing landing = new Landing(); landing.setId(5L); landing.setName("exit");
        when(landingMapper.selectById(5L)).thenReturn(landing);
        when(inboundMapper.selectList(any())).thenReturn(List.of(inbound));
        when(inboundUserMapper.selectList(any())).thenReturn(List.of());
        when(inboundLineMapper.selectList(any())).thenReturn(List.of());
        LineDetailService.Detail d = (LineDetailService.Detail) service.detail(1L, 5L).getData();
        assertTrue(d.users().isEmpty()); assertEquals(0, d.inFlow());
        verifyNoInteractions(forwardMapper, userMapper);
        ArgumentCaptor<QueryWrapper<Inbound>> scope = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(inboundMapper).selectList(scope.capture());
        assertTrue(scope.getValue().getSqlSegment().contains("landing_id ="));
        assertTrue(scope.getValue().getParamNameValuePairs().containsValue(5L));
    }

    @Test
    void missingRouteIsNotShownAsAnEmptyHealthyLine() {
        when(inboundMapper.selectList(any())).thenReturn(List.of());
        assertEquals(404, service.detail(1L, null).getCode());
        verifyNoInteractions(inboundUserMapper, forwardMapper, userMapper);
    }

    @Test
    void refusesDiagnosisForProtocolOutsideRoute() {
        when(inboundMapper.selectList(any())).thenReturn(List.of(inbound));
        assertEquals(404, service.diagnose(1L, null, 999L, "protocol").getCode());
    }

    @Test
    void udpProtocolIsSkippedRatherThanReportedAsTcpFailure() {
        inbound.setProtocol("hysteria2");
        when(inboundMapper.selectList(any())).thenReturn(List.of(inbound));
        LineDetailService.Check check = (LineDetailService.Check) service.diagnose(1L, null, 10L, "protocol").getData();
        assertEquals("skipped", check.state()); assertNull(check.latencyMs());
    }

    @Test
    void offlineNodeReturnsFailureWithoutCallingLanding() {
        node.setStatus(0);
        when(inboundMapper.selectList(any())).thenReturn(List.of(inbound));
        LineDetailService.Check check = (LineDetailService.Check) service.diagnose(1L, 5L, null, "landing").getData();
        assertEquals("failed", check.state()); verifyNoInteractions(landingService);
    }
}
