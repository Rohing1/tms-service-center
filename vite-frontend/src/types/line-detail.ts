export interface LineDetail {
  node: { id: number; name: string; address: string; status: number; singboxRunning: boolean | null };
  landing: { id: number; name: string; type: string; status: number } | null;
  protocols: { id: number; protocol: string; status: number }[];
  users: {
    id: number; name: string; accountStatus: number | null; accountExpTime: number | null;
    lineStatus: number | null; quotaGb: number | null; expTime: number | null;
    protocolCount: number; missingForwards: number; inFlow: number; outFlow: number;
  }[];
  inFlow: number;
  outFlow: number;
  updatedAt: number;
}

export interface LineCheck {
  state: "passed" | "failed" | "skipped" | "unknown";
  message: string;
  latencyMs: number | null;
  packetLoss: number | null;
  timestamp: number;
}

export interface ProbeHistory {
  supported: boolean;
  minVersion: string;
  targets: { id: number; name: string }[];
  points: { targetId: number; ts: number; avg: number | null; loss: number | null }[];
}

export interface MetricHistory {
  points: { ts: number; rx: number; tx: number; rxRate: number; txRate: number }[];
}
