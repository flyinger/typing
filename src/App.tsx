import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, JSX } from "react";
import type { OnMount } from "@monaco-editor/react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Database,
  Download,
  Dumbbell,
  FileUp,
  Flame,
  Gauge,
  Import,
  Keyboard,
  Moon,
  Play,
  RefreshCcw,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AppSettings,
  ExerciseItem,
  InputEventLog,
  MaterialPack,
  SyncPackage,
  TrainingMode,
  TrainingSession,
} from "./types";
import { db, ensureInitialized, replaceAllData } from "./lib/db";
import { localDateKey, millisecondsUntilNextLocalMinute } from "./lib/date";
import { createEventId, createId } from "./lib/id";
import {
  averageMetrics,
  buildTrendPoints,
  calculateSessionMetrics,
  calculateStreak,
  chooseBestTargetForInput,
  classifyBurstInput,
  getRecentSessions,
  includeFinalPause,
  rankWeakKeys,
  rankWeakTargets,
} from "./lib/metrics";
import {
  buildErrorPositionHotspots,
  buildKeyboardHeatmap,
  buildPausePositionHotspots,
  buildTrainingCalendarHeatmap,
  buildWubiRootHeatmap,
  type ActivityHeatmapDay,
  type HeatmapKeyCell,
  type TextHotspot,
} from "./lib/heatmaps";
import { createMaterialPackFromRime } from "./lib/rimeParser";
import {
  createSyncPackage,
  encodeJsonlDownload,
  mergeSyncCollections,
  parseSyncPackage,
  previewSyncMerge,
  type SyncMergePreview,
} from "./lib/sync";
import {
  createSyncFolderExport,
  encodeSyncFolderExport,
  parseSyncFolderExport,
  parseSyncFolderFiles,
} from "./lib/syncFolder";
import {
  isFileSystemAccessSupported,
  pickReadableDirectory,
  pickWritableDirectory,
  readSyncFolderFilesFromDirectory,
  writeSyncFolderExportToDirectory,
  type WritableFileSystemDirectoryHandle,
} from "./lib/syncFolderWriter";
import {
  createMaterialPackFromText,
  type TextMaterialPackDraft,
} from "./lib/materialImport";
import {
  generateProfessionalMaterialDrafts,
  type ProfessionalMaterialDraft,
} from "./lib/professionalMaterialGenerator";
import {
  buildFoundationMaterialReadiness,
  type FoundationMaterialReadiness,
  type FoundationMaterialModeReadiness,
} from "./lib/materialReadiness";
import { normalizeSettingsDraft, type SettingsDraft } from "./lib/settings";
import {
  buildRemainingDailyPlan,
  buildFoundationLiveSampleStatus,
  buildFoundationSprintPlan,
  buildFoundationModeAdvice,
  buildTrainingRoadmap,
  buildTrainingProtocol,
  type DailyPlanStep,
  type FoundationLiveSampleStatus,
  type FoundationSprintPlan,
  type FoundationSprintBlock,
  type TrainingProtocol,
  type TrainingRoadmapPhase,
  getFoundationReport,
  getTrainingStage,
  isFoundationQualitySession,
} from "./lib/trainingPlan";
import {
  buildWeeklyReviewReport,
  type WeeklyReviewReport,
  type WeeklyTrainingPlanItem,
} from "./lib/weeklyReview";
import { weeklyReviewToMarkdown } from "./lib/weeklyReviewExport";
import { buildAdaptiveQueue } from "./lib/adaptiveQueue";
import {
  buildTodayRecommendations,
  buildTodayQueueReadiness,
  buildTodayTrainingQueue,
  summarizeDailyPlanQueueCoverage,
  type TodayRecommendation,
  type TodayQueueReadiness,
  type TodayTrainingQueueItem,
  type TrainingQueueCoverageIssue,
} from "./lib/todayRecommendations";
import {
  buildNextPracticeRecommendation,
  type NextPracticeRecommendation,
} from "./lib/practiceRecommendation";
import { buildManualPracticeModeWarning } from "./lib/practiceModeWarning";
import {
  hasUnsavedPracticeInput,
  practiceDiscardMessage,
  type PracticeDiscardAction,
} from "./lib/practiceExitGuard";
import {
  buildPracticeLiveStats,
  isPracticeInputComplete,
  type PracticeLiveStats,
} from "./lib/practiceLiveStats";
import {
  buildPracticeCursorInfo,
  formatPracticeKey,
} from "./lib/practiceTargetDisplay";
import {
  buildWeeklyPlanTrainingQueue,
  summarizeWeeklyPlanQueueCoverage,
} from "./lib/weeklyPlanQueue";
import { buildPracticePrescription } from "./lib/practicePrescription";
import { buildSyncHealthReport, type SyncHealthReport } from "./lib/syncHealth";
import { syncFingerprintLabel } from "./lib/syncFingerprint";
import {
  mergeCompletedTrainingRecords,
  sortInputEventsForTimeline,
  sortTrainingSessionsNewestFirst,
} from "./lib/trainingRecords";
import {
  buildTrainingSchedule,
  type TrainingSchedule,
  type TrainingScheduleDay,
} from "./lib/trainingSchedule";
import { downloadText, sessionsToCsv } from "./lib/csv";
import {
  eventsJsonlFilename,
  sessionsCsvFilename,
  syncFolderManifestFilename,
  syncPackageFilename,
  weeklyReviewMarkdownFilename,
} from "./lib/exportNames";
import { twelveWeekPlan, wubiTutorial } from "./data/wubiTutorial";
import { sampleMaterialPacks } from "./data/sampleMaterials";
import { filterMaterialPacks, summarizeMaterialPacks } from "./lib/materials";

type View = "today" | "practice" | "analytics" | "materials" | "tutorial" | "settings";
type AnalyticsTab = "overview" | "foundation" | "weekly" | TrainingMode;
type SyncImportKind = "package" | "folder" | "directory";

interface PendingSyncImport {
  kind: SyncImportKind;
  fileName: string;
  incoming: SyncPackage;
  preview: SyncMergePreview;
  healthAfter: SyncHealthReport;
}

interface ActivePracticeQueue {
  title: string;
  items: TodayTrainingQueueItem[];
  index: number;
}

interface PracticeQueueProgress {
  title: string;
  currentIndex: number;
  total: number;
  current: TodayTrainingQueueItem;
  next?: TodayTrainingQueueItem;
}

const modeLabels: Record<TrainingMode, string> = {
  "wubi-code": "五笔编码",
  "chinese-real": "中文真实",
  english: "英文/术语",
  code: "代码",
  vim: "Vim",
};

const modeDescriptions: Record<TrainingMode, string> = {
  "wubi-code": "直接输入编码，不走输入法。",
  "chinese-real": "使用 Rime 五笔完成真实中文段落。",
  english: "训练英文技术短语和键盘熟练度。",
  code: "精确输入代码、符号、缩进。",
  vim: "练习 Vim 操作序列和肌肉记忆。",
};

const syncImportKindLabels: Record<SyncImportKind, string> = {
  package: "同步包",
  folder: "同步目录清单",
  directory: "同步目录",
};

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface PracticeCounters {
  backspaces: number;
  pauseCountOver1500Ms: number;
  maxPauseMs: number;
  hintCount: number;
  pasteEventCount: number;
  compositionEventCount: number;
  wrongKeys: string[];
}

function emptyCounters(): PracticeCounters {
  return {
    backspaces: 0,
    pauseCountOver1500Ms: 0,
    maxPauseMs: 0,
    hintCount: 0,
    pasteEventCount: 0,
    compositionEventCount: 0,
    wrongKeys: [],
  };
}

function firstChangedIndex(before: string, after: string): number {
  const maxLength = Math.max(before.length, after.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (before[index] !== after[index]) return index;
  }
  return after.length;
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [events, setEvents] = useState<InputEventLog[]>([]);
  const [materials, setMaterials] = useState<MaterialPack[]>([]);
  const [view, setView] = useState<View>("today");
  const [selectedMode, setSelectedMode] = useState<TrainingMode>("english");
  const [selectedItem, setSelectedItem] = useState<ExerciseItem | null>(null);
  const [lastSession, setLastSession] = useState<TrainingSession | null>(null);
  const [activePracticeQueue, setActivePracticeQueue] = useState<ActivePracticeQueue | null>(null);
  const [practiceRunId, setPracticeRunId] = useState(0);
  const [notice, setNotice] = useState<string>("");
  const [pendingSyncImport, setPendingSyncImport] = useState<PendingSyncImport | null>(null);
  const [syncDirectoryHandle, setSyncDirectoryHandle] =
    useState<WritableFileSystemDirectoryHandle | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  async function refresh(): Promise<void> {
    const [loadedSessions, loadedEvents, loadedMaterials, loadedSettings] =
      await Promise.all([
        db.sessions.toArray(),
        db.events.toArray(),
        db.materials.toArray(),
        db.settings.get("main"),
      ]);
    setSessions(sortTrainingSessionsNewestFirst(loadedSessions));
    setEvents(sortInputEventsForTimeline(loadedEvents));
    setMaterials(loadedMaterials);
    setSettings(loadedSettings ?? null);
  }

  useEffect(() => {
    ensureInitialized().then(refresh);
  }, []);

  useEffect(() => {
    let intervalId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      setCurrentTime(new Date());
      intervalId = window.setInterval(() => setCurrentTime(new Date()), 60000);
    }, millisecondsUntilNextLocalMinute());

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [view, practiceRunId]);

  const allItems = useMemo(() => materials.flatMap((material) => material.items), [materials]);
  const todaySessions = useMemo(() => {
    const today = localDateKey(currentTime);
    return sessions.filter((session) => localDateKey(session.startedAt) === today);
  }, [sessions, currentTime]);
  const todayMinutes = todaySessions.reduce((sum, session) => sum + session.durationMs / 60000, 0);
  const streak = calculateStreak(sessions, currentTime);
  const trend30 = buildTrendPoints(sessions, 30, currentTime);
  const weakTargets = rankWeakTargets(sessions, 20);
  const weakKeys = rankWeakKeys(sessions, 20);
  const evaluationNow = currentTime;
  const evaluationOptions = useMemo(() => ({ now: evaluationNow }), [evaluationNow]);
  const trainingStage = getTrainingStage(sessions, evaluationOptions);
  const foundationReport = getFoundationReport(sessions, evaluationOptions);
  const trainingProtocol = useMemo(
    () => buildTrainingProtocol(sessions, evaluationOptions),
    [sessions, evaluationOptions],
  );
  const remainingDailyPlan = useMemo(
    () =>
      settings
        ? buildRemainingDailyPlan(
            settings.dailyTargetMinutes,
            todayMinutes,
            sessions,
            weakTargets.length > 0,
            evaluationOptions,
          )
        : [],
    [settings, sessions, todayMinutes, weakTargets.length, evaluationOptions],
  );
  const syncHealth = useMemo(
    () => (settings ? buildSyncHealthReport(settings, sessions, events, materials, currentTime) : null),
    [settings, sessions, events, materials, currentTime],
  );
  const recommendationSessions = useMemo(() => {
    if (!lastSession || sessions.some((session) => session.id === lastSession.id)) return sessions;
    return [lastSession, ...sessions];
  }, [lastSession, sessions]);
  const todayRecommendations = useMemo(
    () => buildTodayRecommendations(allItems, sessions, { limit: 18, now: evaluationNow }),
    [allItems, sessions, evaluationNow],
  );
  const todayQueuePreview = useMemo(
    () =>
      buildTodayTrainingQueue(todayRecommendations, 0, {
        planSteps: remainingDailyPlan,
      }),
    [todayRecommendations, remainingDailyPlan],
  );
  const todayQueueReadiness = useMemo(
    () => buildTodayQueueReadiness(remainingDailyPlan, todayQueuePreview),
    [remainingDailyPlan, todayQueuePreview],
  );
  const foundationMaterialReadiness = useMemo(
    () => buildFoundationMaterialReadiness(allItems),
    [allItems],
  );
  const practiceQueueProgress = useMemo<PracticeQueueProgress | null>(() => {
    if (!activePracticeQueue) return null;
    const current = activePracticeQueue.items[activePracticeQueue.index];
    if (!current) return null;
    return {
      title: activePracticeQueue.title,
      currentIndex: activePracticeQueue.index,
      total: activePracticeQueue.items.length,
      current,
      next: activePracticeQueue.items[activePracticeQueue.index + 1],
    };
  }, [activePracticeQueue]);
  const nextPracticeRecommendation = useMemo(
    () => buildNextPracticeRecommendation(allItems, recommendationSessions, selectedMode, evaluationOptions),
    [allItems, recommendationSessions, selectedMode, evaluationOptions],
  );

  function chooseItem(mode = selectedMode): ExerciseItem | null {
    const queue = buildAdaptiveQueue(allItems, sessions, mode, { limit: 12, now: evaluationNow });
    if (queue.length === 0) return null;

    const candidates = queue.slice(0, Math.min(queue.length, 6));
    const totalScore = candidates.reduce((sum, entry) => sum + Math.max(entry.score, 0.1), 0);
    let cursor = Math.random() * totalScore;
    for (const entry of candidates) {
      cursor -= Math.max(entry.score, 0.1);
      if (cursor <= 0) return entry.item;
    }
    return candidates[0].item;
  }

  function startPractice(mode = selectedMode): void {
    const item = chooseItem(mode);
    if (!item) {
      setNotice(`没有 ${modeLabels[mode]} 材料，请先导入或切换模式。`);
      setView("materials");
      return;
    }
    setActivePracticeQueue(null);
    setSelectedMode(mode);
    setSelectedItem(item);
    setLastSession(null);
    setPracticeRunId((current) => current + 1);
    setView("practice");
  }

  function startPracticeWithItem(item: ExerciseItem): void {
    setActivePracticeQueue(null);
    setSelectedMode(item.mode);
    setSelectedItem(item);
    setLastSession(null);
    setPracticeRunId((current) => current + 1);
    setView("practice");
  }

  function startTodayQueue(startIndex = 0): void {
    const queueItems = buildTodayTrainingQueue(todayRecommendations, startIndex, {
      planSteps: remainingDailyPlan,
    });
    if (queueItems.length === 0) {
      startPractice(trainingProtocol.primaryMode);
      return;
    }
    const coverageIssues = summarizeDailyPlanQueueCoverage(remainingDailyPlan, queueItems);
    if (coverageIssues.length > 0) {
      setNotice(formatQueueCoverageNotice(coverageIssues));
    }

    const firstItem = queueItems[0].item;
    setActivePracticeQueue({
      title: "今日队列",
      items: queueItems,
      index: 0,
    });
    setSelectedMode(firstItem.mode);
    setSelectedItem(firstItem);
    setLastSession(null);
    setPracticeRunId((current) => current + 1);
    setView("practice");
  }

  function startWeeklyPlanQueue(planItem: WeeklyTrainingPlanItem): void {
    const queueItems = buildWeeklyPlanTrainingQueue(allItems, sessions, planItem);
    if (queueItems.length === 0) {
      setNotice(`没有 ${modeLabels[planItem.mode]} 材料，请先导入或切换计划块。`);
      setView("materials");
      return;
    }
    const coverageIssues = summarizeWeeklyPlanQueueCoverage(planItem, queueItems);
    if (coverageIssues.length > 0) {
      setNotice(formatQueueCoverageNotice(coverageIssues));
    }

    const firstItem = queueItems[0].item;
    setActivePracticeQueue({
      title: "周计划",
      items: queueItems,
      index: 0,
    });
    setSelectedMode(firstItem.mode);
    setSelectedItem(firstItem);
    setLastSession(null);
    setPracticeRunId((current) => current + 1);
    setView("practice");
  }

  function advancePractice(): void {
    if (activePracticeQueue) {
      const nextIndex = activePracticeQueue.index + 1;
      const nextQueueItem = activePracticeQueue.items[nextIndex];
      if (nextQueueItem) {
        setActivePracticeQueue({
          ...activePracticeQueue,
          index: nextIndex,
        });
        setSelectedMode(nextQueueItem.item.mode);
        setSelectedItem(nextQueueItem.item);
        setLastSession(null);
        setPracticeRunId((current) => current + 1);
        setView("practice");
        return;
      }

      setActivePracticeQueue(null);
      setSelectedItem(null);
      setLastSession(null);
      setNotice("今日队列已完成。可以关闭应用，或回到 Today 自由加练。");
      setView("today");
      return;
    }

    setSelectedItem(chooseItem(selectedMode));
    setLastSession(null);
    setPracticeRunId((current) => current + 1);
  }

  function exitPractice(): void {
    setActivePracticeQueue(null);
    setView("today");
  }

  function openPractice(): void {
    if (activePracticeQueue && selectedItem) {
      setView("practice");
      return;
    }

    const mode = selectedItem ? selectedMode : trainingProtocol.primaryMode;
    const item = selectedItem ?? chooseItem(mode);
    if (!item) {
      setNotice(`没有 ${modeLabels[mode]} 材料，请先导入或切换模式。`);
      setView("materials");
      return;
    }
    if (!selectedItem) {
      setActivePracticeQueue(null);
      setSelectedMode(mode);
      setPracticeRunId((current) => current + 1);
    }
    setSelectedItem(item);
    setView("practice");
  }

  async function saveCompletedSession(
    session: TrainingSession,
    sessionEvents: InputEventLog[],
  ): Promise<void> {
    await db.transaction("rw", db.sessions, db.events, async () => {
      await db.sessions.put(session);
      await db.events.bulkPut(sessionEvents);
    });
    const nextRecords = mergeCompletedTrainingRecords(sessions, events, session, sessionEvents);
    setSessions(nextRecords.sessions);
    setEvents(nextRecords.events);
    setLastSession(session);
    const autoSyncResult = await autoWriteSyncFolderAfterChange(
      nextRecords.sessions,
      nextRecords.events,
    );
    if (autoSyncResult.message) setNotice(autoSyncResult.message);
    try {
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? `训练已保存，但统计刷新失败：${error.message}` : "训练已保存，但统计刷新失败。");
    }
  }

  async function saveSettings(draft: SettingsDraft): Promise<void> {
    if (!settings) return;
    try {
      const nextSettings = normalizeSettingsDraft(settings, draft);
      await db.settings.put(nextSettings);
      setSettings(nextSettings);
      setNotice("设置已保存。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "设置保存失败。");
    }
  }

  async function clearTrainingData(): Promise<void> {
    await db.transaction("rw", db.sessions, db.events, async () => {
      await db.sessions.clear();
      await db.events.clear();
    });
    setSessions([]);
    setEvents([]);
    setLastSession(null);
    setActivePracticeQueue(null);
    setNotice("已清空本机训练记录，材料和设置已保留。");
  }

  async function importSyncPackage(file: File): Promise<void> {
    try {
      const content = await file.text();
      const incoming = parseSyncPackage(content);
      prepareSyncImport("package", file.name, incoming);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "同步包导入失败。");
    }
  }

  async function importSyncFolderManifest(file: File): Promise<void> {
    try {
      const content = await file.text();
      const incoming = parseSyncFolderExport(content);
      prepareSyncImport("folder", file.name, incoming);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "同步目录清单导入失败。");
    }
  }

  function prepareSyncImport(kind: SyncImportKind, fileName: string, incoming: PendingSyncImport["incoming"]): void {
    if (!settings) return;
    const preview = previewSyncMerge(sessions, events, materials, incoming);
    const merged = mergeSyncCollections(sessions, events, materials, incoming);
    const healthAfter = buildSyncHealthReport(
      {
        ...settings,
        lastSyncImportAt: new Date().toISOString(),
      },
      merged.sessions,
      merged.events,
      merged.materials,
    );
    setPendingSyncImport({ kind, fileName, incoming, preview, healthAfter });
    setNotice(
      `${syncImportKindLabels[kind]}已读取：新增 ${preview.result.addedSessions} 个会话、${preview.result.addedEvents} 条事件、${preview.result.addedMaterials} 个材料包。确认后才会写入本机数据。`,
    );
  }

  async function confirmSyncImport(): Promise<void> {
    if (!pendingSyncImport) return;
    const merged = mergeSyncCollections(sessions, events, materials, pendingSyncImport.incoming);
    let nextSettings = settings;
    await replaceAllData(merged.sessions, merged.events, merged.materials);
    if (settings) {
      nextSettings = {
        ...settings,
        lastSyncImportAt: new Date().toISOString(),
      };
      await db.settings.put(nextSettings);
      setSettings(nextSettings);
    }
    setPendingSyncImport(null);
    const autoSyncResult = await autoWriteSyncFolderAfterChange(
      merged.sessions,
      merged.events,
      merged.materials,
      nextSettings,
    );
    await refresh();
    setNotice(
      `${syncImportKindLabels[pendingSyncImport.kind]}已合并：新增 ${merged.result.addedSessions} 个会话、${merged.result.addedEvents} 条事件、${merged.result.addedMaterials} 个材料包。${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`,
    );
  }

  function cancelSyncImport(): void {
    setPendingSyncImport(null);
    setNotice("已取消本次同步导入，未写入本机数据。");
  }

  async function importRimeFile(file: File): Promise<void> {
    if (!settings) return;
    try {
      const content = await file.text();
      const pack = await createMaterialPackFromRime(
        file.name.replace(/\.(dict\.)?ya?ml$/i, "") || "Rime 五笔词库",
        file.name,
        content,
      );
      const materialEvent: InputEventLog = {
        eventId: createId("event"),
        sessionId: "material_import",
        deviceId: settings.deviceId,
        type: "material_imported",
        occurredAt: new Date().toISOString(),
        sequence: events.length + 1,
        payload: { materialId: pack.id, name: pack.name, items: pack.items.length, source: pack.source },
      };
      await db.transaction("rw", db.materials, db.events, async () => {
        await db.materials.put(pack);
        await db.events.put(materialEvent);
      });
      const autoSyncResult = await autoWriteSyncFolderAfterChange(
        sessions,
        [...events, materialEvent],
        upsertMaterialPacks(materials, [pack]),
      );
      await refresh();
      setNotice(`已导入 ${pack.name}，共 ${pack.items.length} 条五笔材料。${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rime 五笔词库导入失败。");
    }
  }

  async function importTextFile(file: File, mode: TrainingMode): Promise<void> {
    if (!settings) return;
    try {
      const content = await file.text();
      const pack = await createMaterialPackFromText({
        name: `${file.name} · ${modeLabels[mode]}`,
        description: `从文本文件导入的 ${modeLabels[mode]} 材料。`,
        source: file.name,
        mode,
        content,
      });
      const materialEvent: InputEventLog = {
        eventId: createId("event"),
        sessionId: "material_import",
        deviceId: settings.deviceId,
        type: "material_imported",
        occurredAt: new Date().toISOString(),
        sequence: events.length + 1,
        payload: { materialId: pack.id, name: pack.name, items: pack.items.length, source: pack.source, mode },
      };
      await db.transaction("rw", db.materials, db.events, async () => {
        await db.materials.put(pack);
        await db.events.put(materialEvent);
      });
      const autoSyncResult = await autoWriteSyncFolderAfterChange(
        sessions,
        [...events, materialEvent],
        upsertMaterialPacks(materials, [pack]),
      );
      await refresh();
      setNotice(`已导入 ${pack.name}，共 ${pack.items.length} 条。${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "文本材料导入失败。");
    }
  }

  async function createTextMaterial(draft: TextMaterialPackDraft): Promise<boolean> {
    if (!settings) return false;
    try {
      const pack = await createMaterialPackFromText(draft);
      const materialEvent: InputEventLog = {
        eventId: createId("event"),
        sessionId: "material_create",
        deviceId: settings.deviceId,
        type: "material_created",
        occurredAt: new Date().toISOString(),
        sequence: events.length + 1,
        payload: {
          materialId: pack.id,
          name: pack.name,
          items: pack.items.length,
          source: pack.source,
          mode: draft.mode,
        },
      };
      await db.transaction("rw", db.materials, db.events, async () => {
        await db.materials.put(pack);
        await db.events.put(materialEvent);
      });
      const autoSyncResult = await autoWriteSyncFolderAfterChange(
        sessions,
        [...events, materialEvent],
        upsertMaterialPacks(materials, [pack]),
      );
      await refresh();
      setNotice(`已创建材料包：${pack.name}，共 ${pack.items.length} 条。${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建材料包失败。");
      return false;
    }
  }

  async function deleteMaterialPack(materialId: string): Promise<void> {
    const material = materials.find((candidate) => candidate.id === materialId);
    if (!material || !settings) return;

    const summary = summarizeMaterialPacks(materials, sessions).find(
      (candidate) => candidate.id === materialId,
    );
    if (!summary?.canDelete) {
      setNotice(
        summary?.usedSessionCount
          ? `不能删除：${material.name} 已被 ${summary.usedSessionCount} 个训练记录引用。`
          : `不能删除：${material.name} 是内置材料或受保护材料。`,
      );
      return;
    }

    const materialEvent: InputEventLog = {
      eventId: createId("event"),
      sessionId: "material_maintenance",
      deviceId: settings.deviceId,
      type: "material_deleted",
      occurredAt: new Date().toISOString(),
      sequence: events.length + 1,
      payload: {
        materialId,
        name: material.name,
        source: material.source,
        itemCount: material.items.length,
      },
    };
    await db.transaction("rw", db.materials, db.events, async () => {
      await db.materials.delete(materialId);
      await db.events.put(materialEvent);
    });
    const autoSyncResult = await autoWriteSyncFolderAfterChange(
      sessions,
      [...events, materialEvent],
      removeMaterialPack(materials, materialId),
    );
    await refresh();
    setNotice(`已删除材料包：${material.name}${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`);
  }

  async function restoreBuiltinMaterials(): Promise<void> {
    if (!settings) return;
    const builtinPacks = await sampleMaterialPacks();
    const materialEvent: InputEventLog = {
      eventId: createId("event"),
      sessionId: "material_maintenance",
      deviceId: settings.deviceId,
      type: "material_restored",
      occurredAt: new Date().toISOString(),
      sequence: events.length + 1,
      payload: {
        packs: builtinPacks.map((pack) => ({
          id: pack.id,
          name: pack.name,
          itemCount: pack.items.length,
        })),
      },
    };
    await db.transaction("rw", db.materials, db.events, async () => {
      await db.materials.bulkPut(builtinPacks);
      await db.events.put(materialEvent);
    });
    const autoSyncResult = await autoWriteSyncFolderAfterChange(
      sessions,
      [...events, materialEvent],
      upsertMaterialPacks(materials, builtinPacks),
    );
    await refresh();
    setNotice(`已恢复内置启动材料。${autoSyncResult.message ? ` ${autoSyncResult.message}` : ""}`);
  }

  async function exportSync(): Promise<void> {
    if (!settings) return;
    const pack = createSyncPackage(settings.deviceId, sessions, events, materials);
    downloadText(
      syncPackageFilename(pack.exportedAt, pack.dataFingerprint),
      JSON.stringify(pack, null, 2),
      "application/json",
    );
    const nextSettings = { ...settings, lastSyncExportAt: pack.exportedAt };
    await db.settings.put(nextSettings);
    setSettings(nextSettings);
    setNotice(`同步包已导出：${sessions.length} 个会话、${events.length} 条事件、${materials.length} 个材料包。`);
  }

  async function exportSyncFolderFiles(): Promise<void> {
    if (!settings) return;
    const folderExport = createSyncFolderExport(settings.deviceId, sessions, events, materials);
    downloadText(
      syncFolderManifestFilename(
        folderExport.manifest.exportedAt,
        folderExport.manifest.dataFingerprint,
      ),
      encodeSyncFolderExport(folderExport),
      "application/json",
    );
    const nextSettings = { ...settings, lastSyncExportAt: folderExport.manifest.exportedAt };
    await db.settings.put(nextSettings);
    setSettings(nextSettings);
    setNotice(`同步目录文件清单已导出：${folderExport.manifest.counts.files} 个文件，可用于桌面版落盘。`);
  }

  async function writeSyncFolderToLocalDirectory(): Promise<void> {
    if (!settings) return;
    if (!isFileSystemAccessSupported()) {
      setNotice("当前浏览器不支持直接写入本地目录，请继续导出同步目录清单，或使用后续 Tauri 桌面版。");
      return;
    }

    try {
      const folderExport = createSyncFolderExport(settings.deviceId, sessions, events, materials);
      const directory = await pickWritableDirectory();
      const result = await writeSyncFolderExportToDirectory(folderExport, directory);
      const nextSettings = { ...settings, lastSyncExportAt: folderExport.manifest.exportedAt };
      await db.settings.put(nextSettings);
      setSettings(nextSettings);
      setSyncDirectoryHandle(directory);
      setNotice(
        `已写入同步目录：${result.filesWritten} 个文件，${Math.round(result.bytesWritten / 1024)} KB，根目录 ${result.rootPath}。本次打开期间，后续训练完成会自动写入该目录。`,
      );
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNotice("已取消选择同步目录。");
        return;
      }
      if (
        error instanceof Error &&
        (error.name === "SecurityError" || error.message.toLowerCase().includes("user gesture"))
      ) {
        setNotice("浏览器要求通过真实点击授权目录写入；请在页面中手动点击“写入同步目录”，或改用同步目录清单。");
        return;
      }
      setNotice(error instanceof Error ? error.message : "同步目录写入失败。");
    }
  }

  async function autoWriteSyncFolderAfterChange(
    nextSessions: TrainingSession[],
    nextEvents: InputEventLog[],
    nextMaterials: MaterialPack[] = materials,
    nextSettings: AppSettings | null = settings,
  ): Promise<{ attempted: boolean; message: string }> {
    if (!syncDirectoryHandle || !nextSettings) {
      return { attempted: false, message: "" };
    }

    try {
      const folderExport = createSyncFolderExport(
        nextSettings.deviceId,
        dedupeSessions(nextSessions),
        dedupeEvents(nextEvents),
        nextMaterials,
      );
      const result = await writeSyncFolderExportToDirectory(folderExport, syncDirectoryHandle);
      const exportedSettings = {
        ...nextSettings,
        lastSyncExportAt: folderExport.manifest.exportedAt,
      };
      await db.settings.put(exportedSettings);
      setSettings(exportedSettings);
      return {
        attempted: true,
        message: `已自动写入同步目录：${result.filesWritten} 个文件，${Math.round(result.bytesWritten / 1024)} KB。`,
      };
    } catch (error) {
      setSyncDirectoryHandle(null);
      if (
        error instanceof Error &&
        (error.name === "SecurityError" || error.message.toLowerCase().includes("user gesture"))
      ) {
        return {
          attempted: true,
          message: "自动写入同步目录需要重新授权；请到 Settings 手动点击“写入同步目录”。",
        };
      }
      return {
        attempted: true,
        message: error instanceof Error
          ? `自动写入同步目录失败：${error.message}`
          : "自动写入同步目录失败。",
      };
    }
  }

  async function importSyncFolderDirectory(): Promise<void> {
    if (!settings) return;
    if (!isFileSystemAccessSupported()) {
      setNotice("当前浏览器不支持直接读取本地同步目录，请继续导入同步目录清单，或使用后续 Tauri 桌面版。");
      return;
    }

    try {
      const directory = await pickReadableDirectory();
      const result = await readSyncFolderFilesFromDirectory(directory);
      const incoming = parseSyncFolderFiles(result.files);
      prepareSyncImport("directory", `${result.rootPath} · ${result.filesRead} files`, incoming);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNotice("已取消选择同步目录。");
        return;
      }
      if (
        error instanceof Error &&
        (error.name === "SecurityError" || error.message.toLowerCase().includes("user gesture"))
      ) {
        setNotice("浏览器要求通过真实点击授权目录读取；请在页面中手动点击“读取同步目录”，或改用同步目录清单。");
        return;
      }
      setNotice(error instanceof Error ? error.message : "同步目录读取失败。");
    }
  }

  function exportJsonl(): void {
    const exportedAt = new Date();
    const url = encodeJsonlDownload(events);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = eventsJsonlFilename(exportedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportCsv(): void {
    const exportedAt = new Date();
    downloadText(
      sessionsCsvFilename(exportedAt),
      sessionsToCsv(sessions),
      "text/csv;charset=utf-8",
    );
  }

  if (!settings) {
    return <div className="loading">正在准备 TypingLab...</div>;
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Keyboard size={24} />
          <div>
            <strong>TypingLab</strong>
            <span>本地训练系统</span>
          </div>
        </div>
        <nav>
          <NavButton icon={<Play />} label="Today" active={view === "today"} onClick={() => setView("today")} />
          <NavButton icon={<Dumbbell />} label="Practice" active={view === "practice"} onClick={openPractice} />
          <NavButton icon={<BarChart3 />} label="Analytics" active={view === "analytics"} onClick={() => setView("analytics")} />
          <NavButton icon={<Database />} label="Materials" active={view === "materials"} onClick={() => setView("materials")} />
          <NavButton icon={<BookOpen />} label="Tutorial" active={view === "tutorial"} onClick={() => setView("tutorial")} />
          <NavButton icon={<Settings />} label="Settings" active={view === "settings"} onClick={() => setView("settings")} />
        </nav>
        <div className="device-card">
          <Moon size={16} />
          <span>{settings.deviceName}</span>
        </div>
      </aside>

      <main className="main">
        {notice && (
          <button className="notice" onClick={() => setNotice("")}>
            {notice}
          </button>
        )}
        {view === "today" && (
          <TodayView
            sessions={sessions}
            todayMinutes={todayMinutes}
            targetMinutes={settings.dailyTargetMinutes}
            streak={streak}
            weakTargets={weakTargets}
            trend30={trend30}
            stage={trainingStage}
            foundationReport={foundationReport}
            evaluationNow={evaluationNow}
            syncHealth={syncHealth}
            dailyPlan={remainingDailyPlan}
            todayRecommendations={todayRecommendations}
            todayQueueReadiness={todayQueueReadiness}
            foundationMaterialReadiness={foundationMaterialReadiness}
            onStart={startPractice}
            onStartTodayQueue={() => startTodayQueue()}
            onStartRecommendation={startTodayQueue}
            onOpenAnalytics={() => setView("analytics")}
            onOpenMaterials={() => setView("materials")}
            onOpenSettings={() => setView("settings")}
          />
        )}
        {view === "practice" && (
          <PracticeView
            item={selectedItem}
            selectedMode={selectedMode}
            practiceRunId={practiceRunId}
            trainingProtocol={trainingProtocol}
            materials={materials}
            lastSession={lastSession}
            practiceQueue={practiceQueueProgress}
            nextRecommendation={nextPracticeRecommendation}
            syncHealth={syncHealth}
            settings={settings}
            onModeChange={(mode) => {
              setActivePracticeQueue(null);
              setSelectedMode(mode);
              setSelectedItem(chooseItem(mode));
              setLastSession(null);
              setPracticeRunId((current) => current + 1);
            }}
            onNext={advancePractice}
            onStartRecommended={(item) => startPracticeWithItem(item)}
            onCompleted={saveCompletedSession}
            onClearDiagnosis={() => setLastSession(null)}
            onOpenStats={() => setView("analytics")}
            onOpenSettings={() => setView("settings")}
            onExit={exitPractice}
          />
        )}
        {view === "analytics" && (
          <AnalyticsView
            sessions={sessions}
            events={events}
            materials={materials}
            trend30={trend30}
            weakTargets={weakTargets}
            weakKeys={weakKeys}
            evaluationNow={evaluationNow}
            onStartWeeklyPlanItem={startWeeklyPlanQueue}
          />
        )}
        {view === "materials" && (
          <MaterialsView
            materials={materials}
            sessions={sessions}
            onImportRime={importRimeFile}
            onImportText={importTextFile}
            onCreateTextMaterial={createTextMaterial}
            onDeleteMaterial={deleteMaterialPack}
            onRestoreBuiltin={restoreBuiltinMaterials}
          />
        )}
        {view === "tutorial" && (
          <TutorialView
            sessions={sessions}
            targetMinutes={settings.dailyTargetMinutes}
            hasWeakTargets={weakTargets.length > 0}
            evaluationNow={evaluationNow}
          />
        )}
        {view === "settings" && (
          <SettingsView
            settings={settings}
            sessions={sessions}
            events={events}
            materials={materials}
            onExportSync={exportSync}
            onWriteSyncFolder={writeSyncFolderToLocalDirectory}
            onExportSyncFolder={exportSyncFolderFiles}
            onExportJsonl={exportJsonl}
            onExportCsv={exportCsv}
            onImportSync={importSyncPackage}
            onImportSyncFolderDirectory={importSyncFolderDirectory}
            onImportSyncFolder={importSyncFolderManifest}
            pendingSyncImport={pendingSyncImport}
            syncDirectoryHandleName={syncDirectoryHandle?.name ?? ""}
            currentTime={currentTime}
            onConfirmSyncImport={confirmSyncImport}
            onCancelSyncImport={cancelSyncImport}
            onSaveSettings={saveSettings}
            onClearTrainingData={clearTrainingData}
          />
        )}
      </main>
    </div>
  );
}

function NavButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: JSX.Element;
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function TodayView({
  sessions,
  todayMinutes,
  targetMinutes,
  streak,
  weakTargets,
  trend30,
  stage,
  foundationReport,
  evaluationNow,
  syncHealth,
  dailyPlan,
  todayRecommendations,
  todayQueueReadiness,
  foundationMaterialReadiness,
  onStart,
  onStartTodayQueue,
  onStartRecommendation,
  onOpenAnalytics,
  onOpenMaterials,
  onOpenSettings,
}: {
  sessions: TrainingSession[];
  todayMinutes: number;
  targetMinutes: number;
  streak: number;
  weakTargets: Array<{ target: string; count: number }>;
  trend30: ReturnType<typeof buildTrendPoints>;
  stage: ReturnType<typeof getTrainingStage>;
  foundationReport: ReturnType<typeof getFoundationReport>;
  evaluationNow: Date;
  syncHealth: SyncHealthReport | null;
  dailyPlan: DailyPlanStep[];
  todayRecommendations: TodayRecommendation[];
  todayQueueReadiness: TodayQueueReadiness;
  foundationMaterialReadiness: FoundationMaterialReadiness;
  onStart: (mode?: TrainingMode) => void;
  onStartTodayQueue: () => void;
  onStartRecommendation: (startIndex: number) => void;
  onOpenAnalytics: () => void;
  onOpenMaterials: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const completion = Math.min(100, Math.round((todayMinutes / targetMinutes) * 100));
  const averages = averageMetrics(getRecentSessions(sessions, 20));
  const remainingMinutes = Math.max(0, Math.ceil(targetMinutes - todayMinutes));
  const protocol = buildTrainingProtocol(sessions, { now: evaluationNow });
  const roadmap = buildTrainingRoadmap(sessions, { now: evaluationNow });
  const foundationStatus = foundationReport.status;
  const foundationSprint = buildFoundationSprintPlan(
    sessions,
    targetMinutes,
    weakTargets.length > 0,
    { now: evaluationNow },
  );
  const strategyCopy = foundationStatus.ready
    ? "英文/代码底座已达标，今日主线切到五笔和真实中文。"
    : "先把英文/代码输入推到 80-100 CPM，再系统提升中文五笔。";
  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Today</h1>
          <p>{strategyCopy}</p>
        </div>
        <button className="primary-action" onClick={onStartTodayQueue}>
          <Play size={20} />
          开始今日训练
        </button>
      </header>

      <div className="today-grid">
        <div className="focus-panel">
          <div className="progress-ring" style={{ "--progress": `${completion}%` } as CSSProperties}>
            <strong>{Math.round(todayMinutes)}</strong>
            <span>/{targetMinutes}m</span>
          </div>
          <div>
            <h2>今日还剩 {remainingMinutes} 分钟</h2>
            <p>
              英文 {foundationStatus.englishCpm} CPM · 代码 {foundationStatus.codeCpm} CPM ·
              目标 80-100 CPM 后加大五笔。
            </p>
            <div className="mode-row">
              {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
                <button key={mode} onClick={() => onStart(mode)}>
                  {modeLabels[mode]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <MetricCard icon={<Flame />} label="连续天数" value={`${streak} 天`} />
        <MetricCard icon={<Gauge />} label="近 20 次速度" value={`${averages.charsPerMinute} CPM`} />
        <MetricCard icon={<Check />} label="近 20 次准确率" value={`${averages.accuracy}%`} />
      </div>

      <SyncReminder syncHealth={syncHealth} onOpenSettings={onOpenSettings} />

      <TodayQueueReadinessPanel
        readiness={todayQueueReadiness}
        materialReadiness={foundationMaterialReadiness}
        onStartTodayQueue={onStartTodayQueue}
        onOpenMaterials={onOpenMaterials}
      />

      <FoundationSprintPanel
        plan={foundationSprint}
        onStartMode={onStart}
        onOpenAnalytics={onOpenAnalytics}
      />

      <section className="panel protocol-panel">
        <div className="panel-heading">
          <div>
            <h2>今日执行协议</h2>
            <p>{protocol.title}</p>
          </div>
          <button onClick={onStartTodayQueue}>
            <Play size={16} />
            开始队列
          </button>
        </div>
        <p className="panel-copy">{protocol.summary}</p>
        <div className="protocol-grid">
          <ProtocolList title="升级标准" items={protocol.exitCriteria} />
          <ProtocolList title="保护规则" items={protocol.guardrails} />
          <ProtocolList title="复盘动作" items={protocol.reviewChecklist} />
        </div>
      </section>

      <TrainingRoadmapPanel phases={roadmap} />

      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <h2>今日训练安排</h2>
          </div>
          {dailyPlan.length > 0 ? (
            <div className="plan-list">
              {dailyPlan.map((step) => (
                <button key={step.id} onClick={() => onStart(step.mode)}>
                  <span>{step.minutes}m</span>
                  <strong>{step.title}</strong>
                  <small>{step.goal}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty">今日目标已完成。可以关闭应用，或按当前执行协议自由加练一组。</p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>当前阶段目标</h2>
          </div>
          <div className="stage-card">
            <strong>{stage.label}</strong>
            <span>{stage.target}</span>
            <p>{stage.focus}</p>
            <div className="foundation-meter">
              <span>英文 {foundationStatus.englishQualifiedSessions}/{foundationStatus.englishSessions} 有效轮 · {foundationStatus.englishAccuracy}%</span>
              <span>代码 {foundationStatus.codeQualifiedSessions}/{foundationStatus.codeSessions} 有效轮 · {foundationStatus.codeAccuracy}%</span>
            </div>
            <div className="foundation-report">
              <div>
                <strong>底座门槛 {foundationReport.completedGates}/{foundationReport.totalGates}</strong>
                <p>{foundationReport.recommendation}</p>
              </div>
              <div className="gate-grid">
                {foundationReport.gates.map((gate) => (
                  <span className={gate.passed ? "passed" : ""} key={gate.id}>
                    {gate.label}
                    <small>{gate.current} / {gate.target}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="two-column">
        <section className="panel">
          <div className="panel-heading">
            <h2>30 日趋势</h2>
            <button onClick={onOpenAnalytics}>详细统计 <ChevronRight size={16} /></button>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend30}>
                <defs>
                  <linearGradient id="minutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#223047" />
                <XAxis dataKey="date" hide />
                <YAxis />
                <Tooltip />
                <Area type="monotone" dataKey="minutes" stroke="#38bdf8" fill="url(#minutes)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>最近弱项</h2>
          </div>
          <div className="weak-list">
            {weakTargets.length === 0 ? (
              <p className="empty">完成几轮训练后会显示高频错字/错词。</p>
            ) : (
              weakTargets.slice(0, 8).map((item) => (
                <span key={item.target}>
                  {item.target}
                  <small>{item.count}</small>
                </span>
              ))
            )}
          </div>
          <div className="queue-list">
            <h3>下一组建议</h3>
            {todayRecommendations.length === 0 ? (
              <p className="empty">导入材料后会生成自适应队列。</p>
            ) : (
              todayRecommendations.slice(0, 4).map((recommendation, index) => (
                <button key={recommendation.entry.item.id} onClick={() => onStartRecommendation(index)}>
                  <strong>{recommendation.entry.item.targetText}</strong>
                  <span>
                    {modeLabels[recommendation.entry.item.mode]} · {recommendation.reason} ·{" "}
                    {recommendation.entry.reasons.slice(0, 2).join(" / ")}
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function TodayQueueReadinessPanel({
  readiness,
  materialReadiness,
  onStartTodayQueue,
  onOpenMaterials,
}: {
  readiness: TodayQueueReadiness;
  materialReadiness: FoundationMaterialReadiness;
  onStartTodayQueue: () => void;
  onOpenMaterials: () => void;
}): JSX.Element {
  const materialIssues = materialReadiness.modes.filter((mode) => mode.status !== "ready");
  const isReady = readiness.ready && materialReadiness.ready;

  return (
    <section className={`panel queue-readiness-panel ${isReady ? "ready" : "attention"}`}>
      <div className="panel-heading">
        <div>
          <h2>今日队列可执行性</h2>
          <p>{readiness.headline}</p>
        </div>
        <span>{isReady ? "可执行" : "需检查"}</span>
      </div>
      <p className="panel-copy">{readiness.detail}</p>
      <div className="queue-readiness-stats">
        <QueueReadinessStat
          label={readiness.planned ? "计划组数" : "推荐组数"}
          value={`${readiness.expectedRounds}`}
        />
        <QueueReadinessStat label="可练组数" value={`${readiness.actualRounds}`} />
        <QueueReadinessStat label="材料缺口" value={`${readiness.missingRounds}`} tone={readiness.missingRounds > 0 ? "warn" : "ok"} />
      </div>
      {readiness.modes.length > 0 && (
        <div className="queue-readiness-mode-row">
          {readiness.modes.map((mode) => (
            <span className={mode.missingRounds > 0 ? "missing" : ""} key={mode.mode}>
              {modeLabels[mode.mode]} {mode.actualRounds}/{mode.expectedRounds}
              {mode.missingRounds > 0 ? ` · 缺 ${mode.missingRounds}` : ""}
            </span>
          ))}
        </div>
      )}
      {readiness.coverageIssues.length > 0 && (
        <div className="queue-readiness-alerts">
          {readiness.coverageIssues.slice(0, 4).map((issue) => (
            <span key={issue.planStepId}>
              {issue.planTitle} 缺 {issue.missingRounds}/{issue.expectedRounds} 组
            </span>
          ))}
        </div>
      )}
      <div className="queue-readiness-materials">
        {materialIssues.length === 0 ? (
          <p>
            英文/代码底座材料满足 {materialReadiness.unlockCpm} CPM 解锁线；
            {materialReadiness.comfortCpm} CPM 舒适线材料可在 Materials 继续扩充。
          </p>
        ) : (
          materialIssues.map((issue) => (
            <p key={issue.mode}>
              {issue.headline}：还需 {issue.missingEffectiveItems} 条可计入底座的
              {modeLabels[issue.mode]}材料。
            </p>
          ))
        )}
      </div>
      <div className="button-row queue-readiness-actions">
        <button onClick={onStartTodayQueue}>
          <Play size={16} />
          开始今日队列
        </button>
        <button onClick={onOpenMaterials}>
          <Database size={16} />
          补材料
        </button>
      </div>
    </section>
  );
}

function QueueReadinessStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok" | "warn";
}): JSX.Element {
  return (
    <div className={`queue-readiness-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TrainingRoadmapPanel({ phases }: { phases: TrainingRoadmapPhase[] }): JSX.Element {
  return (
    <section className="panel roadmap-panel">
      <div className="panel-heading">
        <div>
          <h2>训练路线图</h2>
          <p>80 CPM 是进入五笔主线的解锁线，100 CPM 是英文/代码长期维护的舒适线。</p>
        </div>
      </div>
      <div className="roadmap-grid">
        {phases.map((phase) => (
          <article className={`roadmap-card ${phase.status}`} key={phase.id}>
            <div className="roadmap-top">
              <span>{roadmapStatusLabels[phase.status]}</span>
              <strong>{phase.progress}%</strong>
            </div>
            <h3>{phase.title}</h3>
            <p>{phase.metric}</p>
            <div className="roadmap-bar">
              <i style={{ width: `${phase.progress}%` }} />
            </div>
            <small>{phase.target}</small>
            <em>{phase.nextAction}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function FoundationSprintPanel({
  plan,
  onStartMode,
  onOpenAnalytics,
}: {
  plan: FoundationSprintPlan;
  onStartMode: (mode?: TrainingMode) => void;
  onOpenAnalytics: () => void;
}): JSX.Element {
  return (
    <section className={`panel foundation-sprint-panel ${plan.phase}`}>
      <div className="panel-heading">
        <div>
          <h2>速度底座冲刺方案</h2>
          <p>{plan.headline}</p>
        </div>
        <span className="sprint-badge">{foundationSprintPhaseLabels[plan.phase]}</span>
      </div>
      <div className="sprint-summary">
        <div>
          <span>当前焦点</span>
          <strong>{plan.focusLabel}</strong>
        </div>
        <div>
          <span>预计解锁</span>
          <strong>
            {plan.estimatedSessionsToUnlock === 0
              ? "已解锁"
              : `${plan.estimatedSessionsToUnlock} 轮 / ${formatUnlockDayRange(plan)}`}
          </strong>
        </div>
        <div>
          <span>门槛规则</span>
          <strong>{plan.targetSummary}</strong>
        </div>
      </div>
      <p className="panel-copy">{plan.strategy}</p>
      <div className="sprint-block-grid">
        {plan.blocks.map((block) => (
          <FoundationSprintBlockCard key={block.id} block={block} onStartMode={onStartMode} />
        ))}
      </div>
      <div className="sprint-bottom-grid">
        <SprintList title="执行规则" items={plan.rules} />
        <SprintList title="里程碑" items={plan.milestones} />
      </div>
      <div className="button-row sprint-actions">
        <button onClick={() => onStartMode(plan.focusMode)}>
          <Play size={16} />
          练当前焦点
        </button>
        <button onClick={onOpenAnalytics}>
          <BarChart3 size={16} />
          看底座冲刺
        </button>
      </div>
    </section>
  );
}

function FoundationSprintBlockCard({
  block,
  onStartMode,
}: {
  block: FoundationSprintBlock;
  onStartMode: (mode?: TrainingMode) => void;
}): JSX.Element {
  return (
    <article className={`sprint-block-card ${block.role}`}>
      <div className="sprint-block-top">
        <span>{foundationSprintRoleLabels[block.role]}</span>
        <strong>{block.minutes}m</strong>
      </div>
      <h3>{block.title}</h3>
      <p>{block.goal}</p>
      <small>{block.acceptance}</small>
      <button onClick={() => onStartMode(block.mode)}>
        <Play size={15} />
        练此项
      </button>
    </article>
  );
}

function SprintList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div className="sprint-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

const roadmapStatusLabels: Record<TrainingRoadmapPhase["status"], string> = {
  active: "进行中",
  ready: "已解锁",
  done: "已达成",
  locked: "待解锁",
};

const foundationSprintPhaseLabels: Record<FoundationSprintPlan["phase"], string> = {
  baseline: "补基线",
  unlock: "冲 80",
  "wubi-unlocked": "五笔主线",
  comfort: "维护 100",
};

function formatUnlockDayRange(plan: FoundationSprintPlan): string {
  if (plan.estimatedFastTrainingDaysToUnlock === plan.estimatedTrainingDaysToUnlock) {
    return `${plan.estimatedTrainingDaysToUnlock} 天`;
  }
  return `最快 ${plan.estimatedFastTrainingDaysToUnlock} 天，保守 ${plan.estimatedTrainingDaysToUnlock} 天`;
}

const foundationSprintRoleLabels: Record<FoundationSprintBlock["role"], string> = {
  primary: "主训练",
  support: "支撑",
  maintenance: "维护",
};

function ProtocolList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <div className="protocol-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: JSX.Element;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <div className="metric-card">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric-mini">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SyncReminder({
  syncHealth,
  onOpenSettings,
  compact = false,
}: {
  syncHealth: SyncHealthReport | null;
  onOpenSettings: () => void;
  compact?: boolean;
}): JSX.Element | null {
  if (!shouldShowSyncReminder(syncHealth)) return null;
  return (
    <section className={compact ? "sync-reminder compact" : "sync-reminder"}>
      <div>
        <span>{syncReminderTitle(syncHealth)}</span>
        <p>{syncHealth.nextAction.detail}</p>
      </div>
      <button onClick={onOpenSettings}>
        <Database size={16} />
        打开同步设置
      </button>
    </section>
  );
}

function shouldShowSyncReminder(syncHealth: SyncHealthReport | null): syncHealth is SyncHealthReport {
  if (!syncHealth || syncHealth.status === "empty") return false;
  return (
    syncHealth.summary.unsyncedSessions > 0 ||
    syncHealth.summary.unsyncedEvents > 0 ||
    syncHealth.summary.unsyncedMaterials > 0 ||
    syncHealth.summary.importAfterExport ||
    syncHealth.status === "attention"
  );
}

function syncReminderTitle(syncHealth: SyncHealthReport): string {
  if (syncHealth.issues.length > 0) {
    return syncHealth.nextAction.label;
  }
  if (
    syncHealth.summary.unsyncedSessions > 0 ||
    syncHealth.summary.unsyncedEvents > 0 ||
    syncHealth.summary.unsyncedMaterials > 0
  ) {
    return `待导出：${syncHealth.summary.unsyncedSessions} 个会话 · ${syncHealth.summary.unsyncedEvents} 条事件 · ${syncHealth.summary.unsyncedMaterials} 个材料`;
  }
  if (syncHealth.summary.importAfterExport) {
    return syncHealth.nextAction.label;
  }
  return syncHealth.nextAction.label;
}

function PracticeView({
  item,
  selectedMode,
  practiceRunId,
  trainingProtocol,
  materials,
  lastSession,
  practiceQueue,
  nextRecommendation,
  syncHealth,
  settings,
  onModeChange,
  onNext,
  onStartRecommended,
  onCompleted,
  onClearDiagnosis,
  onOpenStats,
  onOpenSettings,
  onExit,
}: {
  item: ExerciseItem | null;
  selectedMode: TrainingMode;
  practiceRunId: number;
  trainingProtocol: TrainingProtocol;
  materials: MaterialPack[];
  lastSession: TrainingSession | null;
  practiceQueue: PracticeQueueProgress | null;
  nextRecommendation: NextPracticeRecommendation | null;
  syncHealth: SyncHealthReport | null;
  settings: AppSettings;
  onModeChange: (mode: TrainingMode) => void;
  onNext: () => void;
  onStartRecommended: (item: ExerciseItem) => void;
  onCompleted: (session: TrainingSession, events: InputEventLog[]) => Promise<void>;
  onClearDiagnosis: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onExit: () => void;
}): JSX.Element {
  const [input, setInput] = useState("");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState(createId("session"));
  const [sequence, setSequence] = useState(0);
  const [events, setEvents] = useState<InputEventLog[]>([]);
  const [counters, setCounters] = useState<PracticeCounters>(emptyCounters);
  const [hintVisible, setHintVisible] = useState(false);
  const [completionState, setCompletionState] = useState<"idle" | "saving" | "saved">("idle");
  const [completionError, setCompletionError] = useState("");
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const lastInputAt = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inputValueRef = useRef("");
  const sessionIdRef = useRef(sessionId);
  const sequenceRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const eventsRef = useRef<InputEventLog[]>([]);
  const countersRef = useRef<PracticeCounters>(emptyCounters());
  const completingRef = useRef(false);
  const completionStateRef = useRef(completionState);
  const composingRef = useRef(false);
  const explicitPasteSuppressUntilRef = useRef(0);
  const lastBurstInputAtRef = useRef<number | null>(null);
  const prescriptionRecommendation = practiceQueue?.next
    ? {
        mode: practiceQueue.next.mode,
        targetText: practiceQueue.next.item.targetText,
        reasons: practiceQueue.next.adaptiveReasons,
      }
    : nextRecommendation
      ? {
          mode: nextRecommendation.mode,
          targetText: nextRecommendation.entry.item.targetText,
          reasons: nextRecommendation.entry.reasons,
        }
      : null;
  const prescription = lastSession
    ? buildPracticePrescription(lastSession, prescriptionRecommendation)
    : null;
  const shouldRepeatBeforeNext = Boolean(prescription && !prescription.canAdvanceQueue);
  const manualModeWarning = buildManualPracticeModeWarning(
    selectedMode,
    trainingProtocol,
    Boolean(practiceQueue),
  );

  function hasUnsavedCurrentInput(): boolean {
    return hasUnsavedPracticeInput({
      started: startedAtRef.current !== null,
      inputText: inputValueRef.current,
      completionState,
    });
  }

  function confirmDiscard(action: PracticeDiscardAction): boolean {
    if (!hasUnsavedCurrentInput()) return true;
    return window.confirm(practiceDiscardMessage(action));
  }

  function updateCompletionState(nextState: typeof completionState): void {
    completionStateRef.current = nextState;
    setCompletionState(nextState);
  }

  useEffect(() => {
    resetForItem();
  }, [item?.id, selectedMode, practiceRunId]);

  useEffect(() => {
    completionStateRef.current = completionState;
  }, [completionState]);

  useEffect(() => {
    if (startedAt === null || completionState !== "idle") return;
    const intervalId = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt, completionState]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!hasUnsavedPracticeInput({ started: startedAt !== null, inputText: input, completionState })) {
        return;
      }
      event.preventDefault();
      event.returnValue = practiceDiscardMessage("exit");
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [startedAt, input, completionState]);

  useEffect(() => {
    function onWindowKeydown(event: KeyboardEvent): void {
      if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        requestCompleteOrAdvance();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestExit();
      }
      if (event.key === "n") {
        event.preventDefault();
        requestNext();
      }
      if (event.key === "s") {
        event.preventDefault();
        onOpenStats();
      }
      if (event.key === "r") {
        event.preventDefault();
        requestReset();
      }
      if (event.key === "?") {
        event.preventDefault();
        useHint();
      }
    }
    window.addEventListener("keydown", onWindowKeydown);
    return () => window.removeEventListener("keydown", onWindowKeydown);
  });

  function resetForItem(): void {
    const nextSessionId = createId("session");
    onClearDiagnosis();
    setInput("");
    setStartedAt(null);
    setSessionId(nextSessionId);
    setSequence(0);
    setEvents([]);
    setCounters(emptyCounters());
    setHintVisible(false);
    updateCompletionState("idle");
    setCompletionError("");
    setLiveNow(Date.now());
    inputValueRef.current = "";
    sessionIdRef.current = nextSessionId;
    sequenceRef.current = 0;
    startedAtRef.current = null;
    eventsRef.current = [];
    countersRef.current = emptyCounters();
    completingRef.current = false;
    completionStateRef.current = "idle";
    composingRef.current = false;
    lastInputAt.current = null;
    explicitPasteSuppressUntilRef.current = 0;
    lastBurstInputAtRef.current = null;
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0 });
    }, 0);
  }

  function updateCounters(updater: (current: PracticeCounters) => PracticeCounters): void {
    const nextCounters = updater(countersRef.current);
    countersRef.current = nextCounters;
    setCounters(nextCounters);
  }

  function pushEvent(type: InputEventLog["type"], payload: Record<string, unknown>): InputEventLog {
    const nextSequence = sequenceRef.current + 1;
    sequenceRef.current = nextSequence;
    const event: InputEventLog = {
      eventId: createEventId(settings.deviceId, sessionIdRef.current, nextSequence),
      sessionId: sessionIdRef.current,
      deviceId: settings.deviceId,
      type,
      occurredAt: new Date().toISOString(),
      sequence: nextSequence,
      payload,
    };
    setSequence(nextSequence);
    eventsRef.current = [...eventsRef.current, event];
    setEvents(eventsRef.current);
    return event;
  }

  function ensureStarted(): number | null {
    if (!item) return null;
    if (startedAtRef.current !== null) return startedAtRef.current;

    const startTime = Date.now();
    startedAtRef.current = startTime;
    setStartedAt(startTime);
    setLiveNow(startTime);
    pushEvent("session_started", {
      mode: item.mode,
      itemId: item.id,
      targetText: item.targetText,
    });
    return startTime;
  }

  function recordInput(nextValue: string): void {
    if (ensureStarted() === null) return;
    const now = Date.now();
    setLiveNow(now);
    const previousValue = inputValueRef.current;
    const changedPosition = firstChangedIndex(previousValue, nextValue);
    const hasExplicitPastePending = explicitPasteSuppressUntilRef.current >= now;
    if (explicitPasteSuppressUntilRef.current > 0 && !hasExplicitPastePending) {
      explicitPasteSuppressUntilRef.current = 0;
    }
    const burst = classifyBurstInput(previousValue, nextValue, item?.targetText ?? "", hasExplicitPastePending);
    if (hasExplicitPastePending) {
      explicitPasteSuppressUntilRef.current = 0;
    }
    if (burst.detected) {
      recordPaste("burst-input", burst.insertedChars);
    }
    if (lastInputAt.current !== null) {
      const pause = now - lastInputAt.current;
      if (pause > 1500) {
        updateCounters((current) => ({
          ...current,
          pauseCountOver1500Ms: current.pauseCountOver1500Ms + 1,
          maxPauseMs: Math.max(current.maxPauseMs, pause),
        }));
        pushEvent("long_pause", {
          pauseMs: pause,
          position: changedPosition,
          inputLength: nextValue.length,
          previousLength: previousValue.length,
        });
      }
    }
    lastInputAt.current = now;
    inputValueRef.current = nextValue;
    setInput(nextValue);
    pushEvent("input", { value: nextValue, length: nextValue.length });
    maybeAutoComplete(nextValue);
  }

  function maybeAutoComplete(nextValue: string): void {
    if (!item || completionStateRef.current !== "idle" || completingRef.current) return;
    if (composingRef.current || !isPracticeInputComplete(item, nextValue)) return;

    window.setTimeout(() => {
      if (
        completionStateRef.current !== "idle" ||
        completingRef.current ||
        inputValueRef.current !== nextValue ||
        composingRef.current
      ) {
        return;
      }
      void complete();
    }, 0);
  }

  function recordPaste(source: "textarea" | "monaco" | "burst-input", length?: number): void {
    if (ensureStarted() === null) return;
    const now = Date.now();
    if (source === "burst-input") {
      lastBurstInputAtRef.current = now;
    } else if (lastBurstInputAtRef.current && now - lastBurstInputAtRef.current <= 750) {
      explicitPasteSuppressUntilRef.current = 0;
      return;
    } else {
      explicitPasteSuppressUntilRef.current = now + 750;
    }
    updateCounters((current) => ({
      ...current,
      pasteEventCount: current.pasteEventCount + 1,
    }));
    pushEvent("paste", { source, length: length ?? null });
  }

  function recordKeydown(event: React.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      requestExit();
      return;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      selectedMode !== "code" &&
      !event.nativeEvent.isComposing &&
      !composingRef.current
    ) {
      event.preventDefault();
      requestCompleteOrAdvance();
      return;
    }
    if (ensureStarted() === null) return;
    pushEvent("keydown", { key: event.key, code: event.code });
    if (event.key === "Backspace") {
      updateCounters((current) => ({ ...current, backspaces: current.backspaces + 1 }));
    }
    if ((event.key === "?" || event.key.toLowerCase() === "z") && selectedMode === "wubi-code") {
      event.preventDefault();
      useHint();
      return;
    }
  }

  const handleCodeEditorMount: OnMount = (editor) => {
    editor.focus();
    const pasteAwareEditor = editor as typeof editor & {
      onDidPaste?: (listener: () => void) => { dispose: () => void };
    };
    pasteAwareEditor.onDidPaste?.(() => recordPaste("monaco"));
    editor.onKeyDown((event) => {
      const key = event.browserEvent.key;
      const code = event.browserEvent.code;

      if (key === "Escape") {
        event.preventDefault();
        requestExit();
        return;
      }
      if (key === "Enter" && completionStateRef.current === "saved") {
        event.preventDefault();
        requestNext();
        return;
      }
      if (ensureStarted() === null) return;

      pushEvent("keydown", { key, code });
      if (key === "Backspace") {
        updateCounters((current) => ({ ...current, backspaces: current.backspaces + 1 }));
      }
      if (key === "Enter" && (event.browserEvent.metaKey || event.browserEvent.ctrlKey)) {
        event.preventDefault();
        if (inputValueRef.current.trim().length > 0) {
          void complete();
        }
      }
    });
  };

  function recordComposition(type: "composition_start" | "composition_update" | "composition_end", data: string): void {
    if (ensureStarted() === null) return;
    composingRef.current = type !== "composition_end";
    updateCounters((current) => ({
      ...current,
      compositionEventCount: current.compositionEventCount + 1,
    }));
    pushEvent(type, { data });
  }

  function useHint(): void {
    if (!item) return;
    if (completionState !== "idle") return;
    if (!hasHintForItem(item)) return;
    ensureStarted();
    setHintVisible(true);
    updateCounters((current) => ({ ...current, hintCount: current.hintCount + 1 }));
    pushEvent("hint_used", { expectedCodes: item.expectedCodes ?? [], targetText: item.targetText });
  }

  function requestNext(): void {
    if (completionState === "saving") return;
    if (!confirmDiscard("next")) return;
    if (shouldRepeatBeforeNext) {
      resetForItem();
      return;
    }
    onNext();
  }

  function requestReset(): void {
    if (completionState === "saving") return;
    if (!confirmDiscard("reset")) return;
    resetForItem();
  }

  function requestExit(): void {
    if (completionState === "saving") return;
    if (!confirmDiscard("exit")) return;
    onExit();
  }

  function requestModeChange(mode: TrainingMode): void {
    if (completionState === "saving" || mode === selectedMode) return;
    if (!confirmDiscard("mode")) return;
    onModeChange(mode);
  }

  function requestCompleteOrAdvance(): void {
    if (completionStateRef.current === "saving") return;
    if (completionStateRef.current === "saved") {
      requestNext();
      return;
    }
    if (inputValueRef.current.trim().length > 0) {
      ensureStarted();
      void complete();
    }
  }

  async function complete(): Promise<void> {
    if (!item || completingRef.current) return;
    const currentInput = inputValueRef.current;
    const trimmedInput = currentInput.trim();
    if (trimmedInput.length === 0) return;
    const sessionStartedAt = startedAtRef.current ?? ensureStarted();
    if (sessionStartedAt === null) return;

    completingRef.current = true;
    updateCompletionState("saving");
    setCompletionError("");
    const eventsBeforeCompletion = eventsRef.current;
    const sequenceBeforeCompletion = sequenceRef.current;
    const endedAtMs = Date.now();
    const expectedOptions =
      item.mode === "wubi-code" && item.expectedCodes?.length
        ? item.expectedCodes
        : [item.targetText];
    const expected = chooseBestTargetForInput(expectedOptions, trimmedInput);
    const isCodeCorrect =
      item.mode !== "wubi-code" ||
      expectedOptions.some((code) => code.toLowerCase() === trimmedInput.toLowerCase());
    const wrongKeys =
      item.mode === "wubi-code" && !isCodeCorrect
        ? currentInput
            .split("")
            .filter((char, index) => char !== expected[index])
            .slice(0, 12)
        : [];
    const mergedCounters = { ...countersRef.current, wrongKeys };
    const finalPause = includeFinalPause(mergedCounters, lastInputAt.current, endedAtMs);
    if (finalPause.finalPauseMs !== null) {
      pushEvent("long_pause", {
        pauseMs: finalPause.finalPauseMs,
        position: trimmedInput.length,
        inputLength: trimmedInput.length,
        previousLength: trimmedInput.length,
        source: "completion",
      });
    }
    const baseMetrics = calculateSessionMetrics(
      expected,
      trimmedInput,
      endedAtMs - sessionStartedAt,
      finalPause.counters,
    );
    const metrics =
      item.mode === "wubi-code"
        ? {
            ...baseMetrics,
            accuracy: isCodeCorrect ? 100 : baseMetrics.accuracy,
            correctUnits: isCodeCorrect ? expected.length : baseMetrics.correctUnits,
            weakTargets:
              isCodeCorrect && baseMetrics.hintCount === 0 ? [] : [item.targetText],
            wrongKeys,
          }
        : baseMetrics;
    pushEvent("session_completed", {
      inputText: trimmedInput,
      metrics,
      correct: isCodeCorrect && metrics.accuracy === 100,
    });
    const session: TrainingSession = {
      id: sessionIdRef.current,
      deviceId: settings.deviceId,
      mode: item.mode,
      materialId: materials.find((material) => material.items.some((entry) => entry.id === item.id))?.id,
      itemId: item.id,
      targetText: item.targetText,
      inputText: trimmedInput,
      startedAt: new Date(sessionStartedAt).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - sessionStartedAt,
      metrics,
    };
    try {
      await onCompleted(session, eventsRef.current);
      updateCompletionState("saved");
    } catch (error) {
      eventsRef.current = eventsBeforeCompletion;
      sequenceRef.current = sequenceBeforeCompletion;
      setEvents(eventsBeforeCompletion);
      setSequence(sequenceBeforeCompletion);
      completingRef.current = false;
      updateCompletionState("idle");
      setCompletionError(error instanceof Error ? error.message : "训练保存失败，请重试。");
    }
  }

  if (!item) {
    return (
      <section className="screen">
        <header className="screen-header">
          <div>
            <h1>Practice</h1>
            <p>还没有可训练材料。</p>
          </div>
        </header>
      </section>
    );
  }

  const expectedCodes = item.expectedCodes?.join(" / ");
  const hasHint = hasHintForItem(item);
  const isWubi = item.mode === "wubi-code";
  const isCode = item.mode === "code";
  const isSavingCompletion = completionState === "saving";
  const canComplete = completionState === "idle" && input.trim().length > 0;
  const canPrimaryAction = completionState === "saved" || canComplete;
  const savedPrimaryActionLabel = shouldRepeatBeforeNext ? "按处方重练" : "下一组";
  const liveElapsedMs = startedAt ? Math.max(0, liveNow - startedAt) : 0;
  const foundationLiveStatus = buildFoundationLiveSampleStatus({
    mode: item.mode,
    elapsedMs: liveElapsedMs,
    targetText: item.targetText,
    inputText: input,
    hintCount: counters.hintCount,
    pasteEventCount: counters.pasteEventCount,
  });
  const practiceLiveStats = buildPracticeLiveStats({
    item,
    inputText: input,
    elapsedMs: liveElapsedMs,
    counters,
  });
  return (
    <section className="screen practice-screen">
      <header className="screen-header compact">
        <div>
          <h1>Practice</h1>
          <p>
            {practiceQueue
              ? `${practiceQueue.title} ${practiceQueue.currentIndex + 1}/${practiceQueue.total} · ${formatQueueStep(practiceQueue.current)}`
              : modeDescriptions[selectedMode]}
          </p>
        </div>
        <div className="segmented">
          {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
            <button
              key={mode}
              className={selectedMode === mode ? "active" : ""}
              onClick={() => requestModeChange(mode)}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
      </header>
      {manualModeWarning && (
        <section className="protocol-warning">
          <strong>{manualModeWarning.title}</strong>
          <p>{manualModeWarning.detail}</p>
        </section>
      )}

      <div className="practice-layout">
        <section className="training-card">
          <div className="training-meta">
            {practiceQueue && (
              <span>{practiceQueue.title} {practiceQueue.currentIndex + 1}/{practiceQueue.total}</span>
            )}
            {practiceQueue?.current.planTitle && (
              <span>{formatQueueStep(practiceQueue.current)}</span>
            )}
            <span>{item.category}</span>
            <span>难度 {item.difficulty}</span>
            <span>{startedAt ? "训练中" : "待开始"}</span>
          </div>
          <FoundationLiveSamplePanel status={foundationLiveStatus} />
          <PracticeLiveStatsPanel
            stats={practiceLiveStats}
            completionState={completionState}
            savedActionLabel={savedPrimaryActionLabel}
          />
          <PracticeTargetPanel
            item={item}
            inputText={input}
            expectedText={practiceLiveStats.expected}
          />
          {item.prompt && <p className="prompt">{item.prompt}</p>}
          {hintVisible && hasHint && (
            <div className="hint">
              {expectedCodes ? `编码：${expectedCodes}` : item.explanation}
            </div>
          )}

          {isCode ? (
            <div className="editor-box">
              <Suspense fallback={<div className="editor-loading">正在加载代码训练编辑器...</div>}>
                <MonacoEditor
                  key={`${item.id}-${practiceRunId}`}
                  height="180px"
                  defaultLanguage="typescript"
                  theme="vs-dark"
                  value={input}
                  onChange={(value) => recordInput(value ?? "")}
                  onMount={handleCodeEditorMount}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 15,
                    lineNumbers: "off",
                    readOnly: completionState !== "idle",
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                  }}
                />
              </Suspense>
            </div>
          ) : (
            <textarea
              ref={inputRef}
              className="training-input"
              value={input}
              placeholder={isWubi ? "输入编码，Enter 完成，z/? 显示提示" : "开始输入，Enter 完成；Shift+Enter 换行"}
              onChange={(event) => recordInput(event.target.value)}
              onKeyDown={recordKeydown}
              onPaste={(event) => recordPaste("textarea", event.clipboardData.getData("text").length)}
              onCompositionStart={(event) => recordComposition("composition_start", event.data)}
              onCompositionUpdate={(event) => recordComposition("composition_update", event.data)}
              onCompositionEnd={(event) => recordComposition("composition_end", event.data)}
              readOnly={completionState !== "idle"}
              aria-readonly={completionState !== "idle"}
              rows={isWubi ? 2 : 7}
            />
          )}

          <div className="training-actions">
            <button onClick={requestCompleteOrAdvance} disabled={!canPrimaryAction || isSavingCompletion}>
              {completionState === "saved" ? <ChevronRight size={16} /> : <Check size={16} />}
              {isSavingCompletion ? "保存中..." : completionState === "saved" ? savedPrimaryActionLabel : "完成"}
            </button>
            {hasHint && (
              <button onClick={useHint} disabled={completionState !== "idle"}>
                <BookOpen size={16} />
                提示
              </button>
            )}
            <button onClick={requestReset} disabled={isSavingCompletion}>
              <RefreshCcw size={16} />
              重练
            </button>
            <button onClick={requestNext} disabled={isSavingCompletion}>
              {shouldRepeatBeforeNext ? <RefreshCcw size={16} /> : <ChevronRight size={16} />}
              {shouldRepeatBeforeNext ? "按处方重练" : "下一组"}
            </button>
          </div>
          {completionError && <p className="completion-error">{completionError}</p>}
        </section>

        <aside className="diagnosis-panel">
          <h2>本次诊断</h2>
          {lastSession ? (
            <div className="diagnosis-list">
              <MetricLine label="速度" value={`${lastSession.metrics.charsPerMinute} CPM`} />
              <MetricLine label="准确率" value={`${lastSession.metrics.accuracy}%`} />
              <MetricLine label="退格/100字" value={`${lastSession.metrics.backspacePer100Chars}`} />
              <MetricLine label="长停顿" value={`${lastSession.metrics.pauseCountOver1500Ms} 次`} />
              <MetricLine label="提示" value={`${lastSession.metrics.hintCount} 次`} />
              {prescription?.foundationCredit && (
                <section className={`foundation-credit ${prescription.foundationCredit.credited ? "credited" : "skipped"}`}>
                  <strong>{prescription.foundationCredit.label}</strong>
                  <p>{prescription.foundationCredit.detail}</p>
                </section>
              )}
              {prescription && (
                <section className={`prescription-card ${prescription.severity}`}>
                  <div className="prescription-top">
                    <span>训练处方</span>
                    <b>{prescription.decisionLabel}</b>
                  </div>
                  <strong>{prescription.title}</strong>
                  <p>{prescription.diagnosis}</p>
                  <p>{prescription.nextAction}</p>
                  <small>{prescription.guardrail}</small>
                </section>
              )}
              {practiceQueue?.next ? (
                <section className={`next-practice-card ${shouldRepeatBeforeNext ? "blocked" : ""}`}>
                  {shouldRepeatBeforeNext ? (
                    <>
                      <span>今日队列保护</span>
                      <strong>先重练当前组，再进入下一组</strong>
                      <p>{prescription?.queueAdvice}</p>
                      <div className="card-actions">
                        <button onClick={requestReset} disabled={isSavingCompletion}>
                          <RefreshCcw size={16} />
                          重练当前组
                        </button>
                        <button className="secondary" onClick={onNext} disabled={isSavingCompletion}>
                          <ChevronRight size={16} />
                          仍然继续
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>今日队列下一组</span>
                      <strong>{modeLabels[practiceQueue.next.mode]} · {practiceQueue.next.item.targetText}</strong>
                      <p>
                        {formatQueueStep(practiceQueue.next)}：
                        {practiceQueue.next.adaptiveReasons.slice(0, 2).join(" / ")}
                      </p>
                      <button onClick={onNext} disabled={isSavingCompletion}>
                        <Play size={16} />
                        开始下一组
                      </button>
                    </>
                  )}
                </section>
              ) : practiceQueue ? (
                <section className={`next-practice-card ${shouldRepeatBeforeNext ? "blocked" : ""}`}>
                  {shouldRepeatBeforeNext ? (
                    <>
                      <span>今日队列保护</span>
                      <strong>最后一组先重练到达标</strong>
                      <p>{prescription?.queueAdvice}</p>
                      <div className="card-actions">
                        <button onClick={requestReset} disabled={isSavingCompletion}>
                          <RefreshCcw size={16} />
                          重练当前组
                        </button>
                        <button className="secondary" onClick={onExit} disabled={isSavingCompletion}>
                          <ChevronRight size={16} />
                          回到 Today
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>今日队列</span>
                      <strong>本轮队列已到最后一组</strong>
                      <p>回到 Today 后可以关闭应用，或按当前执行协议自由加练。</p>
                      <button onClick={onExit} disabled={isSavingCompletion}>
                        <ChevronRight size={16} />
                        回到 Today
                      </button>
                    </>
                  )}
                </section>
              ) : nextRecommendation && (
                <section className={`next-practice-card ${shouldRepeatBeforeNext ? "blocked" : ""}`}>
                  {shouldRepeatBeforeNext ? (
                    <>
                      <span>本轮保护</span>
                      <strong>先重练当前组</strong>
                      <p>{prescription?.queueAdvice}</p>
                      <div className="card-actions">
                        <button onClick={requestReset} disabled={isSavingCompletion}>
                          <RefreshCcw size={16} />
                          重练当前组
                        </button>
                        <button className="secondary" onClick={() => onStartRecommended(nextRecommendation.entry.item)} disabled={isSavingCompletion}>
                          <Play size={16} />
                          仍然开始建议
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <span>下一组建议</span>
                      <strong>{modeLabels[nextRecommendation.mode]} · {nextRecommendation.entry.item.targetText}</strong>
                      <p>
                        {nextRecommendation.reason}：
                        {nextRecommendation.entry.reasons.slice(0, 2).join(" / ")}
                      </p>
                      <button onClick={() => onStartRecommended(nextRecommendation.entry.item)} disabled={isSavingCompletion}>
                        <Play size={16} />
                        开始建议
                      </button>
                    </>
                  )}
                </section>
              )}
              <SyncReminder syncHealth={syncHealth} onOpenSettings={onOpenSettings} compact />
            </div>
          ) : (
            <p className="empty">完成一轮后显示速度、准确率、退格、停顿和下一步建议。</p>
          )}
          <div className="shortcut-box">
            <span>Enter 完成；完成后 Enter 下一步</span>
            <span>完全匹配会自动保存</span>
            <span>代码 Ctrl/⌘+Enter 完成 · Esc 退出 · r 重练 · n 下一组 · s 统计 · ? 提示</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PracticeTargetPanel({
  item,
  inputText,
  expectedText,
}: {
  item: ExerciseItem;
  inputText: string;
  expectedText: string;
}): JSX.Element {
  if (item.mode === "wubi-code") {
    return (
      <div className="target-text target-big">
        <span>{item.targetText}</span>
      </div>
    );
  }

  const targetText = expectedText || item.targetText;
  const comparisonInput = item.mode === "code" ? inputText.trimEnd() : inputText;
  const currentChar = targetText[comparisonInput.length];
  const extraInput = comparisonInput.slice(targetText.length);
  const cursorInfo = buildPracticeCursorInfo(targetText, comparisonInput);
  const targetLabel =
    item.mode === "code"
      ? "代码目标"
      : item.mode === "english"
        ? "英文目标"
        : item.mode === "vim"
          ? "Vim 目标"
          : "中文目标";

  return (
    <div className={`target-text target-trace ${item.mode === "code" ? "target-code" : ""}`}>
      <div className="target-toolbar">
        <span>{targetLabel}</span>
        <strong>{formatCurrentTargetChar(currentChar)}</strong>
      </div>
      <div className="target-focus-grid">
        <div className="next-key">
          <span>下一键</span>
          <strong>{cursorInfo.nextKeyLabel}</strong>
        </div>
        <div>
          <span>{item.mode === "code" ? "当前片段" : "当前词"}</span>
          <strong>{cursorInfo.contextLabel}</strong>
        </div>
        <div>
          <span>行列</span>
          <strong>{cursorInfo.positionLabel}</strong>
        </div>
        <div>
          <span>剩余</span>
          <strong>{cursorInfo.remainingUnits}</strong>
        </div>
        <div className={cursorInfo.errorUnits + cursorInfo.extraUnits > 0 ? "has-errors" : ""}>
          <span>错误</span>
          <strong>
            {cursorInfo.errorUnits}
            {cursorInfo.extraUnits > 0 ? ` +${cursorInfo.extraUnits}` : ""}
          </strong>
        </div>
      </div>
      <div className="target-stream" aria-label="训练目标文本">
        {Array.from(targetText).map((char, index) => (
          <span
            className={targetCharClass(char, comparisonInput[index], index, comparisonInput.length)}
            key={`${index}-${char}`}
          >
            {char}
          </span>
        ))}
        {extraInput &&
          Array.from(extraInput).map((char, index) => (
            <span className="target-char extra" key={`extra-${index}-${char}`}>
              {char}
            </span>
          ))}
      </div>
    </div>
  );
}

function targetCharClass(
  targetChar: string,
  inputChar: string | undefined,
  index: number,
  inputLength: number,
): string {
  const classes = ["target-char"];
  if (targetChar === " ") classes.push("space");
  if (targetChar === "\n") classes.push("newline");
  if (index === inputLength) classes.push("current");
  if (inputChar === undefined) {
    classes.push("pending");
  } else if (inputChar === targetChar) {
    classes.push("correct");
  } else {
    classes.push("wrong");
  }
  return classes.join(" ");
}

function formatCurrentTargetChar(char: string | undefined): string {
  return `当前：${formatPracticeKey(char)}`;
}

function PracticeLiveStatsPanel({
  stats,
  completionState,
  savedActionLabel,
}: {
  stats: PracticeLiveStats;
  completionState: "idle" | "saving" | "saved";
  savedActionLabel: string;
}): JSX.Element {
  const statusLabel =
    completionState === "saving"
      ? "保存中"
      : completionState === "saved"
        ? `已保存 · Enter ${savedActionLabel}`
        : stats.status === "complete"
          ? "已命中 · 自动保存"
          : stats.status === "typing" && stats.elapsedSeconds < 3
            ? "输入中 · 速度预热"
            : stats.status === "typing"
              ? "输入中"
            : "待开始";
  const speedLabel =
    stats.status === "typing" && stats.elapsedSeconds < 3
      ? "预热"
      : `${stats.charsPerMinute} CPM`;

  return (
    <section className={`practice-live-stats ${stats.status}`}>
      <div className="live-stat-primary">
        <span>实时速度</span>
        <strong>{speedLabel}</strong>
      </div>
      <div>
        <span>准确率</span>
        <strong>{stats.accuracy}%</strong>
      </div>
      <div>
        <span>进度</span>
        <strong>
          {stats.typedUnits}/{stats.totalUnits}
        </strong>
      </div>
      <div>
        <span>退格/100字</span>
        <strong>{stats.backspacePer100Chars}</strong>
      </div>
      <div className="live-stat-status">
        <span>{statusLabel}</span>
        <small>{stats.elapsedSeconds}s</small>
      </div>
      <div className="live-progress" aria-label={`训练进度 ${stats.progressPercent}%`}>
        <span style={{ width: `${stats.progressPercent}%` } as CSSProperties} />
      </div>
    </section>
  );
}

function FoundationLiveSamplePanel({
  status,
}: {
  status: FoundationLiveSampleStatus;
}): JSX.Element | null {
  if (!status.applies) return null;
  return (
    <section className={`foundation-live-panel ${status.state}`}>
      <div>
        <span>底座有效性</span>
        <strong>{status.label}</strong>
        <p>{status.detail}</p>
      </div>
      <div className="foundation-live-checks">
        {status.checks.map((check) => (
          <span
            className={check.passed ? "passed" : check.blocking ? "blocked" : ""}
            key={check.id}
          >
            {check.label}
            <small>{check.current} / {check.target}</small>
          </span>
        ))}
      </div>
    </section>
  );
}

function formatQueueStep(entry: TodayTrainingQueueItem): string {
  if (!entry.planTitle || !entry.plannedMinutes) return entry.reason;
  const roundText =
    entry.planRound && entry.planRoundCount && entry.planRoundCount > 1
      ? ` · 第 ${entry.planRound}/${entry.planRoundCount} 组`
      : "";
  const missingText = entry.planMissingRoundCount ? ` · 缺 ${entry.planMissingRoundCount} 组材料` : "";
  return `${entry.planTitle} ${entry.plannedMinutes}m${roundText}${missingText}`;
}

function formatQueueCoverageNotice(issues: TrainingQueueCoverageIssue[]): string {
  const topIssues = issues
    .slice(0, 3)
    .map((issue) => `${issue.planTitle} 缺 ${issue.missingRounds}/${issue.expectedRounds} 组`)
    .join("；");
  const extra = issues.length > 3 ? `；另有 ${issues.length - 3} 个计划块材料不足` : "";
  return `材料不足：${topIssues}${extra}。本次队列会先练已有材料，建议到 Materials 补充对应模式。`;
}

function hasHintForItem(item: ExerciseItem): boolean {
  return Boolean(item.expectedCodes?.length || item.explanation);
}

function MetricLine({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="metric-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AnalyticsView({
  sessions,
  events,
  materials,
  trend30,
  weakTargets,
  weakKeys,
  evaluationNow,
  onStartWeeklyPlanItem,
}: {
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
  trend30: ReturnType<typeof buildTrendPoints>;
  weakTargets: Array<{ target: string; count: number }>;
  weakKeys: Array<{ key: string; count: number }>;
  evaluationNow: Date;
  onStartWeeklyPlanItem: (item: WeeklyTrainingPlanItem) => void;
}): JSX.Element {
  const [tab, setTab] = useState<AnalyticsTab>("overview");
  const foundationReport = getFoundationReport(sessions, { now: evaluationNow });
  const weeklyReport = buildWeeklyReviewReport(sessions, evaluationNow);
  const foundationSessions = sessions.filter((session) => session.mode === "english" || session.mode === "code");
  const filtered =
    tab === "overview" || tab === "weekly"
      ? sessions
      : tab === "foundation"
        ? foundationSessions
        : sessions.filter((session) => session.mode === tab);
  const filteredSessionIds = new Set(filtered.map((session) => session.id));
  const filteredEvents = events.filter((event) => filteredSessionIds.has(event.sessionId));
  const averages = averageMetrics(filtered);
  const visibleWeakTargets = tab === "overview" ? weakTargets : rankWeakTargets(filtered, 20);
  const visibleWeakKeys = tab === "overview" ? weakKeys : rankWeakKeys(filtered, 20);
  const calendarHeatmap = buildTrainingCalendarHeatmap(filtered, 56);
  const keyboardHeatmap = buildKeyboardHeatmap(filtered);
  const wubiRootHeatmap = buildWubiRootHeatmap(filtered, materials);
  const errorHotspots = buildErrorPositionHotspots(filtered, 12);
  const pauseHotspots = buildPausePositionHotspots(filtered, filteredEvents, 12);
  const recentFiltered = getRecentSessions(filtered, filtered.length);
  const currentWindow = recentFiltered.slice(0, Math.min(7, recentFiltered.length));
  const previousWindow = recentFiltered.slice(currentWindow.length, currentWindow.length * 2);
  const currentAverage = averageMetrics(currentWindow);
  const previousAverage = averageMetrics(previousWindow);
  const speedDelta = Number(
    (currentAverage.charsPerMinute - previousAverage.charsPerMinute).toFixed(1),
  );
  const progressText =
    filtered.length < 2
      ? "数据还少，先完成 3 到 5 轮训练再判断趋势。"
      : previousWindow.length === 0
        ? `当前平均 ${currentAverage.charsPerMinute} CPM，继续积累下一组对照数据。`
        : speedDelta >= 0
          ? `近 ${currentWindow.length} 次比上一组快 ${speedDelta} CPM。`
          : `近 ${currentWindow.length} 次比上一组慢 ${Math.abs(speedDelta)} CPM，优先稳准确率。`;
  const blockerText =
    visibleWeakTargets[0] || visibleWeakKeys[0]
      ? `主要弱项：${visibleWeakTargets[0]?.target ?? visibleWeakKeys[0]?.key}，出现 ${visibleWeakTargets[0]?.count ?? visibleWeakKeys[0]?.count} 次。`
      : "暂未形成稳定弱项，继续完成不同模式的基线训练。";
  const nextText =
    averages.backspacePer100Chars > 15
      ? "下一组降低速度，目标是退格/100字低于 15。"
      : visibleWeakTargets[0]
        ? `下一组复练「${visibleWeakTargets[0].target}」和同类材料。`
        : "下一组可以增加材料长度或切到真实中文输入。";
  const modeCounts = (Object.keys(modeLabels) as TrainingMode[]).map((mode) => ({
    mode: modeLabels[mode],
    count: sessions.filter((session) => session.mode === mode).length,
  }));

  function exportWeeklyReviewMarkdown(): void {
    downloadText(
      weeklyReviewMarkdownFilename(weeklyReport.periodEnd),
      weeklyReviewToMarkdown(weeklyReport),
      "text/markdown;charset=utf-8",
    );
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Analytics</h1>
          <p>只回答三个问题：有没有进步，卡在哪里，下次练什么。</p>
        </div>
      </header>
      <div className="tabs">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>
          总览
        </button>
        <button className={tab === "foundation" ? "active" : ""} onClick={() => setTab("foundation")}>
          底座冲刺
        </button>
        <button className={tab === "weekly" ? "active" : ""} onClick={() => setTab("weekly")}>
          周复盘
        </button>
        {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
          <button key={mode} className={tab === mode ? "active" : ""} onClick={() => setTab(mode)}>
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      {tab === "foundation" ? (
        <FoundationAnalyticsView report={foundationReport} sessions={sessions} />
      ) : tab === "weekly" ? (
        <WeeklyReviewView
          report={weeklyReport}
          onStartPlanItem={onStartWeeklyPlanItem}
          onExportMarkdown={exportWeeklyReviewMarkdown}
        />
      ) : (
        <>
          <div className="stats-grid">
            <MetricCard icon={<Activity />} label="会话数" value={`${filtered.length}`} />
            <MetricCard icon={<Gauge />} label="平均速度" value={`${averages.charsPerMinute} CPM`} />
            <MetricCard icon={<Check />} label="平均准确率" value={`${averages.accuracy}%`} />
            <MetricCard icon={<Keyboard />} label="退格/100字" value={`${averages.backspacePer100Chars}`} />
          </div>
          <div className="insight-grid">
            <InsightCard title="有没有进步" body={progressText} />
            <InsightCard title="卡在哪里" body={blockerText} />
            <InsightCard title="下次练什么" body={nextText} />
          </div>
          <TrainingCalendarPanel days={calendarHeatmap} />
          <div className="two-column">
            <KeyboardHeatmapPanel
              title="键位错误热力"
              description="颜色越深，说明这个键在最近训练中更常出错。"
              rows={keyboardHeatmap}
            />
            <KeyboardHeatmapPanel
              title="五笔根键压力"
              description="按五笔材料和失败/提示记录估算需要复练的根键。"
              rows={wubiRootHeatmap}
            />
          </div>
          <div className="two-column">
            <HotspotPanel
              title="错误位置榜"
              items={errorHotspots}
              emptyText="暂无可定位错误。完成几轮训练后，这里会显示最常错的上下文。"
            />
            <HotspotPanel
              title="长停顿位置榜"
              items={pauseHotspots}
              emptyText="暂无长停顿位置。新训练会记录 long_pause 事件，旧数据只保留停顿数量。"
            />
          </div>
          <div className="two-column">
            <section className="panel">
              <h2>速度与准确率</h2>
              <div className="chart tall">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trend30}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#223047" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="charsPerMinute" stroke="#38bdf8" strokeWidth={2} />
                    <Line type="monotone" dataKey="accuracy" stroke="#22c55e" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
            <section className="panel">
              <h2>模式分布</h2>
              <div className="chart tall">
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={modeCounts}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#223047" />
                    <XAxis dataKey="mode" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count">
                      {modeCounts.map((entry, index) => (
                        <Cell key={entry.mode} fill={["#38bdf8", "#22c55e", "#f59e0b", "#a78bfa", "#fb7185"][index]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>
          <div className="two-column">
            <WeakPanel title="弱字/弱词 Top 20" items={visibleWeakTargets.map((item) => ({ label: item.target, count: item.count }))} />
            <WeakPanel title="弱键位 Top 20" items={visibleWeakKeys.map((item) => ({ label: item.key, count: item.count }))} />
          </div>
        </>
      )}
    </section>
  );
}

function WeeklyReviewView({
  report,
  onStartPlanItem,
  onExportMarkdown,
}: {
  report: WeeklyReviewReport;
  onStartPlanItem: (item: WeeklyTrainingPlanItem) => void;
  onExportMarkdown: () => void;
}): JSX.Element {
  const focusSpeedDelta = report.focus.deltas.charsPerMinute;
  const focusBackspaceDelta = report.focus.deltas.backspacePer100Chars;

  return (
    <>
      <div className="weekly-review-toolbar">
        <button className="primary-action" onClick={onExportMarkdown}>
          <Download size={16} />
          导出周复盘
        </button>
      </div>
      <div className="stats-grid">
        <MetricCard icon={<Activity />} label="复盘周期" value={`${report.periodStart} / ${report.periodEnd}`} />
        <MetricCard icon={<Flame />} label="活跃天数" value={`${report.activeDays} 天`} />
        <MetricCard icon={<Gauge />} label="训练分钟" value={`${report.minutes}m (${formatSigned(report.deltas.minutes)})`} />
        <MetricCard
          icon={<Check />}
          label={`主线 ${modeLabels[report.focus.mode]}`}
          value={`${report.focus.average.charsPerMinute} CPM (${formatSigned(focusSpeedDelta)})`}
        />
      </div>
      <div className="insight-grid">
        <InsightCard title={report.decision.title} body={report.decision.body} />
        <InsightCard title="本周成果" body={report.wins[0] ?? "暂无成果数据。"} />
        <InsightCard title="主要风险" body={report.risks[0] ?? "暂无风险数据。"} />
      </div>
      <section className="panel weekly-plan-panel">
        <div className="panel-heading">
          <div>
            <h2>下周训练计划</h2>
            <p>按每日 20 分钟、每周 5 天生成；先执行计划，再用验收标准决定是否升级。</p>
          </div>
        </div>
        <div className="weekly-plan-grid">
          {report.nextWeekPlan.map((item) => (
            <article className="weekly-plan-card" key={item.id}>
              <div className="weekly-plan-top">
                <span>{modeLabels[item.mode]}</span>
                <strong>{item.weeklyMinutes}m/周</strong>
              </div>
              <h3>{item.title}</h3>
              <p>{item.goal}</p>
              <small>
                每次 {item.minutesPerSession}m · 每周 {item.sessionsPerWeek} 天
              </small>
              <em>{item.acceptance}</em>
              <button onClick={() => onStartPlanItem(item)}>
                <Play size={15} />
                开始此块
              </button>
            </article>
          ))}
        </div>
      </section>
      <div className="two-column">
        <section className="panel">
          <h2>模式投入</h2>
          <div className="mode-review-list">
            {report.modeSummaries.length === 0 ? (
              <p className="empty">本周还没有训练记录。</p>
            ) : (
              report.modeSummaries.map((summary) => (
                <div className="mode-review-row" key={summary.mode}>
                  <strong>{modeLabels[summary.mode]}</strong>
                  <span>{summary.sessions} 轮 · {summary.minutes}m</span>
                  <small>
                    {summary.mode === report.focus.mode ? "主线 · " : ""}{summary.charsPerMinute} CPM · {summary.accuracy}% · 退格 {summary.backspacePer100Chars}/100
                  </small>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="panel">
          <h2>下周执行清单</h2>
          <ol className="weekly-action-list">
            {report.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ol>
        </section>
      </div>
      <div className="two-column">
        <WeeklyList title="成果记录" items={report.wins} />
        <WeeklyList
          title={`风险记录 · 主线退格 ${formatSigned(focusBackspaceDelta)}/100`}
          items={report.risks}
        />
      </div>
      <div className="two-column">
        <WeakPanel title="本周弱字/弱词" items={report.weakTargets.map((item) => ({ label: item.target, count: item.count }))} />
        <WeakPanel title="本周弱键位" items={report.weakKeys.map((item) => ({ label: item.key, count: item.count }))} />
      </div>
    </>
  );
}

function WeeklyList({ title, items }: { title: string; items: string[] }): JSX.Element {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <ul className="weekly-note-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function FoundationAnalyticsView({
  report,
  sessions,
}: {
  report: ReturnType<typeof getFoundationReport>;
  sessions: TrainingSession[];
}): JSX.Element {
  const openGate = report.gates.find((gate) => !gate.passed);
  const englishSessions = sessions.filter((session) => session.mode === "english");
  const codeSessions = sessions.filter((session) => session.mode === "code");
  const qualityEnglishSessions = englishSessions.filter(isFoundationQualitySession);
  const qualityCodeSessions = codeSessions.filter(isFoundationQualitySession);
  const foundationSessions = [...englishSessions, ...codeSessions];
  const qualityFoundationSessions = [...qualityEnglishSessions, ...qualityCodeSessions];
  const foundationAverage = averageMetrics(getRecentSessions(qualityFoundationSessions, 20));
  const blockerText = openGate
    ? `${openGate.label}：当前 ${openGate.current}，目标 ${openGate.target}。`
    : "英文/代码底座已达标，可以把主要时间切给五笔和真实中文。";

  return (
    <>
      <div className="stats-grid">
        <MetricCard icon={<Activity />} label="底座会话" value={`${foundationSessions.length}`} />
        <MetricCard icon={<Activity />} label="有效底座" value={`${qualityFoundationSessions.length}`} />
        <MetricCard icon={<Gauge />} label="近 20 轮速度" value={`${foundationAverage.charsPerMinute} CPM`} />
        <MetricCard icon={<Check />} label="近 20 轮准确率" value={`${foundationAverage.accuracy}%`} />
        <MetricCard icon={<Keyboard />} label="退格/100字" value={`${foundationAverage.backspacePer100Chars}`} />
      </div>
      <div className="insight-grid">
        <InsightCard title="是否可切五笔" body={`${report.completedGates}/${report.totalGates} 个门槛完成。${report.status.ready ? "可以进入五笔主线。" : "继续冲英文/代码底座。"}`} />
        <InsightCard title="当前卡点" body={blockerText} />
        <InsightCard title="下一轮建议" body={report.recommendation} />
      </div>
      <div className="foundation-mode-grid">
        <FoundationModeCard
          mode="english"
          title="英文速度"
          sessions={englishSessions}
          qualitySessions={qualityEnglishSessions}
          targetBackspace={10}
          description="技术短句、术语、命令和大小写切换，目标是先稳定到 80-100 CPM。"
        />
        <FoundationModeCard
          mode="code"
          title="代码符号"
          sessions={codeSessions}
          qualitySessions={qualityCodeSessions}
          targetBackspace={12}
          description="括号、引号、缩进、符号和命名风格，目标是开发输入不被键位拖慢。"
        />
      </div>
      <section className="panel foundation-gates-panel">
        <div className="panel-heading">
          <div>
            <h2>底座门槛</h2>
            <p>英文/代码都达标后，再把每日主训练时间转给五笔。</p>
          </div>
        </div>
        <div className="gate-grid">
          {report.gates.map((gate) => (
            <span key={gate.id} className={gate.passed ? "passed" : ""}>
              {gate.label}
              <small>
                当前 {gate.current} / 目标 {gate.target}
              </small>
            </span>
          ))}
        </div>
      </section>
    </>
  );
}

function FoundationModeCard({
  mode,
  title,
  sessions,
  qualitySessions,
  targetBackspace,
  description,
}: {
  mode: "english" | "code";
  title: string;
  sessions: TrainingSession[];
  qualitySessions: TrainingSession[];
  targetBackspace: number;
  description: string;
}): JSX.Element {
  const recentSessions = getRecentSessions(qualitySessions, qualitySessions.length);
  const recentWindow = recentSessions.slice(0, Math.min(7, recentSessions.length));
  const previousWindow = recentSessions.slice(recentWindow.length, recentWindow.length * 2);
  const recent = averageMetrics(recentWindow);
  const previous = averageMetrics(previousWindow);
  const speedDelta =
    previousWindow.length === 0 ? null : Number((recent.charsPerMinute - previous.charsPerMinute).toFixed(1));
  const accuracyDelta =
    previousWindow.length === 0 ? null : Number((recent.accuracy - previous.accuracy).toFixed(1));
  const stableSamples = Math.min(qualitySessions.length, 20);
  const advice = buildFoundationModeAdvice(mode, qualitySessions.length, recent, targetBackspace);

  return (
    <section className="foundation-mode-card">
      <div className="foundation-mode-heading">
        <div>
          <span>{modeLabels[mode]}</span>
          <h2>{title}</h2>
        </div>
        <strong>{qualitySessions.length}/{sessions.length} 有效轮</strong>
      </div>
      <p>{description}</p>
      <div className="foundation-mode-stats">
        <FoundationStat label="近 7 轮速度" value={`${recent.charsPerMinute} CPM`} />
        <FoundationStat label="速度变化" value={speedDelta === null ? "待对照" : `${formatSigned(speedDelta)} CPM`} />
        <FoundationStat label="准确率" value={`${recent.accuracy}%`} />
        <FoundationStat label="准确率变化" value={accuracyDelta === null ? "待对照" : `${formatSigned(accuracyDelta)}%`} />
        <FoundationStat label="退格/100字" value={`${recent.backspacePer100Chars}`} />
        <FoundationStat label="稳定窗口" value={`${stableSamples}/20 轮`} />
        <FoundationStat label="当前建议" value={advice} wide />
      </div>
    </section>
  );
}

function FoundationStat({ label, value, wide = false }: { label: string; value: string; wide?: boolean }): JSX.Element {
  return (
    <div className={wide ? "foundation-stat wide" : "foundation-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatSigned(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function InsightCard({ title, body }: { title: string; body: string }): JSX.Element {
  return (
    <article className="insight-card">
      <span>{title}</span>
      <strong>{body}</strong>
    </article>
  );
}

function WeakPanel({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
}): JSX.Element {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="rank-list">
        {items.length === 0 ? (
          <p className="empty">暂无数据。</p>
        ) : (
          items.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TrainingCalendarPanel({ days }: { days: ActivityHeatmapDay[] }): JSX.Element {
  const totalMinutes = Number(days.reduce((sum, day) => sum + day.minutes, 0).toFixed(1));
  const activeDays = days.filter((day) => day.sessions > 0).length;

  return (
    <section className="panel heatmap-panel">
      <div className="panel-heading">
        <div>
          <h2>训练日历热力</h2>
          <p>近 56 天的训练密度，颜色越深代表当天投入越多。</p>
        </div>
        <strong>{activeDays} 天 · {totalMinutes}m</strong>
      </div>
      <div className="calendar-heatmap" aria-label="训练日历热力">
        {days.map((day) => (
          <span
            key={day.date}
            className={`heat-cell level-${day.level}`}
            title={`${day.date}: ${day.sessions} 轮 · ${day.minutes}m · ${day.charsPerMinute} CPM · ${day.accuracy}%`}
          />
        ))}
      </div>
    </section>
  );
}

function KeyboardHeatmapPanel({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: HeatmapKeyCell[][];
}): JSX.Element {
  const total = rows.flat().reduce((sum, cell) => sum + cell.count, 0);

  return (
    <section className="panel heatmap-panel">
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <strong>{total}</strong>
      </div>
      <div className="keyboard-heatmap">
        {rows.map((row) => (
          <div className="keyboard-row" key={row.map((cell) => cell.key).join("")}>
            {row.map((cell) => (
              <span
                className={`key-cell level-${cell.level}`}
                key={cell.key}
                title={`${cell.label}: ${cell.detail} · ${cell.count} 次`}
              >
                <b>{cell.label}</b>
                <small>{cell.count > 0 ? cell.count : cell.detail}</small>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function HotspotPanel({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: TextHotspot[];
  emptyText: string;
}): JSX.Element {
  return (
    <section className="panel">
      <h2>{title}</h2>
      <div className="hotspot-list">
        {items.length === 0 ? (
          <p className="empty">{emptyText}</p>
        ) : (
          items.map((item) => (
            <div key={item.id}>
              <span>{item.context}</span>
              <strong>{item.count}</strong>
              <small>{item.detail}</small>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MaterialsView({
  materials,
  sessions,
  onImportRime,
  onImportText,
  onCreateTextMaterial,
  onDeleteMaterial,
  onRestoreBuiltin,
}: {
  materials: MaterialPack[];
  sessions: TrainingSession[];
  onImportRime: (file: File) => Promise<void>;
  onImportText: (file: File, mode: TrainingMode) => Promise<void>;
  onCreateTextMaterial: (draft: TextMaterialPackDraft) => Promise<boolean>;
  onDeleteMaterial: (materialId: string) => Promise<void>;
  onRestoreBuiltin: () => Promise<void>;
}): JSX.Element {
  const [importMode, setImportMode] = useState<TrainingMode>("chinese-real");
  const [draftName, setDraftName] = useState("我的训练材料");
  const [draftMode, setDraftMode] = useState<TrainingMode>("wubi-code");
  const [draftContent, setDraftContent] = useState("");
  const [generatorSource, setGeneratorSource] = useState("");
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<"all" | TrainingMode>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "builtin" | "imported">("all");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const summaries = useMemo(
    () => summarizeMaterialPacks(materials, sessions),
    [materials, sessions],
  );
  const filteredMaterials = useMemo(
    () => filterMaterialPacks(materials, { query, mode: modeFilter, source: sourceFilter }),
    [materials, query, modeFilter, sourceFilter],
  );
  const selectedMaterial =
    materials.find((material) => material.id === selectedMaterialId) ??
    filteredMaterials[0] ??
    null;
  const selectedSummary = selectedMaterial
    ? summaries.find((summary) => summary.id === selectedMaterial.id)
    : null;
  const allMaterialItems = useMemo(
    () => materials.flatMap((material) => material.items),
    [materials],
  );
  const foundationMaterialReadiness = useMemo(
    () => buildFoundationMaterialReadiness(allMaterialItems),
    [allMaterialItems],
  );
  const generatedMaterials = useMemo(
    () => generateProfessionalMaterialDrafts(generatorSource, draftName),
    [generatorSource, draftName],
  );

  function fillGeneratedDraft(draft: ProfessionalMaterialDraft): void {
    setDraftName(draft.name);
    setDraftMode(draft.mode);
    setDraftContent(draft.content);
  }

  async function createGeneratedDraft(draft: ProfessionalMaterialDraft): Promise<void> {
    const created = await onCreateTextMaterial({
      name: draft.name,
      mode: draft.mode,
      content: draft.content,
      source: "professional-generator",
      description: "从专业文本自动拆分生成的训练材料。",
    });
    if (created) {
      setGeneratorSource("");
    }
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Materials</h1>
          <p>材料包按内容 hash 和版本保存，同名不同内容会保留多个版本。</p>
        </div>
        <button className="primary-action" onClick={() => void onRestoreBuiltin()}>
          <RefreshCcw size={18} />
          恢复内置材料
        </button>
      </header>

      <section className={`panel material-readiness-panel ${foundationMaterialReadiness.ready ? "ready" : "attention"}`}>
        <div className="panel-heading">
          <div>
            <h2>底座材料准备度</h2>
            <p>
              80 CPM 解锁线要求单轮至少 {foundationMaterialReadiness.minDurationSeconds} 秒；
              短材料会导致练了很多轮却不计入英文/代码稳定窗口。
            </p>
          </div>
          <span>{foundationMaterialReadiness.ready ? "可用" : "需补充"}</span>
        </div>
        <div className="material-readiness-grid">
          {foundationMaterialReadiness.modes.map((mode) => (
            <MaterialReadinessCard key={mode.mode} readiness={mode} />
          ))}
        </div>
      </section>

      <div className="import-grid">
        <div className="import-card">
          <Import size={24} />
          <strong>导入 Rime 五笔词库</strong>
          <span>选择 wubi86_jidian.dict.yaml 或其他 Rime dict 文件。</span>
          <label className="file-button inline">
            <Upload size={16} />
            选择词库文件
            <input
              type="file"
              accept=".yaml,.yml,.txt"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportRime(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
        <div className="import-card">
          <FileUp size={24} />
          <strong>导入文本材料</strong>
          <span>每行一条，适合中文段落、英文、代码或 Vim 序列。</span>
          <select value={importMode} onChange={(event) => setImportMode(event.target.value as TrainingMode)}>
            {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode]}
              </option>
            ))}
          </select>
          <label className="file-button inline">
            <Upload size={16} />
            选择文本文件
            <input
              type="file"
              accept=".txt,.md,.csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportText(file, importMode);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>
      </div>

      <section className="creator-panel material-generator-panel">
        <div>
          <h2>专业材料生成</h2>
          <p>粘贴项目笔记、技术方案、命令记录或代码片段，先生成可训练的中文、英文、代码和 Vim/命令材料。</p>
        </div>
        <label className="field creator-content">
          <span>原始文本</span>
          <textarea
            value={generatorSource}
            onChange={(event) => setGeneratorSource(event.target.value)}
            placeholder="粘贴项目报告、周复盘、命令记录或代码片段"
          />
        </label>
        {generatorSource.trim() ? (
          generatedMaterials.drafts.length > 0 ? (
            <div className="generated-draft-grid">
              {generatedMaterials.drafts.map((draft) => (
                <article className="generated-draft-card" key={draft.mode}>
                  <div>
                    <span>{modeLabels[draft.mode]}</span>
                    <strong>{draft.itemCount} 条候选</strong>
                  </div>
                  <ul>
                    {draft.examples.map((example) => (
                      <li key={example}>{example}</li>
                    ))}
                  </ul>
                  <div className="button-row">
                    <button className="secondary-inline" onClick={() => fillGeneratedDraft(draft)}>
                      填入编辑
                    </button>
                    <button className="settings-save" onClick={() => void createGeneratedDraft(draft)}>
                      <Check size={16} />
                      直接创建
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-card">没有生成可训练候选。</div>
          )
        ) : null}
      </section>

      <section className="creator-panel">
        <div>
          <h2>新建材料包</h2>
          <p>直接粘贴专业词、中文段落、英文术语、代码片段或 Vim 序列，不必先保存成文件。</p>
        </div>
        <div className="creator-grid">
          <label className="field">
            <span>名称</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <label className="field">
            <span>模式</span>
            <select value={draftMode} onChange={(event) => setDraftMode(event.target.value as TrainingMode)}>
              {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {modeLabels[mode]}
                </option>
              ))}
            </select>
          </label>
          <label className="field creator-content">
            <span>内容</span>
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              placeholder={
                draftMode === "wubi-code"
                  ? "器械\tkkaw\n视觉伺服,pywx/wwfy"
                  : "每行一条训练材料"
              }
            />
          </label>
          <button
            className="settings-save"
            onClick={() => {
              void onCreateTextMaterial({
                name: draftName,
                mode: draftMode,
                content: draftContent,
                source: "manual",
              }).then((created) => {
                if (created) setDraftContent("");
              });
            }}
          >
            <Check size={16} />
            创建材料包
          </button>
        </div>
      </section>

      <div className="material-tools">
        <label className="field">
          <span>搜索材料</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="词条、材料名、来源"
          />
        </label>
        <label className="field">
          <span>训练模式</span>
          <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value as "all" | TrainingMode)}>
            <option value="all">全部模式</option>
            {(Object.keys(modeLabels) as TrainingMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {modeLabels[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>来源</span>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | "builtin" | "imported")}>
            <option value="all">全部来源</option>
            <option value="builtin">内置</option>
            <option value="imported">导入</option>
          </select>
        </label>
      </div>

      <div className="materials-layout">
        <div className="material-list">
          {filteredMaterials.length === 0 ? (
            <div className="empty-card">没有匹配的材料包。</div>
          ) : (
            filteredMaterials.map((material) => {
              const summary = summaries.find((candidate) => candidate.id === material.id);
              return (
                <button
                  className={`material-row ${selectedMaterial?.id === material.id ? "active" : ""}`}
                  key={material.id}
                  onClick={() => setSelectedMaterialId(material.id)}
                >
                  <strong>{material.name}</strong>
                  <span>{material.description}</span>
                  <small>
                    {material.items.length} 条 · {summary?.modes.map((mode) => modeLabels[mode]).join(" / ")}
                  </small>
                </button>
              );
            })
          )}
        </div>

        <aside className="material-detail">
          {selectedMaterial && selectedSummary ? (
            <>
              <div className="panel-heading">
                <h2>{selectedMaterial.name}</h2>
                <button
                  className="danger-inline"
                  disabled={!selectedSummary.canDelete}
                  onClick={() => void onDeleteMaterial(selectedMaterial.id)}
                  title={
                    selectedSummary.canDelete
                      ? "删除未使用的导入材料"
                      : "内置材料或已被训练记录引用，不能删除"
                  }
                >
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
              <p>{selectedMaterial.description}</p>
              <div className="material-meta detail">
                <span>{selectedSummary.itemCount} 条</span>
                <span>{selectedSummary.usedSessionCount} 次训练引用</span>
                <span>{selectedMaterial.source}</span>
                <span>{selectedMaterial.contentHash.slice(0, 10)}</span>
              </div>
              <div className="sample-list">
                {selectedMaterial.items.slice(0, 12).map((item) => (
                  <div key={item.id}>
                    <strong>{item.targetText}</strong>
                    <span>{modeLabels[item.mode]} · {item.category}</span>
                    {item.expectedCodes?.length ? <code>{item.expectedCodes.join(" / ")}</code> : null}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="empty">选择一个材料包查看详情。</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function MaterialReadinessCard({
  readiness,
}: {
  readiness: FoundationMaterialModeReadiness;
}): JSX.Element {
  return (
    <article className={`material-readiness-card ${readiness.status}`}>
      <div>
        <span>{modeLabels[readiness.mode]}</span>
        <strong>{readiness.headline}</strong>
      </div>
      <p>{readiness.detail}</p>
      <div className="material-readiness-stats">
        <span>总数 <b>{readiness.totalItems}</b></span>
        <span>80 CPM <b>{readiness.effectiveItems}/{readiness.targetItems}</b></span>
        <span>100 CPM <b>{readiness.comfortItems}</b></span>
      </div>
    </article>
  );
}

function TutorialView({
  sessions,
  targetMinutes,
  hasWeakTargets,
  evaluationNow,
}: {
  sessions: TrainingSession[];
  targetMinutes: number;
  hasWeakTargets: boolean;
  evaluationNow: Date;
}): JSX.Element {
  const schedule = buildTrainingSchedule(sessions, targetMinutes, 20, hasWeakTargets, {
    now: evaluationNow,
  });

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Wubi Tutorial</h1>
          <p>教程内置在产品里，训练和材料导入可以直接衔接。</p>
        </div>
      </header>
      <section className="tutorial-schedule">
        <div className="panel-heading">
          <div>
            <h2>未来 {schedule.horizonDays} 个训练日</h2>
            <p>{schedule.headline}</p>
          </div>
          <span>{scheduleSwitchLabel(schedule)}</span>
        </div>
        <div className="schedule-meta-grid">
          <SprintList title="复盘节奏" items={schedule.reviewCadence} />
          <SprintList title="执行前提" items={schedule.caveats} />
        </div>
        <div className="schedule-day-grid">
          {schedule.days.map((day) => (
            <ScheduleDayCard key={day.day} day={day} />
          ))}
        </div>
      </section>
      <section className="tutorial-plan">
        <div className="panel-heading">
          <h2>12 周训练路线</h2>
        </div>
        <div className="week-grid">
          {twelveWeekPlan.map((week) => (
            <article className="week-card" key={week.week}>
              <span>Week {week.week}</span>
              <h2>{week.title}</h2>
              <strong>{week.target}</strong>
              <p>{week.focus}</p>
              <div className="drill-row">
                {week.drills.map((drill) => (
                  <span key={drill}>{drill}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="tutorial-list">
        {wubiTutorial.map((section, index) => (
          <article className="tutorial-card" key={section.id}>
            <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
            <div>
              <h2>{section.title}</h2>
              <strong>{section.goal}</strong>
              {section.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
              <div className="drill-row">
                {section.drills.map((drill) => (
                  <span key={drill}>{drill}</span>
                ))}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function scheduleSwitchLabel(schedule: TrainingSchedule): string {
  if (schedule.expectedSwitchDay) {
    return `预计第 ${schedule.expectedSwitchDay} 天切五笔`;
  }
  if (
    (schedule.currentPhase === "baseline" || schedule.currentPhase === "unlock") &&
    schedule.estimatedTrainingDaysToUnlock > 0
  ) {
    if (schedule.estimatedFastTrainingDaysToUnlock === schedule.estimatedTrainingDaysToUnlock) {
      return `还需约 ${schedule.estimatedTrainingDaysToUnlock} 个训练日补齐底座`;
    }
    return `最快 ${schedule.estimatedFastTrainingDaysToUnlock} 天，保守约 ${schedule.estimatedTrainingDaysToUnlock} 天补齐底座`;
  }
  return "当前可执行";
}

function ScheduleDayCard({ day }: { day: TrainingScheduleDay }): JSX.Element {
  return (
    <article className={`schedule-day-card ${day.kind}`}>
      <div className="schedule-day-top">
        <span>Day {day.day}</span>
        {day.checkpoint && <strong>复盘</strong>}
      </div>
      <h2>{day.title}</h2>
      <small>{day.phase} · {day.minutes}m</small>
      <p>{day.summary}</p>
      <div className="schedule-block-list">
        {day.blocks.slice(0, 5).map((block) => (
          <span key={`${day.day}-${block.id}`}>
            {block.minutes}m {block.title}
          </span>
        ))}
      </div>
      <ul>
        {day.acceptance.slice(0, 3).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {day.syncAction && <em>{day.syncAction}</em>}
    </article>
  );
}

function SettingsView({
  settings,
  sessions,
  events,
  materials,
  onExportSync,
  onWriteSyncFolder,
  onExportSyncFolder,
  onExportJsonl,
  onExportCsv,
  onImportSync,
  onImportSyncFolderDirectory,
  onImportSyncFolder,
  pendingSyncImport,
  syncDirectoryHandleName,
  currentTime,
  onConfirmSyncImport,
  onCancelSyncImport,
  onSaveSettings,
  onClearTrainingData,
}: {
  settings: AppSettings;
  sessions: TrainingSession[];
  events: InputEventLog[];
  materials: MaterialPack[];
  onExportSync: () => Promise<void>;
  onWriteSyncFolder: () => Promise<void>;
  onExportSyncFolder: () => Promise<void>;
  onExportJsonl: () => void;
  onExportCsv: () => void;
  onImportSync: (file: File) => Promise<void>;
  onImportSyncFolderDirectory: () => Promise<void>;
  onImportSyncFolder: (file: File) => Promise<void>;
  pendingSyncImport: PendingSyncImport | null;
  syncDirectoryHandleName: string;
  currentTime: Date;
  onConfirmSyncImport: () => Promise<void>;
  onCancelSyncImport: () => void;
  onSaveSettings: (draft: SettingsDraft) => Promise<void>;
  onClearTrainingData: () => Promise<void>;
}): JSX.Element {
  const [deviceName, setDeviceName] = useState(settings.deviceName);
  const [dailyTargetMinutes, setDailyTargetMinutes] = useState(String(settings.dailyTargetMinutes));
  const [syncFolderHint, setSyncFolderHint] = useState(settings.syncFolderHint);
  const [clearConfirm, setClearConfirm] = useState("");
  const syncHealth = useMemo(
    () => buildSyncHealthReport(settings, sessions, events, materials, currentTime),
    [settings, sessions, events, materials, currentTime],
  );

  useEffect(() => {
    setDeviceName(settings.deviceName);
    setDailyTargetMinutes(String(settings.dailyTargetMinutes));
    setSyncFolderHint(settings.syncFolderHint);
  }, [settings]);

  const canClear = clearConfirm.trim() === "清空";

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>Settings</h1>
          <p>文件同步是默认模型：事件日志可追加、可去重、可重算。</p>
        </div>
      </header>
      <div className="settings-grid">
        <section className={`panel sync-health-panel ${syncHealth.status}`}>
          <div className="panel-heading">
            <h2>同步与数据健康</h2>
            <span className="health-badge">{syncHealth.status === "ok" ? "正常" : syncHealth.status === "empty" ? "待开始" : "需处理"}</span>
          </div>
          <p className="panel-copy">{syncHealth.nextAction.detail}</p>
          <div className="health-grid">
            <MetricMini label="训练会话" value={String(syncHealth.summary.sessions)} />
            <MetricMini label="事件日志" value={String(syncHealth.summary.events)} />
            <MetricMini label="材料包" value={String(syncHealth.summary.materials)} />
            <MetricMini label="设备数" value={String(syncHealth.summary.devices)} />
            <MetricMini label="下一步" value={syncHealth.nextAction.label} />
            <MetricMini label="总分钟" value={`${syncHealth.summary.minutes}m`} />
            <MetricMini label="待导出会话" value={String(syncHealth.summary.unsyncedSessions)} />
            <MetricMini label="待导出事件" value={String(syncHealth.summary.unsyncedEvents)} />
            <MetricMini label="待导出材料" value={String(syncHealth.summary.unsyncedMaterials)} />
            <MetricMini label="本机摘要" value={syncFingerprintLabel(syncHealth.summary.dataFingerprint)} />
            <MetricMini label="上次训练" value={formatDateTime(syncHealth.summary.lastSessionAt)} />
            <MetricMini label="自动写入" value={syncDirectoryHandleName || "未授权"} />
          </div>
          <SyncActionPlan steps={syncHealth.actionPlan} />
          <div className="sync-columns">
            <div>
              <h3>设备分布</h3>
              <div className="device-list">
                {syncHealth.deviceSummaries.map((device) => (
                  <div key={device.deviceId}>
                    <strong>{device.deviceName}</strong>
                    <span>{device.sessions} sessions · {device.events} events · {device.minutes}m</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3>事件类型</h3>
              <div className="event-type-list">
                {syncHealth.eventTypeSummaries.length === 0 ? (
                  <p className="empty">暂无事件。</p>
                ) : (
                  syncHealth.eventTypeSummaries.slice(0, 8).map((entry) => (
                    <span key={entry.type}>{entry.type}<strong>{entry.count}</strong></span>
                  ))
                )}
              </div>
            </div>
          </div>
          {syncHealth.issues.length > 0 && (
            <div className="issue-list">
              <h3>需要处理</h3>
              {syncHealth.issues.slice(0, 5).map((issue) => (
                <span key={issue}>{issue}</span>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>训练与设备</h2>
          <div className="settings-form">
            <label className="field">
              <span>设备名</span>
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} />
            </label>
            <label className="field">
              <span>每日目标分钟</span>
              <input
                type="number"
                min={5}
                max={180}
                value={dailyTargetMinutes}
                onChange={(event) => setDailyTargetMinutes(event.target.value)}
              />
            </label>
            <label className="field">
              <span>同步目录提示</span>
              <input
                value={syncFolderHint}
                onChange={(event) => setSyncFolderHint(event.target.value)}
                placeholder="TypingLab/"
              />
            </label>
            <button
              className="settings-save"
              onClick={() =>
                void onSaveSettings({
                  deviceName,
                  dailyTargetMinutes,
                  syncFolderHint,
                })
              }
            >
              <Check size={16} />
              保存设置
            </button>
          </div>
          <div className="kv">
            <span>deviceId</span>
            <code>{settings.deviceId}</code>
          </div>
          <div className="kv">
            <span>本机缓存</span>
            <code>{sessions.length} sessions · {events.length} events · {materials.length} packs</code>
          </div>
          <div className="kv">
            <span>上次导出</span>
            <code>{formatDateTime(settings.lastSyncExportAt)}</code>
          </div>
          <div className="kv">
            <span>上次导入</span>
            <code>{formatDateTime(settings.lastSyncImportAt)}</code>
          </div>
        </section>
        <section className="panel">
          <h2>同步包</h2>
          <p className="panel-copy">
            支持 File System Access 的浏览器可直接读写本地同步目录；读取时会聚合目录里完整的多设备事实流，manifest 用于校验已列文件完整性。不支持时继续使用同步包或同步目录清单。
          </p>
          <div className="button-row">
            <button onClick={() => void onExportSync()}><Download size={16} /> 导出同步包</button>
            <button onClick={() => void onWriteSyncFolder()}><Database size={16} /> 写入同步目录</button>
            <button onClick={() => void onImportSyncFolderDirectory()}><Import size={16} /> 读取同步目录</button>
            <button onClick={() => void onExportSyncFolder()}><Download size={16} /> 同步目录清单</button>
            <button onClick={onExportJsonl}><Download size={16} /> 导出事件 JSONL</button>
            <button onClick={onExportCsv}><Download size={16} /> 导出 CSV</button>
          </div>
          <label className="file-button">
            <Upload size={16} />
            导入同步包
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportSync(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <label className="file-button">
            <Upload size={16} />
            导入同步目录清单
            <input
              type="file"
              accept=".json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onImportSyncFolder(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {pendingSyncImport && (
            <section className="sync-import-preview">
              <div className="panel-heading">
                <div>
                  <h3>待确认导入</h3>
                  <p>{syncImportKindLabels[pendingSyncImport.kind]} · {pendingSyncImport.fileName}</p>
                </div>
              </div>
              <div className="sync-preview-grid">
                <PreviewRow label="来源设备" value={pendingSyncImport.preview.deviceId} />
                <PreviewRow label="导出时间" value={formatDateTime(pendingSyncImport.preview.exportedAt)} />
                <PreviewRow label="文件内数据" value={`${pendingSyncImport.preview.incoming.sessions} sessions · ${pendingSyncImport.preview.incoming.events} events · ${pendingSyncImport.preview.incoming.materials} packs`} />
                <PreviewRow label="确认后本机" value={`${pendingSyncImport.preview.final.sessions} sessions · ${pendingSyncImport.preview.final.events} events · ${pendingSyncImport.preview.final.materials} packs`} />
                <PreviewRow label="来源摘要" value={syncFingerprintLabel(pendingSyncImport.preview.fingerprints.incoming)} />
                <PreviewRow label="确认后摘要" value={syncFingerprintLabel(pendingSyncImport.preview.fingerprints.final)} />
              </div>
              <div className="merge-result-grid">
                <span>新增会话<strong>{pendingSyncImport.preview.result.addedSessions}</strong></span>
                <span>新增事件<strong>{pendingSyncImport.preview.result.addedEvents}</strong></span>
                <span>新增材料<strong>{pendingSyncImport.preview.result.addedMaterials}</strong></span>
                <span>跳过会话<strong>{pendingSyncImport.preview.result.skippedSessions}</strong></span>
                <span>跳过事件<strong>{pendingSyncImport.preview.result.skippedEvents}</strong></span>
                <span>跳过材料<strong>{pendingSyncImport.preview.result.skippedMaterials}</strong></span>
              </div>
              <p className={pendingSyncImport.preview.hasChanges ? "sync-preview-note" : "sync-preview-note muted"}>
                {pendingSyncImport.preview.hasChanges
                  ? "确认后会写入本机缓存；材料冲突会沿用同步包合并规则保留版本。"
                  : "这次导入没有新增内容，可能是重复导入同一份同步数据。"}
              </p>
              {pendingSyncImport.preview.materialNotices.length > 0 && (
                <div className="material-merge-notice-list">
                  <h4>材料合并说明</h4>
                  {pendingSyncImport.preview.materialNotices.slice(0, 5).map((notice) => (
                    <div key={`${notice.kind}-${notice.incomingId}-${notice.resolvedId}`}>
                      <strong>{materialNoticeLabel(notice.kind)} · {notice.name}</strong>
                      <span>{notice.detail}</span>
                      <code>
                        {notice.incomingId}
                        {notice.resolvedId !== notice.incomingId ? ` -> ${notice.resolvedId}` : ""}
                      </code>
                    </div>
                  ))}
                  {pendingSyncImport.preview.materialNotices.length > 5 && (
                    <p>另有 {pendingSyncImport.preview.materialNotices.length - 5} 条材料合并说明。</p>
                  )}
                </div>
              )}
              <section className={`sync-preview-health ${pendingSyncImport.healthAfter.status}`}>
                <div className="preview-health-heading">
                  <strong>确认后健康状态</strong>
                  <span>{healthStatusLabel(pendingSyncImport.healthAfter.status)}</span>
                </div>
                <p>{pendingSyncImport.healthAfter.recommendation}</p>
                <div className="sync-preview-grid compact">
                  <PreviewRow label="设备数" value={`${pendingSyncImport.healthAfter.summary.devices}`} />
                  <PreviewRow label="总分钟" value={`${pendingSyncImport.healthAfter.summary.minutes}m`} />
                  <PreviewRow label="最后训练" value={formatDateTime(pendingSyncImport.healthAfter.summary.lastSessionAt)} />
                  <PreviewRow label="事实摘要" value={syncFingerprintLabel(pendingSyncImport.healthAfter.summary.dataFingerprint)} />
                  <PreviewRow label="问题数" value={`${pendingSyncImport.healthAfter.issues.length}`} />
                </div>
                <SyncActionPlan steps={pendingSyncImport.healthAfter.actionPlan} compact />
                {pendingSyncImport.healthAfter.issues.length > 0 && (
                  <div className="preview-issue-list">
                    {pendingSyncImport.healthAfter.issues.slice(0, 4).map((issue) => (
                      <span key={issue}>{issue}</span>
                    ))}
                  </div>
                )}
              </section>
              <div className="button-row">
                <button onClick={() => void onConfirmSyncImport()}><Check size={16} /> 确认合并</button>
                <button onClick={onCancelSyncImport}><RefreshCcw size={16} /> 取消导入</button>
              </div>
            </section>
          )}
        </section>
        <section className="panel danger-panel">
          <h2>本机数据维护</h2>
          <p className="panel-copy">
            清空只删除本机训练记录和事件日志，保留材料与设置。清空前建议先导出同步包。
          </p>
          <label className="field">
            <span>输入“清空”启用按钮</span>
            <input
              value={clearConfirm}
              onChange={(event) => setClearConfirm(event.target.value)}
              placeholder="清空"
            />
          </label>
          <button
            className="danger-button"
            disabled={!canClear}
            onClick={() => {
              void onClearTrainingData();
              setClearConfirm("");
            }}
          >
            清空本机训练记录
          </button>
        </section>
      </div>
    </section>
  );
}

function SyncActionPlan({
  steps,
  compact = false,
}: {
  steps: SyncHealthReport["actionPlan"];
  compact?: boolean;
}): JSX.Element {
  return (
    <div className={compact ? "sync-action-plan compact" : "sync-action-plan"}>
      <h3>同步行动队列</h3>
      <ol>
        {steps.map((step) => (
          <li key={step.id} className={step.status}>
            <span>{syncActionStatusLabel(step.status)}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function syncActionStatusLabel(status: SyncHealthReport["actionPlan"][number]["status"]): string {
  if (status === "now") return "现在";
  if (status === "next") return "下一步";
  if (status === "done") return "完成";
  return "之后";
}

function materialNoticeLabel(kind: PendingSyncImport["preview"]["materialNotices"][number]["kind"]): string {
  if (kind === "id-conflict") return "ID 冲突";
  if (kind === "name-conflict") return "同名多版本";
  return "重复跳过";
}

function PreviewRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function healthStatusLabel(status: SyncHealthReport["status"]): string {
  if (status === "ok") return "正常";
  if (status === "empty") return "待开始";
  return "需处理";
}

function formatDateTime(value?: string): string {
  if (!value) return "尚未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function dedupeSessions(sessions: TrainingSession[]): TrainingSession[] {
  const seen = new Set<string>();
  const result: TrainingSession[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) continue;
    seen.add(session.id);
    result.push(session);
  }
  return result;
}

function dedupeEvents(events: InputEventLog[]): InputEventLog[] {
  const seen = new Set<string>();
  const result: InputEventLog[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    result.push(event);
  }
  return result;
}

function upsertMaterialPacks(materials: MaterialPack[], updates: MaterialPack[]): MaterialPack[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  for (const material of updates) {
    byId.set(material.id, material);
  }
  return Array.from(byId.values());
}

function removeMaterialPack(materials: MaterialPack[], materialId: string): MaterialPack[] {
  return materials.filter((material) => material.id !== materialId);
}
