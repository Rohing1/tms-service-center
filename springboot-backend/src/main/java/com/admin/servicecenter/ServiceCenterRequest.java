package com.admin.servicecenter;

import lombok.Data;
import javax.validation.constraints.*;

public class ServiceCenterRequest {
    @Data public static class Plan {
        @Positive private Long id;
        @NotBlank @Size(max=80) private String name;
        @NotNull @Positive private Long nodeId;
        @Positive private Long landingId;
        @NotNull @Min(0) @Max(1000000) private Long quotaGb;
        @NotNull @Min(1) @Max(3650) private Integer durationDays;
        @Positive private Integer speedId;
        @NotNull @Min(0) @Max(1) private Integer active;
        @Size(max=500) private String remark = "";
        @Positive private Integer version;
    }
    @Data public static class Assign {
        @NotBlank @Pattern(regexp="[A-Za-z0-9_-]{16,64}") private String requestKey;
        @NotNull @Positive private Long planId;
        @NotNull @Positive private Long userId;
        @NotNull @Positive private Integer planVersion;
        @Size(max=500) private String note = "";
    }
    @Data public static class Renew {
        @NotBlank @Pattern(regexp="[A-Za-z0-9_-]{16,64}") private String requestKey;
        @NotNull @Positive private Long userId;
        @NotNull @Positive private Long nodeId;
        @Positive private Long landingId;
        @NotNull @Min(0) @Max(3650) private Integer days;
        @NotBlank @Pattern(regexp="keep|add|set") private String quotaMode;
        @NotNull @Min(0) @Max(1000000) private Long quotaGb;
        @Size(max=500) private String note = "";
        @Positive private Long renewalRequestId;
    }
    @Data public static class RenewalRequest {
        @NotNull @Positive private Long nodeId;
        @Positive private Long landingId;
        @Size(max=500) private String message = "";
    }
    @Data public static class Resolve {
        @NotNull @Positive private Long id;
        @NotBlank @Size(max=500) private String response;
    }
    @Data public static class Query {
        @Positive private Long userId;
        @NotNull @Min(1) private Integer page = 1;
    }
}
