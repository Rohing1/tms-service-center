package com.admin.servicecenter;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import lombok.extern.slf4j.Slf4j;
import javax.annotation.Resource;

/** Additive tables only. No changes to existing subscriptions or billing counters. */
@Component @Order(3) @Slf4j
public class ServiceCenterSchema implements ApplicationRunner {
    @Resource private JdbcTemplate jdbc;
    @Override public void run(ApplicationArguments args) {
        for (String sql : DDL) {
            try { jdbc.execute(sql); }
            catch (Exception e) { log.warn("套餐与续期表初始化失败: {}", e.getClass().getSimpleName()); }
        }
    }
    static final String[] DDL = {
        "CREATE TABLE IF NOT EXISTS service_plan (id BIGINT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(80) NOT NULL, node_id BIGINT NOT NULL, landing_id BIGINT NULL, quota_gb BIGINT NOT NULL, duration_days INT NOT NULL, speed_id INT NULL, active INT NOT NULL DEFAULT 1, remark VARCHAR(500) NOT NULL DEFAULT '', version INT NOT NULL DEFAULT 1, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS service_action (id BIGINT PRIMARY KEY AUTO_INCREMENT, request_key VARCHAR(64) NOT NULL UNIQUE, actor_id BIGINT NOT NULL, user_id BIGINT NOT NULL, node_id BIGINT NOT NULL, landing_id BIGINT NULL, plan_id BIGINT NULL, plan_name VARCHAR(80) NULL, action_type VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL, message VARCHAR(500) NOT NULL DEFAULT '', note VARCHAR(500) NOT NULL DEFAULT '', payload TEXT NOT NULL, before_json TEXT NULL, after_json TEXT NULL, created_at BIGINT NOT NULL, finished_at BIGINT NULL, KEY ix_service_action_user (user_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS service_operation_lock (route_key VARCHAR(100) PRIMARY KEY, request_key VARCHAR(64) NOT NULL UNIQUE, created_at BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
        "CREATE TABLE IF NOT EXISTS service_renewal_request (id BIGINT PRIMARY KEY AUTO_INCREMENT, user_id BIGINT NOT NULL, node_id BIGINT NOT NULL, landing_id BIGINT NULL, pending_key VARCHAR(100) NULL UNIQUE, status VARCHAR(20) NOT NULL DEFAULT 'pending', message VARCHAR(500) NOT NULL DEFAULT '', response VARCHAR(500) NOT NULL DEFAULT '', handled_by BIGINT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, KEY ix_service_request_user (user_id, created_at), KEY ix_service_request_status (status, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
    };
}
