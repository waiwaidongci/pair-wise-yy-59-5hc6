import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  activeConclusionFor,
  bumpRevision,
  buildManifest,
  canRecordConclusion,
  confirmRedaction as confirmRedactionDomain,
  documentBaselineState,
  evaluateBatch,
  latestConclusionFor,
  manifestImpact,
  normalizeState,
  recordQualityConclusion,
  type QualityCheckInput
} from './baseline/domain';
import { createManifestRepository } from './baseline/repository';
import { createDefaultState, DEFAULT_CHECKS, DEFAULT_OPERATOR, OPERATORS } from './baseline/seed';
import type {
  DisclosureRecord,
  ManifestDraft,
  ManifestRegisterEntry,
  ManifestSnapshot,
  Operator,
  QualityConclusion,
  Redaction,
  ReleaseState
} from './baseline/types';

export type {
  DisclosureRecord,
  ManifestDraft,
  ManifestSnapshot,
  Operator,
  QualityConclusion,
  Redaction,
  ReleaseBatch
} from './baseline/types';

export type Notice = {
  id: number;
  tone: 'info' | 'success' | 'warning' | 'danger';
  text: string;
};

const nowLabel = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

type PersistedShape = ReleaseState & {
  activeDocumentId: string;
  activePage: number;
  activeRedactionId: string | null;
  redactionMode: boolean;
  reviewChecks: Record<string, boolean>;
  metadataCleaned: boolean;
  activeOperatorId: string;
  drafts: ManifestDraft[];
  manifestRegister: ManifestRegisterEntry[];
  nextWriteFails: boolean;
};

type State = PersistedShape & {
  notices: Notice[];
  issueStatus: { batchId: string; state: 'idle' | 'writing' | 'failed' | 'issued'; message: string } | null;
  pushNotice: (tone: Notice['tone'], text: string) => void;
  dismissNotice: (id: number) => void;
  selectDocument: (id: string) => void;
  setPage: (page: number) => void;
  toggleRedactionMode: () => void;
  setOperator: (id: string) => void;
  selectRedaction: (id: string | null) => void;
  updateClassification: (classification: DisclosureRecord['classification']) => void;
  addRedaction: (redaction: Omit<Redaction, 'id' | 'status'>) => void;
  /** 确认区域；expectedStatus 实现先到先得的 CAS 判定 */
  confirmRedaction: (id: string, expectedStatus?: Redaction['status']) => void;
  toggleReviewCheck: (id: string) => void;
  toggleMetadata: () => void;
  recordQuality: (documentId: string, verdict: 'pass' | 'reject') => void;
  setBatchDocuments: (batchId: string, documentIds: string[]) => void;
  toggleNextWriteFailure: () => void;
  issueManifest: (batchId: string) => Promise<void>;
  retryIssue: (manifestNo: string) => Promise<void>;
  discardDraft: (manifestNo: string) => void;
  resetDemo: () => void;
};

const defaultState = createDefaultState();

const reviewChecksFromDefaults = () =>
  Object.fromEntries(DEFAULT_CHECKS.map((c) => [c.id, true])) as Record<string, boolean>;

function activeOperator(s: State | PersistedShape): Operator {
  return OPERATORS.find((o) => o.id === s.activeOperatorId) ?? DEFAULT_OPERATOR;
}

let noticeSeq = 1;

export const useDisclosureStore = create<State>()(
  persist(
    (set, get) => {
      const repository = createManifestRepository(
        () => get().manifestRegister,
        (next) => set({ manifestRegister: next }),
        nowLabel,
        { delayMs: 500 }
      );

      const patchRelease = (
        next: ReleaseState,
        extra?: Partial<PersistedShape>,
        invalidatedIds: string[] = []
      ) => {
        if (invalidatedIds.length) {
          const invalidated = next.conclusions.filter((c) => invalidatedIds.includes(c.id));
          const names = [...new Set(invalidated.flatMap((c) => c.impactedBatches ?? []))].join('、') || '当前';
          set({
            documents: next.documents,
            conclusions: next.conclusions,
            batches: next.batches,
            ...extra
          });
          get().pushNotice('warning', `去密内容已变化（修订推进），${names} 未发布批次的既有质检结论失效，已回到待复核。`);
        } else {
          set({
            documents: next.documents,
            conclusions: next.conclusions,
            batches: next.batches,
            ...extra
          });
        }
      };

      const snapshotState = (s: PersistedShape): ReleaseState => ({
        documents: s.documents,
        conclusions: s.conclusions,
        batches: s.batches,
        manifestRegister: s.manifestRegister
      });

      const appendDrafts = (manifest: ManifestSnapshot, attempts: number, lastError?: string) => {
        const existing = get().drafts.find((d) => d.manifest.manifestNo === manifest.manifestNo);
        const draft: ManifestDraft = {
          manifest,
          attempts,
          lastError,
          savedAt: nowLabel()
        };
        set({
          drafts: existing
            ? get().drafts.map((d) => (d.manifest.manifestNo === manifest.manifestNo ? draft : d))
            : [...get().drafts, draft]
        });
      };

      const doAppend = async (batchId: string, manifest: ManifestSnapshot, attempt: number) => {
        // 已冻结批次绝不重发：同一批次号一生只追加一次
        const frozenBatch = get().batches.find((b) => b.id === batchId);
        if (frozenBatch?.issuedManifest) {
          set({ issueStatus: { batchId, state: 'issued', message: '清单已冻结并追加，不能重复出具' } });
          get().pushNotice('warning', `${batchId} 清单此前已发出并冻结，沿用既有追加记录。`);
          return;
        }
        set({ issueStatus: { batchId, state: 'writing', message: `正在追加清单 ${manifest.manifestNo}（第 ${attempt} 次）…` } });
        const shouldFail = get().nextWriteFails;
        // "下一次写入失败"是一次性开关，无论成败都消费掉，保证重试可以成功
        if (shouldFail) set({ nextWriteFails: false });
        const response = await repository.append(manifest, { fail: shouldFail });
        if (response.ok) {
          const already = !response.appended;
          set((s) => ({
            drafts: s.drafts.filter((d) => d.manifest.manifestNo !== manifest.manifestNo),
            batches: s.batches.map((b) =>
              b.id === batchId && !b.issuedManifest
                ? { ...b, name: b.name.replace(/ · .*$/, '') + ' · 已发出', issuedManifest: response.entry }
                : b
            ),
            issueStatus: {
              batchId,
              state: 'issued',
              message: already
                ? `登记册中已有该批次号，沿用首次追加记录（同一批次号只追加一次）`
                : `清单已冻结并追加：${manifest.entries.length} 份文档`
            }
          }));
          get().pushNotice('success', `${manifest.manifestNo} 发布清单已冻结${already ? '（此前已登记，未重复追加）' : ''}。`);
          return;
        }
        appendDrafts(manifest, attempt, response.error);
        set({ issueStatus: { batchId, state: 'failed', message: response.error } });
        get().pushNotice('danger', `${response.error} 草稿已保留，可直接重试。`);
      };

      return {
        ...defaultState,
        activeDocumentId: defaultState.documents[0].id,
        activePage: 1,
        activeRedactionId: 'R-02',
        redactionMode: false,
        reviewChecks: reviewChecksFromDefaults(),
        metadataCleaned: false,
        activeOperatorId: DEFAULT_OPERATOR.id,
        drafts: [],
        nextWriteFails: false,
        notices: [],
        issueStatus: null,

        pushNotice: (tone, text) =>
          set((s) => ({ notices: [...s.notices, { id: noticeSeq++, tone, text }] })),
        dismissNotice: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),

        selectDocument: (id) =>
          set({ activeDocumentId: id, activePage: 1, activeRedactionId: null, redactionMode: false }),
        setPage: (page) => set({ activePage: page }),
        toggleRedactionMode: () => set((s) => ({ redactionMode: !s.redactionMode })),
        setOperator: (id) => set({ activeOperatorId: id }),
        selectRedaction: (id) => set({ activeRedactionId: id }),

        updateClassification: (classification) =>
          set((s) => ({
            documents: s.documents.map((d) =>
              d.id === s.activeDocumentId ? { ...d, classification } : d
            )
          })),

        addRedaction: (redaction) => {
          const s = get();
          const docId = s.activeDocumentId;
          const id = `R-${Date.now().toString(36).toUpperCase()}`;
          const withDraft: ReleaseState = {
            ...snapshotState(s),
            documents: s.documents.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    updatedAt: nowLabel(),
                    redactions: [...d.redactions, { ...redaction, id, status: 'draft' as const }]
                  }
                : d
            )
          };
          // 内容一变：推进修订并让未发布批次的相关结论失效
          const bumped = bumpRevision(withDraft, docId, `新增去密区域（${redaction.reason}），待确认`, nowLabel());
          patchRelease(bumped.state, { activeRedactionId: id }, bumped.invalidatedIds);
        },

        confirmRedaction: (id, expectedStatus) => {
          const s = get();
          const outcome = confirmRedactionDomain(
            snapshotState(s),
            s.activeDocumentId,
            id,
            activeOperator(s),
            nowLabel(),
            expectedStatus
          );
          if (outcome.ok) {
            set({
              documents: outcome.state.documents,
              conclusions: outcome.state.conclusions,
              batches: outcome.state.batches
            });
            get().pushNotice('success', `区域 ${id} 已确认，依据修订 r${outcome.redaction.basisRevision}（指纹 ${outcome.redaction.basisContentHash?.slice(0, 6)}）。`);
          } else if (outcome.reason === 'already-confirmed') {
            get().pushNotice(
              'danger',
              `区域 ${id} 已被先到的确认锁定` +
                (outcome.winner ? `：${outcome.winner.name}${outcome.at ? ` 于 ${outcome.at}` : ''} 先提交生效，本次提交未写入。` : '，本次提交未写入。')
            );
          }
        },

        toggleReviewCheck: (id) =>
          set((s) => ({ reviewChecks: { ...s.reviewChecks, [id]: !s.reviewChecks[id] } })),
        toggleMetadata: () => set((s) => ({ metadataCleaned: !s.metadataCleaned })),

        recordQuality: (documentId, verdict) => {
          const s = get();
          const checkInputs: QualityCheckInput[] = DEFAULT_CHECKS.map((c) => ({
            ...c,
            passed: Boolean(s.reviewChecks[c.id])
          }));
          const result = recordQualityConclusion(snapshotState(s), {
            documentId,
            reviewer: activeOperator(s),
            checks: checkInputs,
            metadataCleaned: s.metadataCleaned,
            verdict,
            at: nowLabel()
          });
          if (result.error || !result.conclusion) {
            get().pushNotice('danger', `无法记录质检结论：${result.error}`);
            return;
          }
          set({
            documents: result.state.documents,
            conclusions: result.state.conclusions,
            batches: result.state.batches
          });
          get().pushNotice(
            verdict === 'pass' ? 'success' : 'warning',
            verdict === 'pass'
              ? `${documentId} 复核通过，结论锚定 r${result.conclusion.revision}（指纹 ${result.conclusion.contentHash.slice(0, 6)}）。`
              : `${documentId} 已退回补件。`
          );
        },

        setBatchDocuments: (batchId, documentIds) =>
          set((s) => ({
            batches: s.batches.map((b) => (b.id === batchId ? { ...b, documentIds } : b))
          })),

        toggleNextWriteFailure: () => set((s) => ({ nextWriteFails: !s.nextWriteFails })),

        issueManifest: async (batchId) => {
          const s = get();
          const existingDraft = s.drafts.find((d) => d.manifest.manifestNo === batchId);
          if (existingDraft) {
            await doAppend(batchId, existingDraft.manifest, existingDraft.attempts + 1);
            return;
          }
          const built = buildManifest(snapshotState(s), batchId, activeOperator(s), nowLabel());
          if (!built.manifest) {
            set({ issueStatus: { batchId, state: 'failed', message: built.error ?? '门禁未通过' } });
            get().pushNotice('danger', `不能出清单：${built.error}`);
            return;
          }
          await doAppend(batchId, built.manifest, 1);
        },

        retryIssue: async (manifestNo) => {
          const draft = get().drafts.find((d) => d.manifest.manifestNo === manifestNo);
          if (!draft) return;
          await doAppend(draft.manifest.manifestNo, draft.manifest, draft.attempts + 1);
        },

        discardDraft: (manifestNo) => {
          set((s) => ({ drafts: s.drafts.filter((d) => d.manifest.manifestNo !== manifestNo), issueStatus: null }));
          get().pushNotice('info', '已放弃本地清单草稿。');
        },

        resetDemo: () => {
          const fresh = createDefaultState();
          set({
            ...fresh,
            activeDocumentId: fresh.documents[0].id,
            activePage: 1,
            activeRedactionId: 'R-02',
            redactionMode: false,
            reviewChecks: reviewChecksFromDefaults(),
            metadataCleaned: false,
            activeOperatorId: DEFAULT_OPERATOR.id,
            drafts: [],
            nextWriteFails: false,
            notices: [],
            issueStatus: null
          });
        }
      };
    },
    {
      name: 'yy59-disclosure-draft',
      version: 2,
      // 旧草稿（v1：只有 documents，且没有修订号）按当前内容补齐
      migrate: (persisted: unknown, version: number): PersistedShape => {
        const p = (persisted ?? {}) as Partial<PersistedShape>;
        const fresh = createDefaultState();
        const rawDocuments = p.documents?.length ? p.documents : fresh.documents;
        const normalized = normalizeState({
          documents: rawDocuments as DisclosureRecord[],
          conclusions: p.conclusions ?? (p.documents ? [] : fresh.conclusions),
          batches: p.batches ?? (p.documents ? legacyBatches(rawDocuments as DisclosureRecord[]) : fresh.batches),
          manifestRegister: p.manifestRegister ?? []
        });
        return {
          ...normalized,
          activeDocumentId: p.activeDocumentId ?? normalized.documents[0].id,
          activePage: p.activePage ?? 1,
          activeRedactionId: p.activeRedactionId ?? null,
          redactionMode: p.redactionMode ?? false,
          reviewChecks: p.reviewChecks ?? reviewChecksFromDefaults(),
          metadataCleaned: p.metadataCleaned ?? false,
          activeOperatorId: p.activeOperatorId ?? DEFAULT_OPERATOR.id,
          drafts: p.drafts ?? [],
          nextWriteFails: false
        };
      },
      // 双保险：即使版本号意外，rehydrate 时也对数据补齐修订号
      merge: (persisted, current) => {
        const merged = { ...(current as PersistedShape), ...((persisted as PersistedShape) ?? {}) };
        const normalized = normalizeState({
          documents: merged.documents,
          conclusions: merged.conclusions,
          batches: merged.batches,
          manifestRegister: merged.manifestRegister
        });
        return { ...current, ...merged, ...normalized } as unknown as State;
      },
      partialize: (s) => ({
        documents: s.documents,
        conclusions: s.conclusions,
        batches: s.batches,
        manifestRegister: s.manifestRegister,
        activeDocumentId: s.activeDocumentId,
        activePage: s.activePage,
        activeRedactionId: s.activeRedactionId,
        redactionMode: s.redactionMode,
        reviewChecks: s.reviewChecks,
        metadataCleaned: s.metadataCleaned,
        activeOperatorId: s.activeOperatorId,
        drafts: s.drafts,
        nextWriteFails: s.nextWriteFails
      })
    }
  )
);

/** 旧版用户没有批次数据时，按文档 bundle 归一个未发布批次 */
function legacyBatches(documents: DisclosureRecord[]) {
  const groups = new Map<string, string[]>();
  for (const doc of documents) {
    groups.set(doc.bundle, [...(groups.get(doc.bundle) ?? []), doc.id]);
  }
  return [...groups.entries()].map(([name, documentIds], index) => ({
    id: `BATCH-${String(index + 1).padStart(2, '0')}`,
    name: `${name} · 未发布`,
    documentIds
  }));
}

/* ------------------------- 选择器辅助 ------------------------- */

export function selectActiveConclusion(documentId: string): QualityConclusion | undefined {
  return activeConclusionFor(useDisclosureStore.getState().conclusions, documentId);
}

export function evaluateBatchById(batchId: string) {
  const s = useDisclosureStore.getState();
  return evaluateBatch(
    { documents: s.documents, conclusions: s.conclusions, batches: s.batches, manifestRegister: s.manifestRegister },
    batchId
  );
}

export {
  activeConclusionFor,
  canRecordConclusion,
  documentBaselineState,
  evaluateBatch,
  latestConclusionFor,
  manifestImpact
};
