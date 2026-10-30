package com.admin.servicecenter;

import com.admin.common.aop.RoleAspect;
import com.admin.common.exception.GlobalExceptionHandler;
import com.admin.common.interceptor.JwtInterceptor;
import com.admin.common.lang.R;
import com.admin.common.utils.JwtUtil;
import com.admin.entity.User;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.Map;
import java.util.List;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

class ServiceCenterControllerTest {
    private ServiceCenterService service;
    private MockMvc mvc;
    @BeforeEach void setup() {
        service=mock(ServiceCenterService.class);
        var target=new ServiceCenterController();ReflectionTestUtils.setField(target,"service",service);
        var proxy=new AspectJProxyFactory(target);proxy.addAspect(new RoleAspect());
        Object controller=proxy.getProxy();
        mvc=MockMvcBuilders.standaloneSetup(controller).addInterceptors(new JwtInterceptor())
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        var jwt=new JwtUtil();ReflectionTestUtils.setField(jwt,"secretKey","service-center-test-key");jwt.init();
    }
    private String token(int role) {
        var user=new User();user.setId(1L);user.setUser("test");user.setRoleId(role);return JwtUtil.generateToken(user);
    }
    @Test void everyAdminEndpointRejectsRegularUsers() throws Exception {
        Map<String,String> bodies=Map.ofEntries(
            Map.entry("plans","{}"),Map.entry("catalog","{}"),Map.entry("requests","{}"),Map.entry("reminders","{}"),
            Map.entry("lines","{\"userId\":2}"),Map.entry("history","{}"),
            Map.entry("plan-save","{\"name\":\"test\",\"nodeId\":10,\"quotaGb\":100,\"durationDays\":30,\"active\":1}"),
            Map.entry("assign","{\"requestKey\":\"test-request-key-001\",\"userId\":2,\"planId\":1,\"planVersion\":1}"),
            Map.entry("renew","{\"requestKey\":\"test-request-key-002\",\"userId\":2,\"nodeId\":10,\"days\":30,\"quotaMode\":\"keep\",\"quotaGb\":0}"),
            Map.entry("reject","{\"id\":1,\"response\":\"test\"}"));
        for(var entry:bodies.entrySet()) {
            mvc.perform(post("/api/v1/service-center/"+entry.getKey()).contentType("application/json").content(entry.getValue()))
                    .andExpect(jsonPath("$.code").value(401));
            mvc.perform(post("/api/v1/service-center/"+entry.getKey()).header("Authorization",token(1)).contentType("application/json").content(entry.getValue()))
                    .andExpect(jsonPath("$.code").value(403));
        }
        verifyNoInteractions(service);
    }
    @Test void selfEndpointsAlwaysUseAuthenticatedUser() throws Exception {
        when(service.self(1L)).thenReturn(R.ok());when(service.requestRenewal(eq(1L),any())).thenReturn(R.ok());
        when(service.history(1L,1,false)).thenReturn(List.of());
        for(String path:List.of("self","my-history","request")) {
            mvc.perform(post("/api/v1/service-center/"+path).header("Authorization",token(1)).contentType("application/json")
                .content("{\"userId\":2,\"nodeId\":10,\"page\":1}")) .andExpect(jsonPath("$.code").value(0));
        }
        verify(service).self(1L);verify(service).history(1L,1,false);verify(service).requestRenewal(eq(1L),any());
    }
    @Test void invalidRenewalNeverReachesService() throws Exception {
        mvc.perform(post("/api/v1/service-center/renew").header("Authorization",token(0)).contentType("application/json")
            .content("{\"requestKey\":\"test-request-key-001\",\"userId\":2,\"nodeId\":10,\"days\":-1,\"quotaMode\":\"keep\",\"quotaGb\":0}"))
            .andExpect(jsonPath("$.code").value(500));
        verifyNoInteractions(service);
    }
}
