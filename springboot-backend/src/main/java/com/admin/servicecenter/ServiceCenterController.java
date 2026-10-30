package com.admin.servicecenter;

import com.admin.common.annotation.RequireRole;
import com.admin.common.lang.R;
import com.admin.common.utils.JwtUtil;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;
import javax.annotation.Resource;

@RestController
@RequestMapping("/api/v1/service-center")
public class ServiceCenterController {
    @Resource private ServiceCenterService service;
    private long currentUser() { return JwtUtil.getUserIdFromToken().longValue(); }

    @PostMapping("/self") public R self() { return service.self(currentUser()); }
    @PostMapping("/request") public R request(@Validated @RequestBody ServiceCenterRequest.RenewalRequest r) { return service.requestRenewal(currentUser(),r); }
    @PostMapping("/my-history") public R myHistory(@Validated @RequestBody ServiceCenterRequest.Query r) { return R.ok(service.history(currentUser(),r.getPage(),false)); }

    @RequireRole @PostMapping("/plans") public R plans() { return service.plans(); }
    @RequireRole @PostMapping("/plan-save") public R save(@Validated @RequestBody ServiceCenterRequest.Plan r) { return service.savePlan(r); }
    @RequireRole @PostMapping("/catalog") public R catalog() { return service.catalog(); }
    @RequireRole @PostMapping("/assign") public R assign(@Validated @RequestBody ServiceCenterRequest.Assign r) { return service.assign(currentUser(),r); }
    @RequireRole @PostMapping("/renew") public R renew(@Validated @RequestBody ServiceCenterRequest.Renew r) { return service.renew(currentUser(),r); }
    @RequireRole @PostMapping("/lines") public R lines(@Validated @RequestBody ServiceCenterRequest.Query r) {
        if (r.getUserId() == null) return R.err("请选择用户");
        return R.ok(service.lines(r.getUserId(),false));
    }
    @RequireRole @PostMapping("/requests") public R requests() { return R.ok(service.requests(null)); }
    @RequireRole @PostMapping("/reject") public R reject(@Validated @RequestBody ServiceCenterRequest.Resolve r) { return service.reject(currentUser(),r); }
    @RequireRole @PostMapping("/history") public R history(@Validated @RequestBody ServiceCenterRequest.Query r) { return R.ok(service.history(r.getUserId(),r.getPage(),true)); }
    @RequireRole @PostMapping("/reminders") public R reminders() { return service.reminders(); }
}
