import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 发布基线（release baseline）把三类对象接到一起：
 *   去密区域（Redaction）—— 每个确认都记下依据的文档修订号
 *   发布批次（Batch）—— 一份文档可挂多个批次
 *   质检结论（QcConclusion）—— 绑定到质检时依据的修订
 *
 * 文档内容一变（修订号 +1），未发布批次的相关结论立即失效、回到待复核；
 * 已发出的清单冻结为快照，并把当前内容与快照的分歧标出来。
 */

export type Redaction = {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  reason: string;
  privilege: string;
  status: 'draft' | 'confirmed';
  /** 确认时依据的文档修订号；内容一旦落后于当前修订即失效 */
  confirmedRevision?: number;
};

export type QcConclusion = {
  /** 质检时依据的文档修订号 */
  revision: number;
  result: 'passed' | 'rejected';
  reviewer: string;
  at: string;
};

export type ManifestSnapshotEntry = {
  documentId: string;
  title: string;
  revision: number;
  redactionCount: number;
};

export type Manifest = {
  batchId: string;
  issuedAt: string;
  frozen: true;
  /** 发出时的基线快照，冻结后不再随内容改变 */
  snapshot: ManifestSnapshotEntry[];
  /** 发出后内容又变更，冻结清单与当前内容产生分歧 */
  diverged: boolean;
  divergedDocuments: { documentId: string; fromRevision: number; toRevision: number }[];
};

export type Batch = {
  id: string;
  name: string;
  status: '编制中' | '已发布';
  documentIds: string[];
  /** documentId -> 质检结论（绑定修订）；内容变更后未发布批次的结论会被清除 */
  qc: Record<string, QcConclusion>;
  manifest: Manifest | null;
};

export type DisclosureRecord = {
  id: string;
  title: string;
  bundle: string;
  pages: number;
  classification: '内部' | '机密' | '严格机密';
  owner: string;
  updatedAt: string;
  status: '去密中' | '待质检' | '可发布';
  issue: string;
  size: string;
  /** 文档修订号：任何去密内容变更都 +1 */
  revision: number;
  redactions: Redaction[];
};

/** 写入失败后保留的草稿，用于重试 */
export type PendingWrite = {
  id: string;
  kind: 'confirm' | 'qc';
  batchId?: string;
  documentId: string;
  redactionId?: string;
  /** 提交时依据的修订号，用于先到者生效判定 */
  baseRevision: number;
  result?: 'passed' | 'rejected';
  attempts: number;
  error: 'conflict' | 'failed';
  keptDraft: boolean;
};

export type Toast = {
  id: string;
  kind: 'conflict' | 'info' | 'success' | 'warn';
  message: string;
};

const now = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

/** 计算某文档在某批次下的发布基线状态 */
export function docBaseline(batch: Batch, doc: DisclosureRecord) {
  const allConfirmed = doc.redactions.every((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision);
  const qc = batch.qc[doc.id];
  const qcValid = !!qc && qc.result === 'passed' && qc.revision === doc.revision;
  const qcStale = !!qc && qc.revision < doc.revision;
  return { allConfirmed, qc, qcValid, qcStale, ready: allConfirmed && qcValid };
}

const defaultDocuments: DisclosureRecord[] = [
  {
    id: 'DOC-00418',
    title: '设备采购补充协议（第三版）',
    bundle: '北岭项目 · 第一批披露',
    pages: 3,
    classification: '严格机密',
    owner: '林清',
    updatedAt: '09:48',
    status: '去密中',
    issue: '合同主体与商业条款',
    size: '8.4 MB',
    revision: 1,
    redactions: [
      { id: 'R-01', page: 1, x: 0.12, y: 0.16, width: 0.30, height: 0.04, reason: '商业秘密', privilege: '合同保密', status: 'confirmed', confirmedRevision: 1 },
      { id: 'R-02', page: 1, x: 0.50, y: 0.43, width: 0.34, height: 0.06, reason: '个人手机号', privilege: '个人信息', status: 'draft' },
      { id: 'R-03', page: 2, x: 0.11, y: 0.25, width: 0.68, height: 0.05, reason: '第三方报价', privilege: '商业敏感', status: 'confirmed', confirmedRevision: 1 }
    ]
  },
  {
    id: 'DOC-00427',
    title: '现场会议纪要 2026-08-19',
    bundle: '北岭项目 · 第一批披露',
    pages: 3,
    classification: '机密',
    owner: '周叙',
    updatedAt: '09:31',
    status: '待质检',
    issue: '事故预防与整改安排',
    size: '3.1 MB',
    revision: 1,
    redactions: [
      { id: 'R-04', page: 1, x: 0.08, y: 0.69, width: 0.74, height: 0.05, reason: '内部调查意见', privilege: '工作成果', status: 'confirmed', confirmedRevision: 1 }
    ]
  },
  {
    id: 'DOC-00435',
    title: '设备运行数据摘录',
    bundle: '北岭项目 · 第二批披露',
    pages: 3,
    classification: '内部',
    owner: '顾言',
    updatedAt: '08:56',
    status: '可发布',
    issue: '运行记录',
    size: '12.7 MB',
    revision: 1,
    redactions: [
      { id: 'R-05', page: 2, x: 0.44, y: 0.56, width: 0.26, height: 0.04, reason: '人员姓名', privilege: '个人信息', status: 'confirmed', confirmedRevision: 1 }
    ]
  }
];

const defaultBatches: Batch[] = [
  {
    id: 'BATCH-01',
    name: '第一批披露',
    status: '编制中',
    documentIds: ['DOC-00418', 'DOC-00427'],
    qc: {},
    manifest: null
  },
  {
    id: 'BATCH-02',
    name: '第二批披露',
    status: '已发布',
    documentIds: ['DOC-00435'],
    qc: {
      'DOC-00435': { revision: 1, result: 'passed', reviewer: '顾言', at: '08:56' }
    },
    manifest: {
      batchId: 'BATCH-02',
      issuedAt: '08:56',
      frozen: true,
      snapshot: [
        { documentId: 'DOC-00435', title: '设备运行数据摘录', revision: 1, redactionCount: 1 }
      ],
      diverged: false,
      divergedDocuments: []
    }
  },
  {
    id: 'BATCH-03',
    name: '专家材料',
    status: '编制中',
    documentIds: [],
    qc: {},
    manifest: null
  }
];

/** 内容变更后重算文档状态：有未确认区域 -> 去密中，否则待质检 */
function deriveDocStatus(redactions: Redaction[]): DisclosureRecord['status'] {
  return redactions.some((r) => r.status === 'draft') ? '去密中' : '待质检';
}

/**
 * 内容变更的统一入口：
 *  - 文档修订号 +1
 *  - 落后于新修订的已确认区域回到草稿（待复核）
 *  - 未发布批次的质检结论清除（回到待复核）
 *  - 已发布批次的冻结清单标记分歧（影响标出）
 */
function applyContentChange(
  documents: DisclosureRecord[],
  batches: Batch[],
  docId: string
): { documents: DisclosureRecord[]; batches: Batch[] } {
  const target = documents.find((d) => d.id === docId);
  if (!target) return { documents, batches };
  const newRevision = target.revision + 1;

  const nextDocuments = documents.map((doc) => {
    if (doc.id !== docId) return doc;
    const redactions = doc.redactions.map((r) =>
      r.status === 'confirmed' && r.confirmedRevision !== undefined && r.confirmedRevision < newRevision
        ? { ...r, status: 'draft' as const } // 保留 confirmedRevision 以显示“曾确认于 r{k}”
        : r
    );
    return { ...doc, revision: newRevision, redactions, status: deriveDocStatus(redactions), updatedAt: now() };
  });

  const nextBatches = batches.map((batch) => {
    if (batch.manifest) {
      const entry = batch.manifest.snapshot.find((s) => s.documentId === docId);
      if (!entry) return batch;
      const divergedDocuments = [
        ...batch.manifest.divergedDocuments.filter((d) => d.documentId !== docId),
        { documentId: docId, fromRevision: entry.revision, toRevision: newRevision }
      ];
      return { ...batch, manifest: { ...batch.manifest, diverged: true, divergedDocuments } };
    }
    // 未发布批次：保留旧结论，但它绑定的修订已落后 -> 失效、回到待复核
    return batch;
  });

  return { documents: nextDocuments, batches: nextBatches };
}

/** 旧草稿补齐：缺修订号的文档按当前内容补 1，已确认但缺修订号的区域补当前修订 */
function migrateDraft(persisted: Partial<State>): Partial<State> {
  const documents = Array.isArray(persisted.documents)
    ? persisted.documents.map((doc) => {
        const revision = typeof doc.revision === 'number' ? doc.revision : 1;
        const redactions = Array.isArray(doc.redactions)
          ? doc.redactions.map((r) =>
              r.status === 'confirmed' && typeof r.confirmedRevision !== 'number'
                ? { ...r, confirmedRevision: revision }
                : r
            )
          : doc.redactions;
        return { ...doc, revision, redactions };
      })
    : defaultDocuments;

  const batches = Array.isArray(persisted.batches) && persisted.batches.length > 0
    ? persisted.batches.map((b) => ({
        ...b,
        qc: b.qc ?? {},
        manifest: b.manifest ?? null
      }))
    : defaultBatches;

  return {
    ...persisted,
    documents,
    batches,
    pendingWrites: Array.isArray(persisted.pendingWrites) ? persisted.pendingWrites : [],
    toasts: Array.isArray(persisted.toasts) ? persisted.toasts : []
  };
}

type State = {
  documents: DisclosureRecord[];
  batches: Batch[];
  activeDocumentId: string;
  activePage: number;
  activeRedactionId: string | null;
  activeBatchId: string;
  redactionMode: boolean;
  reviewChecks: Record<string, boolean>;
  metadataCleaned: boolean;
  pendingWrites: PendingWrite[];
  toasts: Toast[];
  selectDocument: (id: string) => void;
  setPage: (page: number) => void;
  setActiveBatch: (id: string) => void;
  toggleRedactionMode: () => void;
  addRedaction: (redaction: Omit<Redaction, 'id' | 'status' | 'confirmedRevision'>) => void;
  updateRedaction: (id: string, patch: Partial<Pick<Redaction, 'x' | 'y' | 'width' | 'height' | 'reason' | 'privilege'>>) => void;
  deleteRedaction: (id: string) => void;
  /** 确认区域；baseRevision 为提交时依据的修订，用于先到者生效 */
  confirmRedaction: (id: string, baseRevision?: number) => void;
  /** 模拟队友先提交同一区域（先到者生效演示）：队友把修订 +1 并确认 */
  simulateTeammateConfirm: (docId: string, redactionId: string) => void;
  selectRedaction: (id: string) => void;
  updateClassification: (classification: DisclosureRecord['classification']) => void;
  toggleReviewCheck: (id: string) => void;
  toggleMetadata: () => void;
  /** 提交质检结论，绑定修订；baseRevision 用于先到者生效 */
  submitQc: (batchId: string, docId: string, result: 'passed' | 'rejected', baseRevision?: number) => void;
  markReady: () => void;
  /** 发出清单：同一批次号只追加一次；基线不完整则拒绝出清单 */
  issueManifest: (batchId: string) => void;
  /** 写入失败后保留草稿重试 */
  retryWrite: (writeId: string) => void;
  dismissToast: (id: string) => void;
};

export const useDisclosureStore = create<State>()(
  persist(
    (set, get) => ({
      documents: defaultDocuments,
      batches: defaultBatches,
      activeDocumentId: defaultDocuments[0].id,
      activePage: 1,
      activeRedactionId: 'R-02',
      activeBatchId: 'BATCH-01',
      redactionMode: false,
      reviewChecks: {
        'forbidden-terms': true,
        'page-number': true,
        'image-boundary': false,
        'metadata': false
      },
      metadataCleaned: false,
      pendingWrites: [],
      toasts: [],

      selectDocument: (id) => set({ activeDocumentId: id, activePage: 1, activeRedactionId: null, redactionMode: false }),
      setPage: (page) => set({ activePage: page }),
      setActiveBatch: (id) => set({ activeBatchId: id }),
      toggleRedactionMode: () => set((state) => ({ redactionMode: !state.redactionMode })),

      addRedaction: (redaction) => set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeDocumentId);
        if (!doc) return {};
        const added: Redaction = { ...redaction, id: `R-${Date.now()}`, status: 'draft' };
        const documents = state.documents.map((d) => d.id === state.activeDocumentId ? { ...d, redactions: [...d.redactions, added] } : d);
        return applyContentChange(documents, state.batches, state.activeDocumentId);
      }),

      updateRedaction: (id, patch) => set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeDocumentId);
        if (!doc) return {};
        const documents = state.documents.map((d) => d.id === state.activeDocumentId
          ? { ...d, redactions: d.redactions.map((r) => r.id === id ? { ...r, ...patch } : r) }
          : d);
        return applyContentChange(documents, state.batches, state.activeDocumentId);
      }),

      deleteRedaction: (id) => set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeDocumentId);
        if (!doc) return {};
        const documents = state.documents.map((d) => d.id === state.activeDocumentId
          ? { ...d, redactions: d.redactions.filter((r) => r.id !== id) }
          : d);
        return applyContentChange(documents, state.batches, state.activeDocumentId);
      }),

      confirmRedaction: (redactionId, baseRevision) => set((state) => {
        const doc = state.documents.find((d) => d.id === state.activeDocumentId);
        if (!doc) return {};
        const redaction = doc.redactions.find((r) => r.id === redactionId);
        if (!redaction) return {};

        // 先到者生效：提交依据的修订已落后于当前内容 -> 拒绝，保留草稿待重试
        if (baseRevision !== undefined && doc.revision !== baseRevision) {
          const conflict: PendingWrite = {
            id: `PW-${Date.now()}`,
            kind: 'confirm',
            documentId: doc.id,
            redactionId,
            baseRevision,
            attempts: 1,
            error: 'conflict',
            keptDraft: true
          };
          return {
            pendingWrites: [...state.pendingWrites, conflict],
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'conflict',
              message: `内容已被他人修改（修订 r${baseRevision} → r${doc.revision}），先到者生效。草稿已保留，可重试。`
            }]
          };
        }

        const documents = state.documents.map((d) => d.id === doc.id ? {
          ...d,
          redactions: d.redactions.map((r) => r.id === redactionId
            ? { ...r, status: 'confirmed' as const, confirmedRevision: d.revision }
            : r)
        } : d);
        return { documents };
      }),

      simulateTeammateConfirm: (docId, redactionId) => set((state) => {
        const doc = state.documents.find((d) => d.id === docId);
        if (!doc) return {};
        // 队友先提交：先走统一内容变更（修订 +1，已确认区域回退、未发布批次结论失效），
        // 再把该区域按新修订确认（先到者生效）。
        const { documents, batches } = applyContentChange(state.documents, state.batches, docId);
        const nextDocuments = documents.map((d) => d.id === docId ? {
          ...d,
          redactions: d.redactions.map((r) => r.id === redactionId
            ? { ...r, status: 'confirmed' as const, confirmedRevision: d.revision }
            : r)
        } : d);
        const newRevision = nextDocuments.find((d) => d.id === docId)!.revision;
        return {
          documents: nextDocuments,
          batches,
          toasts: [...state.toasts, {
            id: `T-${Date.now()}`,
            kind: 'info',
            message: `队友已先提交该区域（先到者生效），文档修订更新至 r${newRevision}。`
          }]
        };
      }),

      selectRedaction: (id) => set({ activeRedactionId: id }),

      updateClassification: (classification) => set((state) => {
        const documents = state.documents.map((d) => d.id === state.activeDocumentId ? { ...d, classification } : d);
        return applyContentChange(documents, state.batches, state.activeDocumentId);
      }),

      toggleReviewCheck: (id) => set((state) => ({ reviewChecks: { ...state.reviewChecks, [id]: !state.reviewChecks[id] } })),
      toggleMetadata: () => set((state) => ({ metadataCleaned: !state.metadataCleaned })),

      submitQc: (batchId, docId, result, baseRevision) => set((state) => {
        const batch = state.batches.find((b) => b.id === batchId);
        const doc = state.documents.find((d) => d.id === docId);
        if (!batch || !doc) return {};

        // 已发布批次冻结，不再接受新结论
        if (batch.manifest) {
          return {
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'warn',
              message: `批次 ${batch.id} 清单已发出并冻结，质检结论不再变更。`
            }]
          };
        }

        // 先到者生效
        if (baseRevision !== undefined && doc.revision !== baseRevision) {
          const conflict: PendingWrite = {
            id: `PW-${Date.now()}`,
            kind: 'qc',
            batchId,
            documentId: docId,
            baseRevision,
            result,
            attempts: 1,
            error: 'conflict',
            keptDraft: true
          };
          return {
            pendingWrites: [...state.pendingWrites, conflict],
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'conflict',
              message: `质检提交时内容已变更（修订 r${baseRevision} → r${doc.revision}），先到者生效。草稿已保留，可重试。`
            }]
          };
        }

        // 通过前必须所有区域在当前修订下已确认
        const allConfirmed = doc.redactions.every((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision);
        if (result === 'passed' && !allConfirmed) {
          return {
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'warn',
              message: `文档 ${doc.id} 仍有未按当前修订确认的区域，不能通过质检。`
            }]
          };
        }

        const qc: Record<string, QcConclusion> = {
          ...batch.qc,
          [docId]: { revision: doc.revision, result, reviewer: '林清', at: now() }
        };
        const documents = state.documents.map((d) => d.id === docId
          ? { ...d, status: (result === 'passed' ? '可发布' : '待质检') as DisclosureRecord['status'] }
          : d);
        return {
          documents,
          batches: state.batches.map((b) => b.id === batchId ? { ...b, qc } : b),
          toasts: [...state.toasts, {
            id: `T-${Date.now()}`,
            kind: 'success',
            message: `已记录 ${doc.id} 质检结论（依据修订 r${doc.revision}）。`
          }]
        };
      }),

      markReady: () => set((state) => ({
        documents: state.documents.map((doc) => doc.id === state.activeDocumentId ? { ...doc, status: '可发布' } : doc)
      })),

      issueManifest: (batchId) => set((state) => {
        const batch = state.batches.find((b) => b.id === batchId);
        if (!batch) return {};

        // 同一批次号只追加一次：已发出则直接返回，不重复追加
        if (batch.manifest) {
          return {
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'info',
              message: `批次 ${batch.id} 清单已于 ${batch.manifest.issuedAt} 发出，冻结不重复追加。`
            }]
          };
        }

        // 发布基线完整：每份文档的所有区域已按当前修订确认，且质检在当前修订通过
        const missing: string[] = [];
        for (const docId of batch.documentIds) {
          const doc = state.documents.find((d) => d.id === docId);
          if (!doc) { missing.push(`${docId}（文档不存在）`); continue; }
          const allConfirmed = doc.redactions.every((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision);
          const qc = batch.qc[docId];
          const qcValid = qc && qc.result === 'passed' && qc.revision === doc.revision;
          if (!allConfirmed) missing.push(`${docId}（区域未重新确认）`);
          else if (!qcValid) missing.push(`${docId}（质检未按当前修订通过）`);
        }

        if (missing.length > 0) {
          return {
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'warn',
              message: `批次 ${batch.id} 发布基线不完整，不能出清单：${missing.join('；')}。`
            }]
          };
        }

        const snapshot: ManifestSnapshotEntry[] = batch.documentIds.map((docId) => {
          const doc = state.documents.find((d) => d.id === docId)!;
          return { documentId: docId, title: doc.title, revision: doc.revision, redactionCount: doc.redactions.length };
        });

        const manifest: Manifest = {
          batchId,
          issuedAt: now(),
          frozen: true,
          snapshot,
          diverged: false,
          divergedDocuments: []
        };

        return {
          batches: state.batches.map((b) => b.id === batchId ? { ...b, status: '已发布' as const, manifest } : b),
          toasts: [...state.toasts, {
            id: `T-${Date.now()}`,
            kind: 'success',
            message: `批次 ${batch.id} 发布清单已冻结发出，共 ${snapshot.length} 份文档。`
          }]
        };
      }),

      retryWrite: (writeId) => set((state) => {
        const write = state.pendingWrites.find((w) => w.id === writeId);
        if (!write) return {};
        // 重试时按当前内容重新取修订号，草稿保留不丢
        const doc = state.documents.find((d) => d.id === write.documentId);
        if (!doc) return { pendingWrites: state.pendingWrites.filter((w) => w.id !== writeId) };

        if (write.kind === 'confirm' && write.redactionId) {
          const redaction = doc.redactions.find((r) => r.id === write.redactionId);
          if (!redaction) return { pendingWrites: state.pendingWrites.filter((w) => w.id !== writeId) };
          // 已被队友确认则直接生效，否则按当前修订确认
          const documents = state.documents.map((d) => d.id === doc.id ? {
            ...d,
            redactions: d.redactions.map((r) => r.id === write.redactionId
              ? { ...r, status: 'confirmed' as const, confirmedRevision: d.revision }
              : r)
          } : d);
          return {
            documents,
            pendingWrites: state.pendingWrites.filter((w) => w.id !== writeId),
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'success',
              message: `已按当前修订 r${doc.revision} 重新确认区域，草稿未丢失。`
            }]
          };
        }

        if (write.kind === 'qc' && write.batchId && write.result) {
          const batch = state.batches.find((b) => b.id === write.batchId);
          if (!batch || batch.manifest) return { pendingWrites: state.pendingWrites.filter((w) => w.id !== writeId) };
          const allConfirmed = doc.redactions.every((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision);
          if (write.result === 'passed' && !allConfirmed) {
            return {
              pendingWrites: state.pendingWrites.map((w) => w.id === writeId ? { ...w, attempts: w.attempts + 1 } : w),
              toasts: [...state.toasts, {
                id: `T-${Date.now()}`,
                kind: 'warn',
                message: `重试仍不满足：文档 ${doc.id} 有未按当前修订确认的区域。`
              }]
            };
          }
          const qc: Record<string, QcConclusion> = {
            ...batch.qc,
            [doc.id]: { revision: doc.revision, result: write.result, reviewer: '林清', at: now() }
          };
          return {
            batches: state.batches.map((b) => b.id === write.batchId ? { ...b, qc } : b),
            documents: state.documents.map((d) => d.id === doc.id
              ? { ...d, status: (write.result === 'passed' ? '可发布' : '待质检') as DisclosureRecord['status'] }
              : d),
            pendingWrites: state.pendingWrites.filter((w) => w.id !== writeId),
            toasts: [...state.toasts, {
              id: `T-${Date.now()}`,
              kind: 'success',
              message: `已按当前修订 r${doc.revision} 重新提交质检结论。`
            }]
          };
        }

        return {};
      }),

      dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }),
    {
      name: 'yy59-disclosure-draft',
      merge: (persisted, current) => {
        const migrated = migrateDraft((persisted ?? {}) as Partial<State>);
        return { ...current, ...migrated };
      }
    }
  )
);
