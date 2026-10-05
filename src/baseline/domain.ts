/**
 * 发布基线纯领域函数：不依赖 React / localStorage，可直接单元测试。
 */
import type {
  DisclosureRecord,
  ManifestDraft,
  ManifestEntry,
  ManifestRegisterEntry,
  ManifestSnapshot,
  Operator,
  QualityConclusion,
  Redaction,
  ReleaseBatch,
  ReleaseState,
  RevisionHistoryEntry
} from './types';

/* ------------------------------------------------------------------ */
/* 内容指纹：区域集合的稳定哈希，用于判断"内容一变"                        */
/* ------------------------------------------------------------------ */

export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function redactionSignature(r: Redaction): string {
  // 注意：status 是流转状态，不参与内容指纹。
  // 草稿→确认不产生新修订；新增/改几何/删除才会。
  return [r.page, r.x, r.y, r.width, r.height, r.reason, r.privilege].join('|');
}

export function contentHashOf(redactions: Redaction[]): string {
  const body = [...redactions]
    .map((r) => `${r.id}:${redactionSignature(r)}`)
    .sort()
    .join(';');
  return fnv1a(body);
}

/* ------------------------------------------------------------------ */
/* 旧草稿迁移：缺修订号时按当前内容补齐                                  */
/* ------------------------------------------------------------------ */

/**
 * 旧数据里区域没有 basisRevision、文档没有 revision/contentHash。
 * 按"当前内容"补齐：
 *  - 文档修订号从 1 起，指纹按当前区域集合计算；
 *  - 已确认区域的依据修订号补成当前修订号（旧清单的既有结论仍指向当时内容）；
 *  - 草稿区域不写依据（尚未确认）。
 */
export function normalizeDocument(doc: DisclosureRecord): DisclosureRecord {
  // 指纹完全由区域集合决定，始终重算以保证不变量（含历史数据校正）
  const contentHash = contentHashOf(doc.redactions);
  const revision = doc.revision ?? 1;
  const revisionHistory: RevisionHistoryEntry[] = doc.revisionHistory?.length
    ? doc.revisionHistory.map((h) => (h.revision === revision ? { ...h, contentHash } : h))
    : [{ revision, contentHash, at: doc.updatedAt, summary: '历史版本（旧草稿按当前内容补齐修订号）' }];
  return {
    ...doc,
    revision,
    contentHash,
    revisionHistory,
    redactions: doc.redactions.map((r) =>
      r.status === 'confirmed' && r.basisRevision === undefined
        ? { ...r, basisRevision: revision, basisContentHash: contentHash }
        : r
    )
  };
}

export function normalizeState(state: ReleaseState): ReleaseState {
  const documents = state.documents.map(normalizeDocument);
  const byId = new Map(documents.map((d) => [d.id, d]));
  const conclusions = (state.conclusions ?? []).map((c) => {
    // 旧结论缺指纹时按结论锚定的修订（也就是当前内容）补齐
    if (c.contentHash) return c;
    const doc = byId.get(c.documentId);
    return { ...c, contentHash: doc?.contentHash ?? '' };
  });
  return {
    documents,
    conclusions,
    batches: state.batches ?? [],
    manifestRegister: state.manifestRegister ?? []
  };
}

/* ------------------------------------------------------------------ */
/* 修订推进：区域内容一变                                                */
/* ------------------------------------------------------------------ */

/**
 * 内容一变：修订号 +1、记录历史；未发布批次的相关质检结论失效并回到待复核。
 * 已发出清单不在这里处理（快照本身冻结），由 manifestImpact 标出影响。
 *
 * @param reason 变更说明，写入修订历史
 */
export function bumpRevision(
  state: ReleaseState,
  documentId: string,
  reason: string,
  at: string
): { state: ReleaseState; invalidatedIds: string[] } {
  const target = state.documents.find((d) => d.id === documentId);
  if (!target) return { state, invalidatedIds: [] };

  const nextHash = contentHashOf(target.redactions);
  if (nextHash === target.contentHash) return { state, invalidatedIds: [] };

  const newRevision = target.revision + 1;
  const history: RevisionHistoryEntry = { revision: newRevision, contentHash: nextHash, at, summary: reason };
  const updatedDoc: DisclosureRecord = {
    ...target,
    revision: newRevision,
    contentHash: nextHash,
    revisionHistory: [...target.revisionHistory, history],
    // 内容变了，未发布批次要回到待复核
    status: '待质检'
  };

  const documents = state.documents.map((d) => (d.id === documentId ? updatedDoc : d));

  const impactedBatchNames = state.batches
    .filter((b) => b.documentIds.includes(documentId) && !b.issuedManifest)
    .map((b) => b.name);

  const invalidatedIds: string[] = [];
  const conclusions = state.conclusions.map((c) => {
    if (c.documentId !== documentId || c.status !== 'active') return c;
    if (c.revision === newRevision && c.contentHash === nextHash) return c;
    invalidatedIds.push(c.id);
    return {
      ...c,
      status: 'invalidated' as const,
      invalidatedAt: at,
      invalidateReason: reason,
      impactedBatches: impactedBatchNames
    };
  });

  return { state: { ...state, documents, conclusions }, invalidatedIds };
}

/* ------------------------------------------------------------------ */
/* 确认去密区域：记下依据的修订；两人同时确认同一区域先到者生效             */
/* ------------------------------------------------------------------ */

export type ConfirmOutcome =
  | { ok: true; state: ReleaseState; redaction: Redaction }
  | { ok: false; reason: 'not-found' | 'already-confirmed'; winner?: Operator; at?: string };

/**
 * 确认区域（compare-and-set）。
 *
 * 并发语义：expectedStatus 由调用方在按下按钮前读取。两个操作者几乎同时提交时，
 * 只有第一笔能把 draft -> confirmed，第二笔拿到 already-confirmed，并看到先到者。
 */
export function confirmRedaction(
  state: ReleaseState,
  documentId: string,
  redactionId: string,
  operator: Operator,
  at: string,
  expectedStatus: Redaction['status'] = 'draft'
): ConfirmOutcome {
  const doc = state.documents.find((d) => d.id === documentId);
  const redaction = doc?.redactions.find((r) => r.id === redactionId);
  if (!doc || !redaction) return { ok: false, reason: 'not-found' };
  if (redaction.status === 'confirmed') {
    return { ok: false, reason: 'already-confirmed', winner: redaction.confirmedBy, at: redaction.confirmedAt };
  }
  // 预期被并发提交抢先改掉：CAS 失败按先到者处理
  if (expectedStatus !== redaction.status) {
    return { ok: false, reason: 'already-confirmed' };
  }

  const confirmed: Redaction = {
    ...redaction,
    status: 'confirmed',
    basisRevision: doc.revision,
    basisContentHash: doc.contentHash,
    confirmedBy: operator,
    confirmedAt: at
  };
  const documents = state.documents.map((d) =>
    d.id === documentId
      ? { ...d, redactions: d.redactions.map((r) => (r.id === redactionId ? confirmed : r)) }
      : d
  );
  return { ok: true, state: { ...state, documents }, redaction: confirmed };
}

/* ------------------------------------------------------------------ */
/* 质检结论：按当前修订作出                                              */
/* ------------------------------------------------------------------ */

export type QualityCheckInput = { id: string; label: string; passed: boolean };

export function canRecordConclusion(doc: DisclosureRecord): { ok: boolean; reason?: string } {
  if (doc.redactions.length === 0) return { ok: false, reason: '文档没有任何去密区域' };
  const drafts = doc.redactions.filter((r) => r.status === 'draft');
  if (drafts.length) return { ok: false, reason: `仍有 ${drafts.length} 个去密区域未确认` };
  return { ok: true };
}

export function recordQualityConclusion(
  state: ReleaseState,
  params: {
    documentId: string;
    reviewer: Operator;
    checks: QualityCheckInput[];
    metadataCleaned: boolean;
    verdict: 'pass' | 'reject';
    at: string;
  }
): { state: ReleaseState; conclusion?: QualityConclusion; error?: string } {
  const doc = state.documents.find((d) => d.id === params.documentId);
  if (!doc) return { state, error: '文档不存在' };
  const gate = canRecordConclusion(doc);
  if (!gate.ok) return { state, error: gate.reason };
  if (params.verdict === 'pass' && params.checks.some((c) => !c.passed)) {
    return { state, error: '存在未通过的校验项' };
  }
  if (params.verdict === 'pass' && !params.metadataCleaned) {
    return { state, error: '元数据尚未清理' };
  }

  const conclusion: QualityConclusion = {
    id: `QC-${doc.id}-r${doc.revision}`,
    documentId: doc.id,
    revision: doc.revision,
    contentHash: doc.contentHash,
    reviewer: params.reviewer,
    verdict: params.verdict,
    checks: params.checks,
    metadataCleaned: params.metadataCleaned,
    status: 'active',
    createdAt: params.at
  };

  // 同文档同修订再次确认：旧结论被新结论取代
  const conclusions = state.conclusions.map((c) =>
    c.documentId === doc.id && c.status === 'active' && c.revision === doc.revision
      ? { ...c, status: 'superseded' as const }
      : c
  );
  conclusions.push(conclusion);

  const documents =
    params.verdict === 'pass'
      ? state.documents.map((d) => (d.id === doc.id ? { ...d, status: '可发布' as const } : d))
      : state.documents;

  return { state: { ...state, conclusions, documents }, conclusion };
}

export function activeConclusionFor(
  conclusions: QualityConclusion[],
  documentId: string
): QualityConclusion | undefined {
  return conclusions.find((c) => c.documentId === documentId && c.status === 'active');
}

/** 文档最近一条结论（可能已失效），用于把"回到待复核"显式标出来 */
export function latestConclusionFor(
  conclusions: QualityConclusion[],
  documentId: string
): QualityConclusion | undefined {
  const list = conclusions.filter((c) => c.documentId === documentId);
  return list.length ? list[list.length - 1] : undefined;
}

/** 文档相对当前修订的基线状态 */
export function documentBaselineState(
  doc: DisclosureRecord,
  conclusions: QualityConclusion[]
): 'in-progress' | 'await-qc' | 'recheck' | 'releasable' {
  const active = activeConclusionFor(conclusions, doc.id);
  if (active?.verdict === 'pass' && active.revision === doc.revision && active.contentHash === doc.contentHash) {
    return 'releasable';
  }
  const latest = latestConclusionFor(conclusions, doc.id);
  if (
    (latest?.status === 'invalidated') ||
    (active && (active.revision !== doc.revision || active.contentHash !== doc.contentHash))
  ) {
    return 'recheck';
  }
  return doc.status === '去密中' ? 'in-progress' : 'await-qc';
}

/* ------------------------------------------------------------------ */
/* 发布门禁：没重新确认的批次不能出清单                                    */
/* ------------------------------------------------------------------ */

export type GateBlock =
  | { kind: 'no-conclusion'; documentId: string; title: string }
  | { kind: 'stale-conclusion'; documentId: string; title: string; conclusionRevision: number; currentRevision: number };

export type BatchEvaluation = {
  batch: ReleaseBatch;
  ready: boolean;
  blocks: GateBlock[];
  entries: ManifestEntry[];
};

export function evaluateBatch(state: ReleaseState, batchId: string): BatchEvaluation {
  const batch = state.batches.find((b) => b.id === batchId);
  const blocks: GateBlock[] = [];
  const entries: ManifestEntry[] = [];
  if (!batch) return { batch: {} as ReleaseBatch, ready: false, blocks, entries };

  for (const docId of batch.documentIds) {
    const doc = state.documents.find((d) => d.id === docId);
    if (!doc) continue;
    const conclusion = activeConclusionFor(state.conclusions, docId);
    if (!conclusion || conclusion.verdict !== 'pass') {
      blocks.push({ kind: 'no-conclusion', documentId: docId, title: doc.title });
      continue;
    }
    if (conclusion.revision !== doc.revision || conclusion.contentHash !== doc.contentHash) {
      blocks.push({
        kind: 'stale-conclusion',
        documentId: docId,
        title: doc.title,
        conclusionRevision: conclusion.revision,
        currentRevision: doc.revision
      });
      continue;
    }
    entries.push({
      documentId: doc.id,
      title: doc.title,
      revision: doc.revision,
      contentHash: doc.contentHash,
      redactionCount: doc.redactions.length,
      conclusionId: conclusion.id,
      reviewer: conclusion.reviewer.name
    });
  }

  return { batch, ready: blocks.length === 0 && entries.length > 0, blocks, entries };
}

/* ------------------------------------------------------------------ */
/* 已发出清单冻结，并标出内容漂移影响                                     */
/* ------------------------------------------------------------------ */

export type ManifestImpact =
  | { kind: 'frozen-current'; entry: ManifestSnapshot['entries'][number]; doc?: DisclosureRecord }
  | {
      kind: 'frozen-drifted';
      entry: ManifestSnapshot['entries'][number];
      doc: DisclosureRecord;
      activeConclusion?: QualityConclusion;
    };

export function manifestImpact(
  state: ReleaseState,
  manifest: ManifestSnapshot
): ManifestImpact[] {
  return manifest.entries.map((entry) => {
    const doc = state.documents.find((d) => d.id === entry.documentId);
    if (!doc || (doc.revision === entry.revision && doc.contentHash === entry.contentHash)) {
      return { kind: 'frozen-current', entry, doc };
    }
    return {
      kind: 'frozen-drifted',
      entry,
      doc,
      activeConclusion: activeConclusionFor(state.conclusions, entry.documentId)
    };
  });
}

/**
 * 构造清单快照（冻结点）。调用前必须先过门禁。
 * 快照只记录当时的修订、指纹和结论 ID，之后任何内容变化都不会改写它。
 */
export function buildManifest(
  state: ReleaseState,
  batchId: string,
  issuedBy: Operator,
  at: string
): { manifest?: ManifestSnapshot; error?: string } {
  const evaluation = evaluateBatch(state, batchId);
  if (evaluation.batch.issuedManifest) return { error: '该批次清单已发出并冻结' };
  if (!evaluation.ready) return { error: '存在未重新确认的文档，不能出清单' };
  return {
    manifest: {
      manifestNo: evaluation.batch.id,
      batchName: evaluation.batch.name,
      issuedAt: at,
      issuedBy,
      entries: evaluation.entries
    }
  };
}

/* ------------------------------------------------------------------ */
/* 追加式登记册：同一批次号只追加一次                                     */
/* ------------------------------------------------------------------ */

export type AppendInput = {
  manifest: ManifestSnapshot;
  at: string;
  /** 注入失败：模拟写入端抖动 */
  fail?: boolean;
  delayMs?: number;
};

export type AppendResult =
  | { ok: true; register: ManifestRegisterEntry[]; appended: boolean; entry?: ManifestRegisterEntry }
  | { ok: false; error: string };

/**
 * 追加发布清单。纯函数版：fail=true 时模拟写入失败且不改变登记册。
 * 幂等：同一 manifestNo 永远只追加第一次，重试返回既有记录。
 */
export function appendManifest(
  register: ManifestRegisterEntry[],
  input: AppendInput
): AppendResult {
  const existing = register.find((m) => m.manifestNo === input.manifest.manifestNo);
  if (existing) {
    return { ok: true, register, appended: false, entry: existing };
  }
  if (input.fail) {
    return { ok: false, error: '写入失败：登记册暂时不可用，草稿已保留' };
  }
  const entry: ManifestRegisterEntry = { ...input.manifest, appendedAt: input.at };
  return { ok: true, register: [...register, entry], appended: true, entry };
}

export function isManifestAppended(register: ManifestRegisterEntry[], manifestNo: string): boolean {
  return register.some((m) => m.manifestNo === manifestNo);
}

export function describeDraft(draft: ManifestDraft): string {
  return `${draft.manifest.manifestNo} · ${draft.manifest.entries.length} 份文档 · 第 ${draft.attempts} 次尝试${draft.lastError ? `（${draft.lastError}）` : ''}`;
}
