package com.admin.servicecenter;

/** Pure calculations shared by persistence and regression tests. Quotas are GB, counters are untouched. */
public final class RenewalPolicy {
    private RenewalPolicy() {}
    public record Target(long quotaGb, long expTime) {}
    public static Target calculate(Long oldQuota, Long oldExpiry, int days, String mode, long amount, long now) {
        if (days < 0 || days > 3650 || amount < 0 || amount > 1000000) throw new IllegalArgumentException("续期参数超出范围");
        long quota = oldQuota == null ? 0 : oldQuota;
        long expiry = oldExpiry == null ? 0 : oldExpiry;
        switch (mode) {
            case "keep": break;
            case "set": quota = amount; break;
            case "add":
                if (quota <= 0) throw new IllegalArgumentException("当前线路不单独限额，无需追加流量；如需限额请选择设置额度");
                quota = Math.addExact(quota, amount); break;
            default: throw new IllegalArgumentException("未知流量调整方式");
        }
        if (quota > 1000000) throw new IllegalArgumentException("调整后的额度不能超过 1000000 GB");
        if (days > 0) {
            if (expiry <= 0) throw new IllegalArgumentException("当前线路不单独限期，无需增加天数；可仅调整流量");
            expiry = Math.addExact(Math.max(expiry, now), days * 86400000L);
        }
        if (expiry == (oldExpiry == null ? 0 : oldExpiry) && quota == (oldQuota == null ? 0 : oldQuota))
            throw new IllegalArgumentException("请至少修改有效期或流量额度");
        return new Target(quota, expiry);
    }
}
