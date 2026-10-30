package com.admin.controller;

import com.admin.common.aop.RoleAspect;
import com.admin.common.exception.GlobalExceptionHandler;
import com.admin.common.interceptor.JwtInterceptor;
import com.admin.common.lang.R;
import com.admin.common.utils.JwtUtil;
import com.admin.entity.User;
import com.admin.service.LineDetailService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

class LineDetailControllerTest {
    private LineDetailService service;
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        service = mock(LineDetailService.class);
        LineDetailController target = new LineDetailController();
        ReflectionTestUtils.setField(target, "lineDetailService", service);
        AspectJProxyFactory proxy = new AspectJProxyFactory(target);
        proxy.addAspect(new RoleAspect());
        Object controller = proxy.getProxy();
        mvc = MockMvcBuilders.standaloneSetup(controller)
                .addInterceptors(new JwtInterceptor()).setControllerAdvice(new GlobalExceptionHandler()).build();
        JwtUtil jwt = new JwtUtil();
        ReflectionTestUtils.setField(jwt, "secretKey", "line-detail-unit-test-key");
        jwt.init();
    }

    private String token(int role) {
        User user = new User(); user.setId(1L); user.setUser("test"); user.setRoleId(role);
        return JwtUtil.generateToken(user);
    }

    @Test
    void anonymousAndRegularUserCannotReadOrDiagnose() throws Exception {
        for (String path : new String[]{"/api/v1/line/detail", "/api/v1/line/diagnose"}) {
            mvc.perform(post(path).contentType("application/json").content("{\"nodeId\":1}"))
                    .andExpect(jsonPath("$.code").value(401));
            mvc.perform(post(path).header("Authorization", token(1)).contentType("application/json").content("{\"nodeId\":1}"))
                    .andExpect(jsonPath("$.code").value(403));
        }
        verifyNoInteractions(service);
    }

    @Test
    void adminCanReadAndDiagnoseButInvalidIdsNeverReachService() throws Exception {
        when(service.detail(1L, null)).thenReturn(R.ok());
        when(service.diagnose(1L, null, 10L, "protocol")).thenReturn(R.ok());
        mvc.perform(post("/api/v1/line/detail").header("Authorization", token(0)).contentType("application/json").content("{\"nodeId\":1}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/v1/line/diagnose").header("Authorization", token(0)).contentType("application/json")
                        .content("{\"nodeId\":1,\"inboundId\":10,\"kind\":\"protocol\"}"))
                .andExpect(jsonPath("$.code").value(0));
        mvc.perform(post("/api/v1/line/detail").header("Authorization", token(0)).contentType("application/json").content("{\"nodeId\":-1}"))
                .andExpect(jsonPath("$.code").value(500));
        verify(service, times(1)).detail(anyLong(), nullable(Long.class));
    }
}
