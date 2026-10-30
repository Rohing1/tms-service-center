package com.admin.controller;

import com.admin.common.annotation.RequireRole;
import com.admin.common.lang.R;
import com.admin.service.LineDetailService;
import lombok.Data;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.validation.constraints.NotNull;
import javax.validation.constraints.Positive;

@RestController
@RequestMapping("/api/v1/line")
public class LineDetailController {
    @Resource private LineDetailService lineDetailService;

    @Data
    public static class Request {
        @NotNull @Positive private Long nodeId;
        @Positive private Long landingId;
        @Positive private Long inboundId;
        private String kind;
    }

    @RequireRole
    @PostMapping("/detail")
    public R detail(@Validated @RequestBody Request request) {
        return lineDetailService.detail(request.getNodeId(), request.getLandingId());
    }

    @RequireRole
    @PostMapping("/diagnose")
    public R diagnose(@Validated @RequestBody Request request) {
        return lineDetailService.diagnose(request.getNodeId(), request.getLandingId(), request.getInboundId(), request.getKind());
    }
}
