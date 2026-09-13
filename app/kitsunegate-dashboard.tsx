'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Braces,
  ChevronDown,
  Clipboard,
  Code2,
  Gauge,
  LayoutDashboard,
  Languages,
  Link2,
  ListTree,
  Loader2,
  Network,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toaster, toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import {
  UI_LANGUAGES,
  translateUiText,
  type UiLanguage,
  useDocumentLocale,
} from './i18n';

type View = 'overview' | 'groups' | 'nodes' | 'health' | 'events' | 'settings';
type Mode = 'load_balance' | 'fallback' | 'latency_best' | 'fixed';

type ProxyNode = {
  id: string;
  groupId: string;
  name: string;
  protocol: string;
  server: string;
  serverPort: number;
  uriHint: string;
  sourceType: 'link' | 'manual' | 'json';
  adapterPort: number;
  weight: number;
  priority: number;
  enabled: boolean;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
  latencyMs: number | null;
  lastError: string | null;
  lastCheckedAt: string | null;
};

type ProxyGroup = {
  id: string;
  name: string;
  regionCode: string;
  listenHost: string;
  listenPort: number;
  mode: Mode;
  algorithm: 'leastconn' | 'roundrobin' | 'random';
  selectedNodeId: string | null;
  enabled: boolean;
  probeUrls: string[];
  probeInterval: number;
  probeTimeout: number;
  fallThreshold: number;
  riseThreshold: number;
  latencyTolerance: number;
  stats: {
    healthy: number;
    total: number;
    configured: number;
    connections: number;
    throughputMbps: number;
    speedInMbps: number;
    speedOutMbps: number;
    bytesIn: number;
    bytesOut: number;
    totalConnections: number;
  };
  nodes: ProxyNode[];
};

type RelayEvent = {
  id: number;
  groupId: string | null;
  nodeId: string | null;
  severity: string;
  type: string;
  message: string;
  createdAt: string;
};

type RuntimeLog = {
  id: number;
  source: string;
  level: string;
  message: string;
  createdAt: string;
};
type AppSettings = {
  metricsSampleIntervalSeconds: number;
  metricsRetentionDays: number;
  logLevel: 'debug' | 'info' | 'warning' | 'error';
  logRetentionDays: number;
  uiLanguage: UiLanguage;
};
type TrafficPoint = {
  createdAt: string;
  bytesInPerSecond: number;
  bytesOutPerSecond: number;
  activeConnections: number;
};
type TrafficTrend = {
  range: string;
  label: string;
  bucketSeconds: number;
  points: TrafficPoint[];
};
type ProbeNodeResult = ProxyNode & {
  probe: {
    ok: boolean;
    statusCode: number | null;
    latencyMs: number | null;
    url: string;
    error: string | null;
  };
  successCount?: number;
  failureCount?: number;
};
type ProbeReport = {
  groupId: string;
  groupName: string;
  durationMs: number;
  probeUrl: string;
  results: ProbeNodeResult[];
};

type AppState = {
  engine: {
    status: string;
    mode: string;
    haproxy: boolean;
    singbox: boolean;
    balancer: string | null;
    version: string | null;
    haproxyVersion?: string | null;
    startedAt: string | null;
    lastError: string | null;
  };
  groups: ProxyGroup[];
  recentEvents: RelayEvent[];
  runtimeLogs: RuntimeLog[];
  settings: AppSettings;
};

type GroupDraft = {
  name: string;
  regionCode: string;
  listenHost: string;
  listenPort: number;
  mode: Mode;
  algorithm: 'leastconn' | 'roundrobin' | 'random';
  selectedNodeId?: string | null;
  enabled?: boolean;
  probeUrls: string[];
  probeInterval: number;
  probeTimeout: number;
  fallThreshold: number;
  riseThreshold: number;
  latencyTolerance: number;
};

type NodeSource = 'manual' | 'json' | 'link';
type ManualNodeConfig = {
  protocol: 'vless' | 'vmess' | 'ss' | 'trojan' | 'hysteria2' | 'socks';
  server: string;
  serverPort: number;
  uuid: string;
  password: string;
  username: string;
  method: string;
  encryption: string;
  flow: string;
  network: 'tcp' | 'ws' | 'grpc' | 'httpupgrade';
  security: 'none' | 'tls' | 'reality';
  sni: string;
  fingerprint: string;
  allowInsecure: boolean;
  realityPublicKey: string;
  realityShortId: string;
  path: string;
  host: string;
  serviceName: string;
  upMbps: number;
  downMbps: number;
  obfs: string;
  obfsPassword: string;
};

type NodeDraft = {
  sourceType: NodeSource;
  name: string;
  weight: number;
  priority: number;
  enabled: boolean;
  uri: string;
  json: string;
  manual: ManualNodeConfig;
};

const API_BASE =
  typeof window !== 'undefined' &&
  !(
    ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
    window.location.port === '3000'
  )
    ? '/api'
    : 'http://127.0.0.1:8787/api';

const modeLabels: Record<Mode, string> = {
  load_balance: '负载均衡',
  fallback: '故障回退',
  latency_best: '延迟优选',
  fixed: '指定节点',
};

const modeDescriptions: Record<Mode, string> = {
  load_balance: '在健康节点之间分配连接',
  fallback: '主节点故障后按优先级切换',
  latency_best: '选择延迟最低的健康节点',
  fixed: '固定使用手动指定的节点',
};

const emptyGroup: GroupDraft = {
  name: '',
  regionCode: '',
  listenHost: '0.0.0.0',
  listenPort: 4488,
  mode: 'load_balance',
  algorithm: 'leastconn',
  probeUrls: ['https://www.gstatic.com/generate_204'],
  probeInterval: 15,
  probeTimeout: 6,
  fallThreshold: 2,
  riseThreshold: 2,
  latencyTolerance: 100,
};

const emptyNode: NodeDraft = {
  sourceType: 'manual',
  name: '',
  weight: 5,
  priority: 1,
  enabled: true,
  uri: '',
  json: `{
  "type": "vless",
  "tag": "custom-out",
  "server": "proxy.example.com",
  "server_port": 443,
  "uuid": "",
  "tls": { "enabled": true, "server_name": "proxy.example.com" }
}`,
  manual: {
    protocol: 'vless',
    server: '',
    serverPort: 443,
    uuid: '',
    password: '',
    username: '',
    method: 'aes-256-gcm',
    encryption: 'none',
    flow: '',
    network: 'tcp',
    security: 'tls',
    sni: '',
    fingerprint: 'chrome',
    allowInsecure: false,
    realityPublicKey: '',
    realityShortId: '',
    path: '/',
    host: '',
    serviceName: '',
    upMbps: 0,
    downMbps: 0,
    obfs: '',
    obfsPassword: '',
  },
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: '总览', icon: LayoutDashboard },
  { id: 'groups', label: '代理组', icon: ListTree },
  { id: 'nodes', label: '全部节点', icon: Network },
  { id: 'health', label: '健康检测', icon: ShieldCheck },
  { id: 'events', label: '运行日志', icon: Activity },
  { id: 'settings', label: '系统设置', icon: SlidersHorizontal },
];

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new Error(body.error || `请求失败 (${response.status})`);
  return body as T;
}

function toDraft(group: ProxyGroup): GroupDraft {
  return {
    name: group.name,
    regionCode: group.regionCode,
    listenHost: group.listenHost,
    listenPort: group.listenPort,
    mode: group.mode,
    algorithm: group.algorithm,
    selectedNodeId: group.selectedNodeId,
    enabled: group.enabled,
    probeUrls: group.probeUrls,
    probeInterval: group.probeInterval,
    probeTimeout: group.probeTimeout,
    fallThreshold: group.fallThreshold,
    riseThreshold: group.riseThreshold,
    latencyTolerance: group.latencyTolerance,
  };
}

function nodePayload(draft: NodeDraft) {
  const common = {
    sourceType: draft.sourceType,
    name: draft.name,
    weight: draft.weight,
    priority: draft.priority,
    enabled: draft.enabled,
  };
  if (draft.sourceType === 'manual') return { ...common, manual: draft.manual };
  if (draft.sourceType === 'json') return { ...common, json: draft.json };
  return { ...common, uri: draft.uri };
}

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(mbps = 0) {
  return mbps >= 1
    ? `${mbps.toFixed(2)} Mbps`
    : `${(mbps * 1000).toFixed(0)} Kbps`;
}

function formatTime(value: string | null) {
  if (!value) return '尚未检测';
  const locale =
    typeof document === 'undefined' ? 'en' : document.documentElement.lang;
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function StatusDot({ status }: { status: ProxyNode['healthStatus'] }) {
  return (
    <span
      className={cn(
        'size-2 rounded-full',
        status === 'healthy'
          ? 'bg-emerald-500'
          : status === 'unhealthy'
            ? 'bg-rose-500'
            : 'bg-slate-300',
      )}
    />
  );
}

function SelectField({
  value,
  onChange,
  children,
  className,
  tone = 'light',
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  tone?: 'light' | 'dark';
}) {
  return (
    <div className="relative w-full">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'h-9 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-9 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20',
          tone === 'dark' &&
            'border-slate-600 bg-slate-900 text-slate-100 [color-scheme:dark] [&>option]:bg-slate-900 [&>option]:text-slate-100',
          className,
        )}
      >
        {children}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400',
          tone === 'dark' && 'text-slate-300',
        )}
      />
    </div>
  );
}

export default function KitsuneGateDashboard() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroup, setNewGroup] = useState<GroupDraft>(emptyGroup);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [addNodeOpen, setAddNodeOpen] = useState(false);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>(emptyNode);
  const [editNodeId, setEditNodeId] = useState<string | null>(null);
  const [editNodeOpen, setEditNodeOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkTitle, setCheckTitle] = useState('节点健康检测');
  const [checkReports, setCheckReports] = useState<ProbeReport[]>([]);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [configPreview, setConfigPreview] = useState<{
    haproxy: string;
    singbox: string;
  } | null>(null);

  useDocumentLocale(state?.settings.uiLanguage ?? 'en', Boolean(state));
  const language = state?.settings.uiLanguage ?? 'en';
  const t = useCallback(
    (value: string) => translateUiText(value, language),
    [language],
  );

  const loadState = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setState(await api<AppState>('/state'));
    } catch (error) {
      toast.add({
        title: '无法连接本地服务',
        description:
          error instanceof Error ? error.message : '请确认 API 已启动。',
        type: 'error',
      });
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadState());
    const timer = window.setInterval(
      () => void loadState(true),
      Math.max(
        1000,
        (state?.settings.metricsSampleIntervalSeconds ?? 2) * 1000,
      ),
    );
    return () => window.clearInterval(timer);
  }, [loadState, state?.settings.metricsSampleIntervalSeconds]);

  const selectedGroup =
    state?.groups.find((group) => group.id === detailId) ?? null;
  const allNodes = useMemo(
    () =>
      state?.groups.flatMap((group) =>
        group.nodes.map((node) => ({ node, group })),
      ) ?? [],
    [state],
  );
  const enabledNodes = allNodes.filter(({ node }) => node.enabled);
  const totalNodes = enabledNodes.length;
  const healthyNodes = enabledNodes.filter(
    ({ node }) => node.healthStatus === 'healthy',
  ).length;
  const enabledGroups =
    state?.groups.filter((group) => group.enabled).length ?? 0;
  const avgLatency = Math.round(
    allNodes
      .filter(({ node }) => node.latencyMs)
      .reduce((sum, { node }) => sum + (node.latencyMs ?? 0), 0) /
      Math.max(1, allNodes.filter(({ node }) => node.latencyMs).length),
  );

  function openDetails(group: ProxyGroup) {
    setDetailId(group.id);
    setGroupDraft(toDraft(group));
    setConfigPreview(null);
  }

  async function mutate(
    label: string,
    path: string,
    init: RequestInit,
    success: string,
  ) {
    setBusy(label);
    try {
      await api(path, init);
      await loadState(true);
      toast.add({ title: success, type: 'success' });
      return true;
    } catch (error) {
      toast.add({
        title: '操作失败',
        description: error instanceof Error ? error.message : '未知错误',
        type: 'error',
      });
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function createGroup() {
    const ok = await mutate(
      'create',
      '/groups',
      { method: 'POST', body: JSON.stringify(newGroup) },
      '代理组已创建',
    );
    if (ok) {
      setCreateOpen(false);
      setNewGroup({
        ...emptyGroup,
        listenPort: emptyGroup.listenPort + (state?.groups.length ?? 0) * 1000,
      });
    }
  }

  async function saveGroup() {
    if (!selectedGroup || !groupDraft) return;
    const ok = await mutate(
      'save-group',
      `/groups/${selectedGroup.id}`,
      { method: 'PUT', body: JSON.stringify(groupDraft) },
      '代理组设置已保存',
    );
    if (ok) setGroupDraft((draft) => (draft ? { ...draft } : draft));
  }

  async function deleteGroup(group: ProxyGroup) {
    if (!window.confirm(t(`确定删除“${group.name}”及其全部节点吗？`))) return;
    const ok = await mutate(
      `delete-${group.id}`,
      `/groups/${group.id}`,
      { method: 'DELETE' },
      '代理组已删除',
    );
    if (ok) setDetailId(null);
  }

  async function addNode() {
    if (!selectedGroup) return;
    const ok = await mutate(
      'add-node',
      `/groups/${selectedGroup.id}/nodes`,
      { method: 'POST', body: JSON.stringify(nodePayload(nodeDraft)) },
      '节点已添加并重载真实引擎',
    );
    if (ok) {
      setAddNodeOpen(false);
      setNodeDraft(emptyNode);
    }
  }

  async function testGroup(group: ProxyGroup) {
    setCheckTitle(`${group.name} · 真实链路检测`);
    setCheckOpen(true);
    setCheckRunning(true);
    setCheckReports([]);
    setCheckError(null);
    try {
      const report = await api<ProbeReport>(`/groups/${group.id}/test`, {
        method: 'POST',
      });
      setCheckReports([report]);
      await loadState(true);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : '检测失败');
    } finally {
      setCheckRunning(false);
    }
  }

  async function testNode(node: ProxyNode) {
    setCheckTitle(`${node.name} · 真实链路检测`);
    setCheckOpen(true);
    setCheckRunning(true);
    setCheckReports([]);
    setCheckError(null);
    try {
      const result = await api<ProbeNodeResult>(`/nodes/${node.id}/test`, {
        method: 'POST',
      });
      setCheckReports([
        {
          groupId: node.groupId,
          groupName: node.name,
          durationMs: Math.round(result.probe.latencyMs ?? 0),
          probeUrl: result.probe.url,
          results: [result],
        },
      ]);
      await loadState(true);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : '检测失败');
    } finally {
      setCheckRunning(false);
    }
  }

  async function testAllGroups() {
    setCheckTitle('全部代理组 · 真实链路检测');
    setCheckOpen(true);
    setCheckRunning(true);
    setCheckReports([]);
    setCheckError(null);
    try {
      const result = await api<{ groups: ProbeReport[] }>('/groups/test-all', {
        method: 'POST',
      });
      setCheckReports(result.groups);
      await loadState(true);
    } catch (error) {
      setCheckError(error instanceof Error ? error.message : '检测失败');
    } finally {
      setCheckRunning(false);
    }
  }

  async function openEditNode(node: ProxyNode) {
    setBusy(`edit-${node.id}`);
    try {
      const config = await api<Partial<NodeDraft> & { sourceType: NodeSource }>(
        `/nodes/${node.id}/config`,
      );
      setNodeDraft({
        ...emptyNode,
        ...config,
        manual: { ...emptyNode.manual, ...config.manual },
        json: config.json ?? emptyNode.json,
        uri: config.uri ?? '',
      });
      setEditNodeId(node.id);
      setEditNodeOpen(true);
    } catch (error) {
      toast.add({
        title: '无法读取节点配置',
        description: error instanceof Error ? error.message : '未知错误',
        type: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveNode() {
    if (!editNodeId) return;
    const ok = await mutate(
      'save-node',
      `/nodes/${editNodeId}`,
      { method: 'PUT', body: JSON.stringify(nodePayload(nodeDraft)) },
      '节点配置已保存并重载真实引擎',
    );
    if (ok) {
      setEditNodeOpen(false);
      setEditNodeId(null);
      setNodeDraft(emptyNode);
    }
  }

  async function loadPreview() {
    setBusy('preview');
    try {
      setConfigPreview(await api('/engine/preview'));
    } catch (error) {
      toast.add({
        title: '配置生成失败',
        description: error instanceof Error ? error.message : '未知错误',
        type: 'error',
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Connecting to KitsuneGate…
      </div>
    );
  }

  return (
    <Toaster>
      <div
        data-localized-root
        className="min-h-screen bg-[#f5f7fb] text-foreground lg:grid lg:grid-cols-[240px_1fr]"
      >
        <aside className="border-b border-slate-200 bg-[#0d1c36] px-4 py-5 text-white lg:min-h-screen lg:border-r lg:border-b-0">
          <div className="flex items-center gap-3 px-2">
            <div className="flex size-10 items-center justify-center overflow-hidden rounded-xl shadow-lg shadow-blue-950/30">
              <div
                aria-hidden="true"
                className="size-10 bg-contain bg-center bg-no-repeat"
                style={{ backgroundImage: "url('/kitsunegate-mark.svg')" }}
              />
            </div>
            <div>
              <p className="font-semibold tracking-tight">KitsuneGate</p>
              <p className="text-xs text-slate-400">HAProxy Control Plane</p>
            </div>
          </div>
          <nav className="mt-7 grid grid-cols-2 gap-1 sm:grid-cols-6 lg:grid-cols-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition',
                    view === item.id
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-950/20'
                      : 'text-slate-300 hover:bg-white/8 hover:text-white',
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="mt-8 hidden rounded-2xl border border-white/10 bg-white/5 p-4 lg:block">
            <div
              className={cn(
                'flex items-center gap-2 text-xs font-medium',
                state?.engine.status === 'running'
                  ? 'text-emerald-300'
                  : 'text-rose-300',
              )}
            >
              {state?.engine.status === 'running' ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              {state?.engine.status === 'running'
                ? '真实引擎运行中'
                : '引擎不可用'}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              {state?.engine.status === 'running'
                ? `sing-box 已接管流量；${state.engine.balancer === 'builtin' ? '内置均衡器' : 'HAProxy'}负责端口分流。`
                : state?.engine.lastError || '请检查运行日志。'}
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 sm:px-7 lg:px-9 lg:py-8">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {navItems.find((item) => item.id === view)?.label}
                </h1>
                <Badge
                  variant="outline"
                  className={
                    state?.engine.status === 'running'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-rose-200 bg-rose-50 text-rose-700'
                  }
                >
                  {state?.engine.status === 'running'
                    ? '真实流量模式'
                    : '引擎异常'}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                管理不同地区的监听端口、代理节点与切换策略
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => void loadState()}
                disabled={loading}
              >
                <RefreshCw
                  className={cn('size-4', loading && 'animate-spin')}
                />
                刷新
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" />
                新建代理组
              </Button>
            </div>
          </header>

          {view === 'overview' && state && (
            <OverviewDashboard
              state={state}
              enabledGroups={enabledGroups}
              healthyNodes={healthyNodes}
              totalNodes={totalNodes}
              avgLatency={avgLatency}
              onReload={() =>
                void mutate(
                  'engine-reload',
                  '/engine/reload',
                  { method: 'POST' },
                  '真实引擎已重载',
                )
              }
            />
          )}

          {view === 'groups' && (
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">代理组</h2>
                <span className="text-xs text-muted-foreground">
                  {`每 ${state?.settings.metricsSampleIntervalSeconds ?? 2} 秒自动刷新`}
                </span>
              </div>
              <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {state?.groups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    busy={busy}
                    onDetails={openDetails}
                    onTest={testGroup}
                    onToggle={() =>
                      void mutate(
                        `toggle-${group.id}`,
                        `/groups/${group.id}`,
                        {
                          method: 'PUT',
                          body: JSON.stringify({ enabled: !group.enabled }),
                        },
                        group.enabled ? '代理组已停用' : '代理组已启用',
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {view === 'nodes' && (
            <NodesTable
              rows={allNodes}
              busy={busy}
              onEdit={(node) => void openEditNode(node)}
              onTest={(node) => void testNode(node)}
              onToggle={(node) =>
                void mutate(
                  `node-toggle-${node.id}`,
                  `/nodes/${node.id}`,
                  {
                    method: 'PUT',
                    body: JSON.stringify({ enabled: !node.enabled }),
                  },
                  node.enabled ? '节点已停用' : '节点已启用',
                )
              }
            />
          )}

          {view === 'health' && (
            <HealthCenter
              groups={state?.groups ?? []}
              running={checkRunning}
              onTestAll={() => void testAllGroups()}
              onOpen={openDetails}
            />
          )}

          {view === 'events' && (
            <EventList
              events={state?.recentEvents ?? []}
              logs={state?.runtimeLogs ?? []}
              groups={state?.groups ?? []}
            />
          )}

          {view === 'settings' && state && (
            <SettingsPanel
              settings={state.settings}
              onSaved={() => loadState(true)}
            />
          )}
        </main>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>新建代理组</DialogTitle>
              <DialogDescription>
                每个代理组对应一个本地监听端口，后续可添加任意数量的代理节点。
              </DialogDescription>
            </DialogHeader>
            <GroupForm draft={newGroup} onChange={setNewGroup} compact />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => void createGroup()}
                disabled={busy === 'create'}
              >
                {busy === 'create' && <Loader2 className="animate-spin" />}
                创建代理组
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Sheet
          open={Boolean(detailId)}
          onOpenChange={(open) => !open && setDetailId(null)}
        >
          <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
            {selectedGroup && groupDraft && (
              <>
                <SheetHeader className="border-b">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 font-semibold text-blue-700">
                      {selectedGroup.regionCode}
                    </div>
                    <div>
                      <SheetTitle>{selectedGroup.name}</SheetTitle>
                      <SheetDescription>
                        {selectedGroup.listenHost}:{selectedGroup.listenPort} ·{' '}
                        {modeLabels[selectedGroup.mode]}
                      </SheetDescription>
                    </div>
                  </div>
                </SheetHeader>
                <Tabs defaultValue="nodes" className="px-4 pb-8">
                  <TabsList className="mt-3 grid w-full grid-cols-4">
                    <TabsTrigger value="nodes">节点</TabsTrigger>
                    <TabsTrigger value="settings">策略</TabsTrigger>
                    <TabsTrigger value="health">检测</TabsTrigger>
                    <TabsTrigger
                      value="config"
                      onClick={() => void loadPreview()}
                    >
                      配置
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="nodes" className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">节点列表</p>
                        <p className="text-xs text-muted-foreground">
                          节点凭据与完整配置加密保存在本机
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          setNodeDraft(emptyNode);
                          setAddNodeOpen(true);
                        }}
                      >
                        <Plus />
                        添加节点
                      </Button>
                    </div>
                    {selectedGroup.nodes.map((node) => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        language={language}
                        selectable={
                          groupDraft.mode === 'fixed' ||
                          groupDraft.mode === 'latency_best'
                        }
                        selected={groupDraft.selectedNodeId === node.id}
                        busy={busy}
                        onSelect={() =>
                          setGroupDraft({
                            ...groupDraft,
                            selectedNodeId: node.id,
                          })
                        }
                        onEdit={() => void openEditNode(node)}
                        onToggle={() =>
                          void mutate(
                            `node-toggle-${node.id}`,
                            `/nodes/${node.id}`,
                            {
                              method: 'PUT',
                              body: JSON.stringify({ enabled: !node.enabled }),
                            },
                            node.enabled ? '节点已停用' : '节点已启用',
                          )
                        }
                        onTest={() => void testNode(node)}
                        onDelete={() => {
                          if (
                            window.confirm(t(`确定删除节点“${node.name}”吗？`))
                          )
                            void mutate(
                              `node-delete-${node.id}`,
                              `/nodes/${node.id}`,
                              { method: 'DELETE' },
                              '节点已删除',
                            );
                        }}
                      />
                    ))}
                    {!selectedGroup.nodes.length && (
                      <Empty
                        icon={Network}
                        title="尚无节点"
                        detail="可用基础表单、出站 JSON 或分享链接添加代理节点。"
                      />
                    )}
                    {(groupDraft.mode === 'fixed' ||
                      groupDraft.mode === 'latency_best') && (
                      <Button
                        className="w-full"
                        variant="outline"
                        onClick={() => void saveGroup()}
                      >
                        <Save />
                        保存节点选择
                      </Button>
                    )}
                  </TabsContent>
                  <TabsContent value="settings" className="mt-4 space-y-4">
                    <GroupForm draft={groupDraft} onChange={setGroupDraft} />
                    <Button
                      className="w-full"
                      onClick={() => void saveGroup()}
                      disabled={busy === 'save-group'}
                    >
                      <Save />
                      保存策略设置
                    </Button>
                    <Button
                      className="w-full"
                      variant="destructive"
                      onClick={() => void deleteGroup(selectedGroup)}
                    >
                      <Trash2 />
                      删除整个代理组
                    </Button>
                  </TabsContent>
                  <TabsContent value="health" className="mt-4 space-y-4">
                    <HealthForm draft={groupDraft} onChange={setGroupDraft} />
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void testGroup(selectedGroup)}
                      >
                        <Play />
                        立即真实检测
                      </Button>
                      <Button onClick={() => void saveGroup()}>
                        <Save />
                        保存检测设置
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="config" className="mt-4 space-y-4">
                    <ConfigPreview
                      preview={configPreview}
                      loading={busy === 'preview'}
                      onReload={loadPreview}
                    />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </SheetContent>
        </Sheet>

        <Dialog open={addNodeOpen} onOpenChange={setAddNodeOpen}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>添加代理节点</DialogTitle>
              <DialogDescription>
                支持基础配置、出站 JSON 和分享链接；敏感字段都会加密保存。
              </DialogDescription>
            </DialogHeader>
            <NodeEditor draft={nodeDraft} onChange={setNodeDraft} />
            <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 border-t bg-popover px-4 py-3">
              <Button variant="outline" onClick={() => setAddNodeOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => void addNode()}
                disabled={busy === 'add-node'}
              >
                {busy === 'add-node' && <Loader2 className="animate-spin" />}
                添加节点
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editNodeOpen} onOpenChange={setEditNodeOpen}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>修改代理节点</DialogTitle>
              <DialogDescription>
                可切换配置来源并修改完整凭据；保存后会校验并平滑重载真实引擎。
              </DialogDescription>
            </DialogHeader>
            <NodeEditor draft={nodeDraft} onChange={setNodeDraft} editing />
            <DialogFooter className="sticky bottom-0 -mx-4 -mb-4 border-t bg-popover px-4 py-3">
              <Button variant="outline" onClick={() => setEditNodeOpen(false)}>
                取消
              </Button>
              <Button
                onClick={() => void saveNode()}
                disabled={busy === 'save-node'}
              >
                {busy === 'save-node' && <Loader2 className="animate-spin" />}
                保存并重载
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={checkOpen}
          onOpenChange={(open) => !checkRunning && setCheckOpen(open)}
        >
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{checkTitle}</DialogTitle>
              <DialogDescription>
                {
                  '请求会通过每个节点自己的 sing-box SOCKS 适配端口访问检测地址，不再使用模拟结果。'
                }
              </DialogDescription>
            </DialogHeader>
            <ProbeResultPanel
              running={checkRunning}
              reports={checkReports}
              error={checkError}
            />
            <DialogFooter>
              <Button
                onClick={() => setCheckOpen(false)}
                disabled={checkRunning}
              >
                关闭
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Toaster>
  );
}

function NodeEditor({
  draft,
  onChange,
  editing = false,
}: {
  draft: NodeDraft;
  onChange: (draft: NodeDraft) => void;
  editing?: boolean;
}) {
  const manual = draft.manual;
  const updateManual = (values: Partial<ManualNodeConfig>) =>
    onChange({ ...draft, manual: { ...manual, ...values } });
  const hasTransport = ['vless', 'vmess', 'trojan'].includes(manual.protocol);
  const hasTls = hasTransport || manual.protocol === 'hysteria2';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_120px_120px]">
        <Field label="节点名称">
          <Input
            value={draft.name}
            onChange={(event) =>
              onChange({ ...draft, name: event.target.value })
            }
            placeholder="例如 US · CN2 05（JSON 标签可自动补全）"
          />
        </Field>
        <Field label="负载权重">
          <Input
            type="number"
            min={1}
            max={256}
            value={draft.weight}
            onChange={(event) =>
              onChange({ ...draft, weight: Number(event.target.value) })
            }
          />
        </Field>
        <Field label="故障优先级">
          <Input
            type="number"
            min={1}
            value={draft.priority}
            onChange={(event) =>
              onChange({ ...draft, priority: Number(event.target.value) })
            }
          />
        </Field>
      </div>
      {editing && (
        <div className="flex items-center justify-between rounded-xl border bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm font-medium">启用此节点</p>
            <p className="text-xs text-muted-foreground">
              停用后不会参与检测、选路和连接分配
            </p>
          </div>
          <Switch
            checked={draft.enabled}
            onCheckedChange={(enabled) => onChange({ ...draft, enabled })}
          />
        </div>
      )}
      <Tabs
        value={draft.sourceType}
        onValueChange={(value) =>
          onChange({ ...draft, sourceType: value as NodeSource })
        }
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="manual">
            <SlidersHorizontal />
            基础配置
          </TabsTrigger>
          <TabsTrigger value="json">
            <Braces />
            JSON
          </TabsTrigger>
          <TabsTrigger value="link">
            <Link2 />
            分享链接
          </TabsTrigger>
        </TabsList>
        <TabsContent value="manual" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="协议">
              <SelectField
                value={manual.protocol}
                onChange={(value) =>
                  updateManual({
                    protocol: value as ManualNodeConfig['protocol'],
                    serverPort: value === 'ss' ? 8388 : 443,
                    security: value === 'hysteria2' ? 'tls' : manual.security,
                  })
                }
              >
                <option value="vless">VLESS</option>
                <option value="vmess">VMess</option>
                <option value="ss">Shadowsocks</option>
                <option value="trojan">Trojan</option>
                <option value="hysteria2">Hysteria2</option>
                <option value="socks">SOCKS5</option>
              </SelectField>
            </Field>
            <Field label="服务器地址">
              <Input
                value={manual.server}
                onChange={(event) =>
                  updateManual({ server: event.target.value })
                }
                placeholder="proxy.example.com"
              />
            </Field>
            <Field label="端口">
              <Input
                type="number"
                min={1}
                max={65535}
                value={manual.serverPort}
                onChange={(event) =>
                  updateManual({ serverPort: Number(event.target.value) })
                }
              />
            </Field>
          </div>

          {['vless', 'vmess'].includes(manual.protocol) && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="UUID">
                <Input
                  value={manual.uuid}
                  onChange={(event) =>
                    updateManual({ uuid: event.target.value })
                  }
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
              </Field>
              {manual.protocol === 'vless' ? (
                <Field label="Flow">
                  <SelectField
                    value={manual.flow}
                    onChange={(value) => updateManual({ flow: value })}
                  >
                    <option value="">无</option>
                    <option value="xtls-rprx-vision">xtls-rprx-vision</option>
                  </SelectField>
                </Field>
              ) : (
                <Field label="加密方式">
                  <SelectField
                    value={manual.encryption}
                    onChange={(value) => updateManual({ encryption: value })}
                  >
                    <option value="auto">auto</option>
                    <option value="none">none</option>
                    <option value="zero">zero</option>
                    <option value="aes-128-gcm">aes-128-gcm</option>
                    <option value="chacha20-poly1305">chacha20-poly1305</option>
                  </SelectField>
                </Field>
              )}
            </div>
          )}
          {manual.protocol === 'ss' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="加密方式">
                <SelectField
                  value={manual.method}
                  onChange={(value) => updateManual({ method: value })}
                >
                  <option value="aes-256-gcm">aes-256-gcm</option>
                  <option value="aes-128-gcm">aes-128-gcm</option>
                  <option value="chacha20-ietf-poly1305">
                    chacha20-ietf-poly1305
                  </option>
                  <option value="2022-blake3-aes-128-gcm">
                    2022-blake3-aes-128-gcm
                  </option>
                  <option value="2022-blake3-aes-256-gcm">
                    2022-blake3-aes-256-gcm
                  </option>
                </SelectField>
              </Field>
              <Field label="密码">
                <Input
                  type="password"
                  value={manual.password}
                  onChange={(event) =>
                    updateManual({ password: event.target.value })
                  }
                />
              </Field>
            </div>
          )}
          {['trojan', 'hysteria2'].includes(manual.protocol) && (
            <Field label="密码">
              <Input
                type="password"
                value={manual.password}
                onChange={(event) =>
                  updateManual({ password: event.target.value })
                }
              />
            </Field>
          )}
          {manual.protocol === 'socks' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="用户名（可选）">
                <Input
                  value={manual.username}
                  onChange={(event) =>
                    updateManual({ username: event.target.value })
                  }
                />
              </Field>
              <Field label="密码（可选）">
                <Input
                  type="password"
                  value={manual.password}
                  onChange={(event) =>
                    updateManual({ password: event.target.value })
                  }
                />
              </Field>
            </div>
          )}

          {hasTransport && (
            <section className="rounded-xl border bg-slate-50/70 p-4">
              <div className="mb-4">
                <p className="text-sm font-medium">传输与安全</p>
                <p className="text-xs text-muted-foreground">
                  只显示当前协议和传输方式需要的字段
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="传输方式">
                  <SelectField
                    value={manual.network}
                    onChange={(value) =>
                      updateManual({
                        network: value as ManualNodeConfig['network'],
                      })
                    }
                  >
                    <option value="tcp">RAW / TCP</option>
                    <option value="ws">WebSocket</option>
                    <option value="grpc">gRPC</option>
                    <option value="httpupgrade">HTTPUpgrade</option>
                  </SelectField>
                </Field>
                <Field label="安全">
                  <SelectField
                    value={manual.security}
                    onChange={(value) =>
                      updateManual({
                        security: value as ManualNodeConfig['security'],
                      })
                    }
                  >
                    <option value="none">无</option>
                    <option value="tls">TLS</option>
                    <option value="reality">Reality</option>
                  </SelectField>
                </Field>
              </div>
              {['ws', 'httpupgrade'].includes(manual.network) && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="路径">
                    <Input
                      value={manual.path}
                      onChange={(event) =>
                        updateManual({ path: event.target.value })
                      }
                      placeholder="/proxy"
                    />
                  </Field>
                  <Field label="Host">
                    <Input
                      value={manual.host}
                      onChange={(event) =>
                        updateManual({ host: event.target.value })
                      }
                    />
                  </Field>
                </div>
              )}
              {manual.network === 'grpc' && (
                <div className="mt-4">
                  <Field label="gRPC Service Name">
                    <Input
                      value={manual.serviceName}
                      onChange={(event) =>
                        updateManual({ serviceName: event.target.value })
                      }
                    />
                  </Field>
                </div>
              )}
            </section>
          )}

          {hasTls &&
            (manual.security !== 'none' || manual.protocol === 'hysteria2') && (
              <section className="rounded-xl border bg-slate-50/70 p-4">
                <p className="mb-4 text-sm font-medium">
                  TLS {manual.security === 'reality' ? '/ Reality' : ''}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="SNI">
                    <Input
                      value={manual.sni}
                      onChange={(event) =>
                        updateManual({ sni: event.target.value })
                      }
                      placeholder="默认使用服务器地址"
                    />
                  </Field>
                  <Field label="浏览器指纹">
                    <SelectField
                      value={manual.fingerprint}
                      onChange={(value) => updateManual({ fingerprint: value })}
                    >
                      <option value="chrome">Chrome</option>
                      <option value="firefox">Firefox</option>
                      <option value="safari">Safari</option>
                      <option value="edge">Edge</option>
                      <option value="">不启用 uTLS</option>
                    </SelectField>
                  </Field>
                </div>
                <div className="mt-4 flex items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm">
                  <span>
                    <span className="block font-medium">允许不安全证书</span>
                    <span className="text-xs text-muted-foreground">
                      仅在确认服务端证书情况时启用
                    </span>
                  </span>
                  <Switch
                    aria-label="允许不安全证书"
                    checked={manual.allowInsecure}
                    onCheckedChange={(checked) =>
                      updateManual({ allowInsecure: checked })
                    }
                  />
                </div>
                {manual.security === 'reality' && (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <Field label="Reality 公钥">
                      <Input
                        value={manual.realityPublicKey}
                        onChange={(event) =>
                          updateManual({ realityPublicKey: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Short ID">
                      <Input
                        value={manual.realityShortId}
                        onChange={(event) =>
                          updateManual({ realityShortId: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                )}
              </section>
            )}

          {manual.protocol === 'hysteria2' && (
            <section className="rounded-xl border bg-slate-50/70 p-4">
              <p className="mb-4 text-sm font-medium">Hysteria2 参数</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  label="上行 Mbps（0 为自动）"
                  value={manual.upMbps}
                  min={0}
                  onChange={(value) => updateManual({ upMbps: value })}
                />
                <NumberField
                  label="下行 Mbps（0 为自动）"
                  value={manual.downMbps}
                  min={0}
                  onChange={(value) => updateManual({ downMbps: value })}
                />
                <Field label="混淆">
                  <SelectField
                    value={manual.obfs}
                    onChange={(value) => updateManual({ obfs: value })}
                  >
                    <option value="">无</option>
                    <option value="salamander">Salamander</option>
                  </SelectField>
                </Field>
                {manual.obfs && (
                  <Field label="混淆密码">
                    <Input
                      type="password"
                      value={manual.obfsPassword}
                      onChange={(event) =>
                        updateManual({ obfsPassword: event.target.value })
                      }
                    />
                  </Field>
                )}
              </div>
            </section>
          )}
        </TabsContent>
        <TabsContent value="json" className="mt-4 space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
            可粘贴单个 sing-box 出站、完整含 outbounds 的 sing-box 配置，或
            3x-ui/Xray 风格的 <code>protocol / settings / streamSettings</code>{' '}
            出站对象。
          </div>
          <Field label="出站 JSON">
            <textarea
              value={draft.json}
              onChange={(event) =>
                onChange({ ...draft, json: event.target.value })
              }
              spellCheck={false}
              className="min-h-80 w-full rounded-xl border border-input bg-[#0b1426] p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </Field>
        </TabsContent>
        <TabsContent value="link" className="mt-4 space-y-3">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
            支持 VLESS、VMess、Shadowsocks、Trojan、Hysteria2 与 SOCKS
            分享链接，名称留空时优先使用链接中的备注。
          </div>
          <Field label="分享链接">
            <textarea
              value={draft.uri}
              onChange={(event) =>
                onChange({ ...draft, uri: event.target.value })
              }
              className="min-h-36 w-full rounded-xl border border-input bg-background p-3 font-mono text-xs leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              placeholder="vless://... / vmess://... / ss://... / trojan://..."
            />
          </Field>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
  tone: 'blue' | 'emerald' | 'violet' | 'amber';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <article className="metric-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div
          className={cn(
            'flex size-10 items-center justify-center rounded-xl',
            colors[tone],
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </article>
  );
}

function OverviewDashboard({
  state,
  enabledGroups,
  healthyNodes,
  totalNodes,
  avgLatency,
  onReload,
}: {
  state: AppState;
  enabledGroups: number;
  healthyNodes: number;
  totalNodes: number;
  avgLatency: number;
  onReload: () => void;
}) {
  const [range, setRange] = useState('1h');
  const [trend, setTrend] = useState<TrafficTrend | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const speedIn = state.groups.reduce(
    (sum, group) => sum + group.stats.speedInMbps,
    0,
  );
  const speedOut = state.groups.reduce(
    (sum, group) => sum + group.stats.speedOutMbps,
    0,
  );
  const traffic = speedIn + speedOut;
  const totalBytes = state.groups.reduce(
    (sum, group) => sum + group.stats.bytesIn + group.stats.bytesOut,
    0,
  );
  const errors = state.runtimeLogs
    .filter((log) => log.level === 'error')
    .slice(0, 4);

  useEffect(() => {
    let active = true;
    async function loadTrend(quiet = false) {
      if (!quiet) setTrendLoading(true);
      try {
        const result = await api<TrafficTrend>(
          `/metrics/history?range=${range}`,
        );
        if (active) setTrend(result);
      } catch {
        // 状态轮询会自动重试，避免短暂重载时连续弹出错误提示。
      } finally {
        if (active && !quiet) setTrendLoading(false);
      }
    }
    void loadTrend();
    const timer = window.setInterval(
      () => void loadTrend(true),
      Math.max(1000, state.settings.metricsSampleIntervalSeconds * 1000),
    );
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [range, state.settings.metricsSampleIntervalSeconds]);

  const chartData = (trend?.points ?? []).map((point) => ({
    time: new Date(point.createdAt).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      ...(range === '30m' || range === '1h' ? { second: '2-digit' } : {}),
    }),
    down: (point.bytesOutPerSecond * 8) / 1_000_000,
    up: (point.bytesInPerSecond * 8) / 1_000_000,
  }));

  return (
    <section className="mt-6 space-y-5">
      <div
        className={cn(
          'overflow-hidden rounded-3xl p-6 text-white shadow-xl',
          state.engine.status === 'running'
            ? 'bg-[radial-gradient(circle_at_85%_10%,#2563eb_0%,#0d1c36_45%)] shadow-blue-200/40'
            : 'bg-[radial-gradient(circle_at_85%_10%,#be123c_0%,#0d1c36_48%)] shadow-rose-200/40',
        )}
      >
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2 text-sm text-slate-300">
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  state.engine.status === 'running'
                    ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]'
                    : 'bg-rose-400',
                )}
              />
              {state.engine.status === 'running'
                ? '真实数据平面在线'
                : '数据平面异常'}
            </div>
            <h2 className="mt-3 text-2xl font-semibold">
              {state.engine.status === 'running'
                ? `${enabledGroups} 个监听端口正在接管流量`
                : state.engine.lastError || '真实引擎尚未启动'}
            </h2>
            <p className="mt-2 text-sm text-slate-300">
              {state.engine.version || 'sing-box 未就绪'} ·{' '}
              {state.engine.balancer === 'builtin'
                ? 'KitsuneGate 内置均衡器'
                : 'HAProxy'}{' '}
              · {`每 ${state.settings.metricsSampleIntervalSeconds}s 采样`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-4">
            <div className="text-right">
              <p className="text-3xl font-semibold tabular-nums">
                {formatSpeed(traffic)}
              </p>
              <div className="mt-1 flex gap-3 text-xs text-slate-300">
                <span>↓ {formatSpeed(speedOut)}</span>
                <span>↑ {formatSpeed(speedIn)}</span>
              </div>
            </div>
            <Button
              className="bg-white text-slate-900 hover:bg-slate-100"
              onClick={onReload}
            >
              <RefreshCw />
              重载引擎
            </Button>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          icon={TrendingUp}
          label="实时双向吞吐"
          value={formatSpeed(traffic)}
          detail={`下行 ${formatSpeed(speedOut)} · 上行 ${formatSpeed(speedIn)}`}
          tone="blue"
        />
        <Metric
          icon={ShieldCheck}
          label="健康节点"
          value={`${healthyNodes}/${totalNodes}`}
          detail={`${totalNodes ? Math.round((healthyNodes / totalNodes) * 100) : 0}% 可用`}
          tone="emerald"
        />
        <Metric
          icon={Gauge}
          label="平均延迟"
          value={`${avgLatency || 0} ms`}
          detail="真实 HTTP 探测"
          tone="violet"
        />
        <Metric
          icon={Activity}
          label="活动连接"
          value={`${state.groups.reduce((sum, group) => sum + group.stats.connections, 0)}`}
          detail={`累计 ${state.groups.reduce((sum, group) => sum + group.stats.totalConnections, 0)} 次`}
          tone="amber"
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <article className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h3 className="font-semibold">流量趋势</h3>
              <p className="text-xs text-muted-foreground">
                按真实采样间隔计算速率，长时段自动降采样
              </p>
            </div>
            <div className="flex rounded-xl bg-slate-100 p-1">
              {['30m', '1h', '6h', '12h', '24h', '7d'].map((item) => (
                <button
                  key={item}
                  onClick={() => setRange(item)}
                  className={cn(
                    'whitespace-nowrap rounded-lg px-2 py-1.5 text-xs transition',
                    range === item
                      ? 'bg-white font-medium text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  {item === '30m'
                    ? '30分钟'
                    : item === '1h'
                      ? '1小时'
                      : item === '6h'
                        ? '6小时'
                        : item === '12h'
                          ? '12小时'
                          : item === '24h'
                            ? '24小时'
                            : '7天'}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-5 h-72 min-h-0 min-w-0">
            {trendLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                读取采样数据...
              </div>
            ) : chartData.length > 1 ? (
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={1}
                minHeight={1}
                initialDimension={{ width: 1, height: 288 }}
              >
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="downFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#2563eb"
                        stopOpacity={0.32}
                      />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="upFill" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="#10b981"
                        stopOpacity={0.22}
                      />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="time"
                    axisLine={false}
                    tickLine={false}
                    minTickGap={32}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value).toFixed(3)} Mbps`,
                      name === 'down' ? '下行' : '上行',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="down"
                    stroke="#2563eb"
                    strokeWidth={2.3}
                    fill="url(#downFill)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="up"
                    stroke="#10b981"
                    strokeWidth={2.1}
                    fill="url(#upFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                icon={TrendingUp}
                title="正在采集真实流量"
                detail="代理端口产生流量后，这里会分别显示上行与下行速率。"
              />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              <i className="mr-1 inline-block size-2 rounded-full bg-blue-600" />
              下行{' '}
              <i className="mr-1 ml-3 inline-block size-2 rounded-full bg-emerald-500" />
              上行
            </span>
            <span>
              {trend?.label ?? ''} · {`${trend?.bucketSeconds ?? 0}s 聚合粒度`}
            </span>
          </div>
        </article>
        <article className="rounded-2xl border bg-white p-5 shadow-sm">
          <h3 className="font-semibold">端口流量排行</h3>
          <p className="text-xs text-muted-foreground">
            来自{' '}
            {state.engine.balancer === 'haproxy'
              ? 'HAProxy 前端'
              : '内置均衡器'}{' '}
            的真实累计字节计数
          </p>
          <div className="mt-5 space-y-4">
            {[...state.groups]
              .sort(
                (a, b) =>
                  b.stats.bytesIn +
                  b.stats.bytesOut -
                  a.stats.bytesIn -
                  a.stats.bytesOut,
              )
              .map((group) => {
                const groupBytes = group.stats.bytesIn + group.stats.bytesOut;
                const width = totalBytes
                  ? Math.max(3, (groupBytes / totalBytes) * 100)
                  : 3;
                return (
                  <div key={group.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">
                        :{group.listenPort} · {group.name}
                      </span>
                      <span>{formatBytes(groupBytes)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-400"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                      <span>{group.stats.connections} 活动连接</span>
                      <span>
                        ↓ {formatSpeed(group.stats.speedOutMbps)} · ↑{' '}
                        {formatSpeed(group.stats.speedInMbps)}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </article>
      </div>
      {errors.length > 0 && (
        <article className="rounded-2xl border border-rose-100 bg-rose-50/60 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <AlertTriangle className="size-4" />
            最近核心错误
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {errors.map((log) => (
              <div key={log.id} className="rounded-xl bg-white/80 p-3">
                <p className="line-clamp-2 text-xs text-rose-800">
                  {log.message}
                </p>
                <p className="mt-1 text-[11px] text-rose-500">
                  {log.source} · {formatTime(log.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

function ProbeResultPanel({
  running,
  reports,
  error,
}: {
  running: boolean;
  reports: ProbeReport[];
  error: string | null;
}) {
  const results = reports.flatMap((report) => report.results);
  const passed = results.filter((result) => result.probe.ok).length;
  if (running)
    return (
      <div className="overflow-hidden rounded-2xl border bg-[#0d1c36] p-6 text-white">
        <div className="flex items-center gap-4">
          <div className="relative flex size-14 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-blue-400/20" />
            <Loader2 className="size-8 animate-spin text-blue-400" />
          </div>
          <div>
            <p className="font-semibold">正在建立真实代理隧道</p>
            <p className="mt-1 text-xs text-slate-400">
              SOCKS5 握手 → 远端代理 → TLS → HTTP 响应
            </p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-2">
          {['连接适配端口', '代理握手', '访问检测地址', '记录选路状态'].map(
            (step, index) => (
              <div key={step}>
                <div
                  className={cn(
                    'h-1.5 rounded-full',
                    index < 3 ? 'animate-pulse bg-blue-400' : 'bg-white/10',
                  )}
                />
                <p className="mt-2 text-[10px] text-slate-400">{step}</p>
              </div>
            ),
          )}
        </div>
      </div>
    );
  if (error)
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
        <div className="flex items-center gap-2 font-semibold text-rose-800">
          <XCircle className="size-5" />
          检测请求失败
        </div>
        <p className="mt-2 text-sm text-rose-700">{error}</p>
      </div>
    );
  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-2xl p-5 text-white',
          results.length && passed === results.length
            ? 'bg-emerald-600'
            : passed
              ? 'bg-amber-500'
              : 'bg-rose-600',
        )}
      >
        <p className="text-sm opacity-80">检测完成</p>
        <div className="mt-1 flex items-end justify-between">
          <p className="text-3xl font-semibold">
            {passed} / {results.length} 通过
          </p>
          <p className="text-sm">
            耗时 {reports.reduce((sum, report) => sum + report.durationMs, 0)}{' '}
            ms
          </p>
        </div>
      </div>
      <div className="max-h-[420px] space-y-2 overflow-auto">
        {reports.map((report) => (
          <section key={report.groupId} className="rounded-xl border p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{report.groupName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {report.probeUrl}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {report.durationMs} ms
              </span>
            </div>
            <div className="space-y-2">
              {report.results.map((result) => (
                <div
                  key={result.id}
                  className={cn(
                    'rounded-lg border px-3 py-2',
                    result.probe.ok
                      ? 'border-emerald-100 bg-emerald-50'
                      : 'border-rose-100 bg-rose-50',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {result.probe.ok ? (
                        <CheckCircle2 className="size-4 text-emerald-600" />
                      ) : (
                        <XCircle className="size-4 text-rose-600" />
                      )}
                      <span className="text-sm font-medium">{result.name}</span>
                    </div>
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        result.probe.ok ? 'text-emerald-700' : 'text-rose-700',
                      )}
                    >
                      {result.probe.latencyMs
                        ? `${Math.round(result.probe.latencyMs)} ms`
                        : '失败'}
                    </span>
                  </div>
                  <p
                    className={cn(
                      'mt-1 pl-6 text-xs',
                      result.probe.ok ? 'text-emerald-700' : 'text-rose-700',
                    )}
                  >
                    {result.probe.ok
                      ? `HTTP ${result.probe.statusCode} · 连续成功 ${result.successCount ?? 0} 次`
                      : `${result.probe.error} · 连续失败 ${result.failureCount ?? 0} 次`}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!results.length && (
          <Empty
            icon={WifiOff}
            title="没有可检测节点"
            detail="请先启用至少一个真实代理节点。"
          />
        )}
      </div>
    </div>
  );
}

function GroupCard({
  group,
  busy,
  onDetails,
  onTest,
  onToggle,
}: {
  group: ProxyGroup;
  busy: string | null;
  onDetails: (group: ProxyGroup) => void;
  onTest: (group: ProxyGroup) => void;
  onToggle: () => void;
}) {
  const ratio = group.stats.total
    ? (group.stats.healthy / group.stats.total) * 100
    : 0;
  return (
    <article
      className={cn(
        'pool-card overflow-hidden',
        !group.enabled && 'opacity-65',
      )}
    >
      <div className="flex items-start justify-between p-5">
        <div className="flex gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700">
            {group.regionCode}
          </div>
          <div>
            <h3 className="font-semibold">{group.name}</h3>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
              {group.listenHost}:{group.listenPort}
            </p>
          </div>
        </div>
        <Switch
          checked={group.enabled}
          onCheckedChange={onToggle}
          aria-label="启用代理组"
        />
      </div>
      <div className="grid grid-cols-3 border-y bg-slate-50/70 px-5 py-3 text-center">
        <div>
          <p className="text-sm font-semibold">
            {group.stats.healthy}/{group.stats.total}
          </p>
          <p className="text-[11px] text-muted-foreground">健康节点</p>
        </div>
        <div className="border-x">
          <p className="text-sm font-semibold">{group.stats.connections}</p>
          <p className="text-[11px] text-muted-foreground">活动连接</p>
        </div>
        <div>
          <p className="text-sm font-semibold">{group.stats.throughputMbps}</p>
          <p className="text-[11px] text-muted-foreground">Mbps</p>
        </div>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {modeLabels[group.mode]} · {modeDescriptions[group.mode]}
          </span>
          <span className="font-medium">{Math.round(ratio)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className={cn(
              'h-full rounded-full',
              ratio >= 75 ? 'bg-emerald-500' : 'bg-amber-500',
            )}
            style={{ width: `${ratio}%` }}
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onTest(group)}
            disabled={busy === `test-${group.id}`}
          >
            <Play />
            检测
          </Button>
          <Button size="sm" className="flex-1" onClick={() => onDetails(group)}>
            管理
            <ArrowRight />
          </Button>
        </div>
      </div>
    </article>
  );
}

function GroupForm({
  draft,
  onChange,
  compact = false,
}: {
  draft: GroupDraft;
  onChange: (draft: GroupDraft) => void;
  compact?: boolean;
}) {
  const modeHelp =
    draft.mode === 'load_balance'
      ? `负载均衡使用“${draft.algorithm === 'leastconn' ? '加权最少连接' : draft.algorithm === 'roundrobin' ? '加权轮询' : '按权重随机'}”算法。`
      : draft.mode === 'fallback'
        ? '按节点“故障优先级”从小到大选择，主节点失败达到阈值后自动回退。'
        : draft.mode === 'latency_best'
          ? '根据真实 HTTP 检测延迟选择节点，延迟容差在“检测”页设置。'
          : '只使用节点页中手动选定的节点；选定节点不可用时连接会明确失败。';
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="代理组名称">
        <Input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="例如 香港代理"
        />
      </Field>
      <Field label="地区代码">
        <Input
          value={draft.regionCode}
          onChange={(e) =>
            onChange({ ...draft, regionCode: e.target.value.toUpperCase() })
          }
          placeholder="HK"
          maxLength={4}
        />
      </Field>
      <Field label="监听地址">
        <Input
          value={draft.listenHost}
          onChange={(e) => onChange({ ...draft, listenHost: e.target.value })}
        />
      </Field>
      <Field label="监听端口">
        <Input
          type="number"
          min={1}
          max={65535}
          value={draft.listenPort}
          onChange={(e) =>
            onChange({ ...draft, listenPort: Number(e.target.value) })
          }
        />
      </Field>
      <Field label="运行模式">
        <SelectField
          value={draft.mode}
          onChange={(value) => onChange({ ...draft, mode: value as Mode })}
        >
          <option value="load_balance">负载均衡</option>
          <option value="fallback">故障回退</option>
          <option value="latency_best">延迟优选</option>
          <option value="fixed">指定节点</option>
        </SelectField>
      </Field>
      {draft.mode === 'load_balance' ? (
        <Field label="均衡算法">
          <SelectField
            value={draft.algorithm}
            onChange={(value) =>
              onChange({
                ...draft,
                algorithm: value as GroupDraft['algorithm'],
              })
            }
          >
            <option value="leastconn">加权最少连接</option>
            <option value="roundrobin">加权轮询</option>
            <option value="random">按权重随机</option>
          </SelectField>
        </Field>
      ) : (
        <div className="rounded-xl border border-dashed bg-slate-50 px-3 py-2">
          <p className="text-xs font-medium text-slate-700">
            {modeLabels[draft.mode]}专用策略
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            此模式不使用均衡算法
          </p>
        </div>
      )}
      {!compact && (
        <div className="sm:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
          <Zap className="mr-1 inline size-3.5 text-blue-500" />
          {modeHelp}
        </div>
      )}
    </div>
  );
}

function HealthForm({
  draft,
  onChange,
}: {
  draft: GroupDraft;
  onChange: (draft: GroupDraft) => void;
}) {
  return (
    <>
      <Field label="检测地址（每行一个）">
        <textarea
          value={draft.probeUrls.join('\n')}
          onChange={(e) =>
            onChange({ ...draft, probeUrls: e.target.value.split('\n') })
          }
          className="min-h-24 w-full rounded-lg border border-input bg-background p-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <NumberField
          label="检测间隔（秒）"
          value={draft.probeInterval}
          onChange={(value) => onChange({ ...draft, probeInterval: value })}
        />
        <NumberField
          label="超时（秒）"
          value={draft.probeTimeout}
          onChange={(value) => onChange({ ...draft, probeTimeout: value })}
        />
        <NumberField
          label="连续失败阈值"
          value={draft.fallThreshold}
          onChange={(value) => onChange({ ...draft, fallThreshold: value })}
        />
        <NumberField
          label="连续恢复阈值"
          value={draft.riseThreshold}
          onChange={(value) => onChange({ ...draft, riseThreshold: value })}
        />
        {draft.mode === 'latency_best' && (
          <NumberField
            label="延迟切换容差（ms）"
            value={draft.latencyTolerance}
            onChange={(value) =>
              onChange({ ...draft, latencyTolerance: value })
            }
          />
        )}
      </div>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800">
        {
          '检测会经节点独立的 sing-box SOCKS 适配端口发起真实 HTTP/HTTPS 请求。失败与恢复阈值用于抑制偶发网络抖动。'
        }
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min = 1,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NodeRow({
  node,
  language,
  selectable,
  selected,
  busy,
  onSelect,
  onEdit,
  onToggle,
  onTest,
  onDelete,
}: {
  node: ProxyNode;
  language: UiLanguage;
  selectable: boolean;
  selected: boolean;
  busy: string | null;
  onSelect: () => void;
  onEdit: () => void;
  onToggle: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const sourceLabel =
    node.sourceType === 'manual'
      ? '基础配置'
      : node.sourceType === 'json'
        ? 'JSON'
        : '分享链接';
  return (
    <div
      className={cn(
        'rounded-xl border p-3 transition',
        selected ? 'border-blue-300 bg-blue-50/50' : 'bg-white',
        !node.enabled && 'opacity-65',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          className="min-w-0 flex-1 text-left"
          onClick={selectable ? onSelect : undefined}
        >
          <div className="flex flex-wrap items-center gap-2">
            <StatusDot status={node.healthStatus} />
            <span className="truncate text-sm font-medium">{node.name}</span>
            <Badge variant="outline" className="bg-white text-[10px]">
              {sourceLabel}
            </Badge>
            {selected && <Badge className="bg-blue-600">已选择</Badge>}
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {node.protocol.toUpperCase()} · {node.server}:{node.serverPort}
            {' · '}
            <span>适配端口</span> {node.adapterPort}
          </p>
          <p
            className={cn(
              'mt-1 text-[11px]',
              node.lastError ? 'text-rose-600' : 'text-muted-foreground',
            )}
          >
            {node.latencyMs
              ? `${node.latencyMs} ms`
              : node.lastError || '等待真实检测'}{' '}
            · <span>权重</span> {node.weight} · <span>优先级</span>{' '}
            {node.priority}
          </p>
        </button>
        <Switch
          checked={node.enabled}
          onCheckedChange={onToggle}
          aria-label={translateUiText('启用节点', language)}
        />
      </div>
      <div className="mt-3 flex justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          disabled={busy === `edit-${node.id}`}
        >
          <Pencil />
          修改
        </Button>
        <Button variant="ghost" size="sm" onClick={onTest}>
          <Play />
          真实检测
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 />
          删除
        </Button>
      </div>
    </div>
  );
}

function NodesTable({
  rows,
  busy,
  onEdit,
  onTest,
  onToggle,
}: {
  rows: { node: ProxyNode; group: ProxyGroup }[];
  busy: string | null;
  onEdit: (node: ProxyNode) => void;
  onTest: (node: ProxyNode) => void;
  onToggle: (node: ProxyNode) => void;
}) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold">全部节点</h2>
        <p className="text-xs text-muted-foreground">
          跨代理组查看、检测并修改完整节点配置
        </p>
      </div>
      <div className="divide-y">
        {rows.map(({ node, group }) => (
          <div
            key={node.id}
            className="grid items-center gap-3 px-5 py-4 sm:grid-cols-[1.4fr_.8fr_.6fr_auto]"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <StatusDot status={node.healthStatus} />
                <span className="truncate text-sm font-medium">
                  {node.name}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {node.server}:{node.serverPort}
              </p>
            </div>
            <div>
              <p className="text-sm">{group.name}</p>
              <p className="text-xs text-muted-foreground">
                :{group.listenPort}
              </p>
            </div>
            <div>
              <p
                className={cn(
                  'text-sm font-medium',
                  node.healthStatus === 'unhealthy' && 'text-rose-600',
                )}
              >
                {node.latencyMs
                  ? `${node.latencyMs} ms`
                  : node.healthStatus === 'unhealthy'
                    ? '检测失败'
                    : '待检测'}
              </p>
              <p className="text-xs text-muted-foreground">
                {node.protocol.toUpperCase()}
              </p>
            </div>
            <div className="flex items-center justify-end gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onEdit(node)}
                disabled={busy === `edit-${node.id}`}
              >
                <Pencil />
                <span className="sr-only">修改</span>
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={() => onTest(node)}
              >
                <Play />
                <span className="sr-only">真实检测</span>
              </Button>
              <Switch
                checked={node.enabled}
                onCheckedChange={() => onToggle(node)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function HealthCenter({
  groups,
  running,
  onTestAll,
  onOpen,
}: {
  groups: ProxyGroup[];
  running: boolean;
  onTestAll: () => void;
  onOpen: (group: ProxyGroup) => void;
}) {
  const nodes = groups
    .flatMap((group) => group.nodes)
    .filter((node) => node.enabled);
  const healthy = nodes.filter(
    (node) => node.healthStatus === 'healthy',
  ).length;
  const unknown = nodes.filter(
    (node) => node.healthStatus === 'unknown',
  ).length;
  const percent = nodes.length ? Math.round((healthy / nodes.length) * 100) : 0;
  return (
    <section className="mt-6 space-y-5">
      <div className="overflow-hidden rounded-3xl bg-[#0d1c36] p-6 text-white shadow-xl shadow-slate-300/40">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <Badge className="border-white/10 bg-white/10 text-emerald-300">
              真实 HTTP/HTTPS 探测
            </Badge>
            <h2 className="mt-4 text-2xl font-semibold">
              {`全局健康度 ${percent}%`}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">
              每次检测都穿过节点协议栈与远端服务器，失败结果会进入选路策略和运行日志。
            </p>
          </div>
          <div className="flex items-center gap-5">
            <div
              className="relative flex size-28 items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(#34d399 ${percent * 3.6}deg, rgba(255,255,255,.12) 0deg)`,
              }}
            >
              <div className="flex size-20 flex-col items-center justify-center rounded-full bg-[#0d1c36]">
                <span className="text-2xl font-semibold">{healthy}</span>
                <span className="text-[11px] text-slate-400">
                  {`健康 / ${nodes.length}`}
                </span>
              </div>
            </div>
            <Button
              className="bg-white text-slate-900 hover:bg-slate-100"
              onClick={onTestAll}
              disabled={running}
            >
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              检测全部
            </Button>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/10 pt-5">
          <div>
            <p className="text-xl font-semibold text-emerald-300">{healthy}</p>
            <p className="text-xs text-slate-400">健康节点</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-rose-300">
              {nodes.length - healthy - unknown}
            </p>
            <p className="text-xs text-slate-400">确认故障</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-amber-300">{unknown}</p>
            <p className="text-xs text-slate-400">阈值观察中</p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const active = group.nodes.filter((node) => node.enabled);
          const lastCheck =
            active
              .map((node) => node.lastCheckedAt)
              .filter(Boolean)
              .sort((a, b) => String(a).localeCompare(String(b)))
              .at(-1) ?? null;
          return (
            <article
              key={group.id}
              className="rounded-2xl border bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-xl bg-blue-50 font-bold text-blue-700">
                    {group.regionCode}
                  </div>
                  <div>
                    <p className="font-semibold">{group.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {group.probeUrls[0]}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => onOpen(group)}>
                  设置
                  <ArrowRight />
                </Button>
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <p className="text-3xl font-semibold tracking-tight">
                    {group.stats.healthy}
                    <span className="text-base font-normal text-muted-foreground">
                      {' '}
                      / {active.length}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {`每 ${group.probeInterval}s · 超时 ${group.probeTimeout}s · 失败 ${group.fallThreshold} 次下线`}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatTime(lastCheck)}
                </p>
              </div>
              <div className="mt-4 space-y-2">
                {active.map((node) => (
                  <div
                    key={node.id}
                    className="grid grid-cols-[1fr_70px] items-center gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <StatusDot status={node.healthStatus} />
                      <span className="truncate text-xs">{node.name}</span>
                    </div>
                    <span
                      className={cn(
                        'text-right text-xs font-medium',
                        node.healthStatus === 'unhealthy' && 'text-rose-600',
                      )}
                    >
                      {node.latencyMs
                        ? `${node.latencyMs} ms`
                        : node.healthStatus === 'unhealthy'
                          ? '失败'
                          : '待确认'}
                    </span>
                  </div>
                ))}
                {!active.length && (
                  <p className="rounded-lg bg-slate-50 py-4 text-center text-xs text-muted-foreground">
                    没有启用节点
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EventList({
  events,
  logs,
  groups,
}: {
  events: RelayEvent[];
  logs: RuntimeLog[];
  groups: ProxyGroup[];
}) {
  const [level, setLevel] = useState('all');
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const [filteredLogs, setFilteredLogs] = useState(logs);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoadingLogs(true);
      try {
        const params = new URLSearchParams({
          level,
          source,
          search,
          limit: '500',
        });
        const result = await api<{ logs: RuntimeLog[] }>(`/logs?${params}`);
        if (active) setFilteredLogs(result.logs);
      } catch {
        // 保留上一次日志结果，下一轮状态刷新时自动重试。
      } finally {
        if (active) setLoadingLogs(false);
      }
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [level, source, search, logs]);

  return (
    <section className="mt-6">
      <Tabs defaultValue="logs">
        <TabsList>
          <TabsTrigger value="logs">核心运行日志</TabsTrigger>
          <TabsTrigger value="events">配置与检测事件</TabsTrigger>
        </TabsList>
        <TabsContent
          value="logs"
          className="mt-4 overflow-hidden rounded-2xl border bg-[#0b1426] shadow-sm"
        >
          <div className="border-b border-white/10 p-5 text-white">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <h2 className="font-semibold">实时运行日志</h2>
                <p className="text-xs text-slate-400">
                  按进程来源、等级和关键字检索已保留的日志
                </p>
              </div>
              <Badge className="w-fit bg-emerald-500/15 text-emerald-300">
                {loadingLogs ? '查询中…' : `${filteredLogs.length} 条结果`}
              </Badge>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-[160px_160px_1fr]">
              <SelectField value={source} onChange={setSource} tone="dark">
                <option value="all">全部来源</option>
                <option value="sing-box">代理核心 · sing-box</option>
                <option value="haproxy">HAProxy</option>
                <option value="api">管理 API</option>
                <option value="engine">运行管理器</option>
                <option value="balancer">内置均衡器</option>
              </SelectField>
              <SelectField value={level} onChange={setLevel} tone="dark">
                <option value="all">全部等级</option>
                <option value="debug">DEBUG</option>
                <option value="info">INFO</option>
                <option value="warning">WARNING</option>
                <option value="error">ERROR</option>
              </SelectField>
              <div className="relative">
                <Search className="absolute top-2.5 left-3 size-4 text-slate-500" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索错误、节点名、端口或消息内容"
                  className="border-white/10 bg-white/5 pl-9 text-slate-100 placeholder:text-slate-500"
                />
              </div>
            </div>
          </div>
          <div className="max-h-[680px] divide-y divide-white/5 overflow-auto">
            {filteredLogs.map((log) => (
              <div
                key={log.id}
                className="grid gap-2 px-5 py-3 font-mono text-xs sm:grid-cols-[70px_90px_1fr_135px]"
              >
                <span
                  className={cn(
                    'font-semibold uppercase',
                    log.level === 'error'
                      ? 'text-rose-400'
                      : log.level === 'warning'
                        ? 'text-amber-300'
                        : log.level === 'debug'
                          ? 'text-violet-300'
                          : 'text-emerald-400',
                  )}
                >
                  {log.level}
                </span>
                <span className="text-blue-300">{log.source}</span>
                <span className="break-all text-slate-300">{log.message}</span>
                <span className="text-right text-slate-500">
                  {formatTime(log.createdAt)}
                </span>
              </div>
            ))}
            {!filteredLogs.length && (
              <Empty
                icon={Activity}
                title="没有匹配日志"
                detail="调整来源、等级或搜索关键字后重试。"
              />
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="events"
          className="mt-4 overflow-hidden rounded-2xl border bg-white shadow-sm"
        >
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">配置与检测事件</h2>
            <p className="text-xs text-muted-foreground">
              用户操作、真实探测结果和状态变化
            </p>
          </div>
          <div className="divide-y">
            {events.map((event) => {
              const group = groups.find((item) => item.id === event.groupId);
              return (
                <div key={event.id} className="flex gap-3 px-5 py-4">
                  <div
                    className={cn(
                      'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                      event.severity === 'error'
                        ? 'bg-rose-50 text-rose-600'
                        : event.severity === 'success'
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-blue-50 text-blue-600',
                    )}
                  >
                    {event.severity === 'error' ? (
                      <AlertTriangle className="size-4" />
                    ) : (
                      <Activity className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm">{event.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {group?.name ?? '系统'} · {formatTime(event.createdAt)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: AppSettings;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const saved = await api<AppSettings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(draft),
      });
      setDraft(saved);
      await onSaved();
      toast.add({
        title: '系统设置已保存',
        description: '采样调度、日志等级和界面语言已经实时生效。',
        type: 'success',
      });
    } catch (error) {
      toast.add({
        title: '保存失败',
        description: error instanceof Error ? error.message : '未知错误',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 space-y-5">
      <div className="overflow-hidden rounded-3xl bg-[radial-gradient(circle_at_90%_0%,#4f46e5_0%,#111c35_45%)] p-6 text-white shadow-xl shadow-indigo-200/40">
        <div className="flex items-center gap-4">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-white/10">
            <SlidersHorizontal className="size-6 text-indigo-200" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">采集与存储策略</h2>
            <p className="mt-1 text-sm text-slate-300">
              修改后无需重启容器；核心配置会自动安全重载。
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <article className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <TrendingUp className="size-5" />
            </div>
            <div>
              <h3 className="font-semibold">流量监控</h3>
              <p className="text-xs text-muted-foreground">
                控制 HAProxy 统计套接字的读取频率与历史数据容量
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-5">
            <NumberField
              label="采样间隔（秒）"
              value={draft.metricsSampleIntervalSeconds}
              min={1}
              max={60}
              onChange={(value) =>
                setDraft({ ...draft, metricsSampleIntervalSeconds: value })
              }
            />
            <p className="-mt-3 text-xs leading-5 text-muted-foreground">
              支持 1–60 秒。1 秒最接近实时，但会增加 SQLite 写入和 HAProxy
              管理套接字负载。
            </p>
            <NumberField
              label="流量明细保留天数"
              value={draft.metricsRetentionDays}
              min={1}
              max={30}
              onChange={(value) =>
                setDraft({ ...draft, metricsRetentionDays: value })
              }
            />
            <p className="-mt-3 text-xs leading-5 text-muted-foreground">
              支持 1–30 天；趋势查询会依据时间范围自动使用 5 秒至 30
              分钟的聚合粒度。
            </p>
          </div>
        </article>
        <article className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Activity className="size-5" />
            </div>
            <div>
              <h3 className="font-semibold">运行日志</h3>
              <p className="text-xs text-muted-foreground">
                统一控制面板、代理核心和 HAProxy 的日志留存
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-5">
            <Field label="最低记录等级">
              <SelectField
                value={draft.logLevel}
                onChange={(value) =>
                  setDraft({
                    ...draft,
                    logLevel: value as AppSettings['logLevel'],
                  })
                }
              >
                <option value="debug">Debug · 诊断明细</option>
                <option value="info">Info · 日常运行</option>
                <option value="warning">Warning · 警告及错误</option>
                <option value="error">Error · 仅错误</option>
              </SelectField>
            </Field>
            <p className="-mt-3 text-xs leading-5 text-muted-foreground">
              该等级同时应用到 sing-box 输出和 KitsuneGate 日志入库过滤。
            </p>
            <NumberField
              label="日志保留天数"
              value={draft.logRetentionDays}
              min={1}
              max={90}
              onChange={(value) =>
                setDraft({ ...draft, logRetentionDays: value })
              }
            />
            <p className="-mt-3 text-xs leading-5 text-muted-foreground">
              支持 1–90 天，后台每分钟清理过期记录。
            </p>
          </div>
        </article>
        <article className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Languages className="size-5" />
            </div>
            <div>
              <h3 className="font-semibold">语言与区域</h3>
              <p className="text-xs text-muted-foreground">
                选择管理面板的显示语言
              </p>
            </div>
          </div>
          <div className="mt-6 space-y-5">
            <Field label="界面语言">
              <SelectField
                value={draft.uiLanguage}
                onChange={(value) =>
                  setDraft({ ...draft, uiLanguage: value as UiLanguage })
                }
              >
                {UI_LANGUAGES.map((language) => (
                  <option key={language.value} value={language.value}>
                    {language.nativeLabel}
                  </option>
                ))}
              </SelectField>
            </Field>
            <p className="-mt-3 text-xs leading-5 text-muted-foreground">
              语言设置会保存在服务器上，并应用到所有浏览器。
            </p>
          </div>
        </article>
      </div>
      <div className="flex items-center justify-between rounded-2xl border bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-medium">当前预计刷新延迟</p>
          <p className="text-xs text-muted-foreground">
            页面刷新会跟随采样间隔，最低约 1 秒。
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}保存并应用
        </Button>
      </div>
    </section>
  );
}

function ConfigPreview({
  preview,
  loading,
  onReload,
}: {
  preview: { haproxy: string; singbox: string } | null;
  loading: boolean;
  onReload: () => void;
}) {
  const [kind, setKind] = useState<'haproxy' | 'singbox'>('haproxy');
  const content = preview?.[kind] ?? '';
  async function copy() {
    await navigator.clipboard.writeText(content);
    toast.add({ title: '配置已复制', type: 'success' });
  }
  if (loading && !preview)
    return (
      <div className="flex min-h-56 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        正在生成配置...
      </div>
    );
  return (
    <>
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
        <Code2 className="mr-1 inline size-4" />
        {
          'sing-box 配置已由真实核心加载。Windows 本地版使用内置 TCP 均衡器；HAProxy 配置为后续 Linux/Docker 部署保留。'
        }
      </div>
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setKind('haproxy')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs',
              kind === 'haproxy' && 'bg-white font-medium shadow-sm',
            )}
          >
            HAProxy（部署预览）
          </button>
          <button
            onClick={() => setKind('singbox')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs',
              kind === 'singbox' && 'bg-white font-medium shadow-sm',
            )}
          >
            sing-box（当前运行）
          </button>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onReload}>
            <RefreshCw />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy()}
            disabled={!content}
          >
            <Clipboard />
            复制
          </Button>
        </div>
      </div>
      <pre className="max-h-[460px] overflow-auto rounded-xl bg-[#0b1426] p-4 text-[11px] leading-5 text-slate-200">
        <code>{content || '暂无配置'}</code>
      </pre>
    </>
  );
}

function Empty({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Activity;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-44 flex-col items-center justify-center p-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        <Icon className="size-5" />
      </div>
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}
