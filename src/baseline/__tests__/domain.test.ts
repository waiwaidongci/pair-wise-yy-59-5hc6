import { describe, expect, it } from 'vitest';
import {
  activeConclusionFor,
  appendManifest,
  bumpRevision,
  buildManifest,
  canRecordConclusion,
  confirmRedaction,
  contentHashOf,
  evaluateBatch,
  manifestImpact,
  normalizeDocument,
  normalizeState,
  recordQualityConclusion
} from '../domain';
import { createDefaultState, DEFAULT_CHECKS } from '../seed';
import type { DisclosureRecord, Operator, Redaction, ReleaseState } from '../types';

const lin: Operator = { id: 'U-LQ', name: '林清' };
const zhou: Operator = { id: 'U-ZX', name: '周叙' };

function region(over: Partial<Redaction> = {}): Redaction {
  return {
    id: 'R-T',
    page: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.05,
    reason: '商业秘密',
    privilege: '合同保密',
    status: 'draft',
    ...over
  };
}

function doc(over: Partial<DisclosureRecord> = {}): DisclosureRecord {
  const redactions = over.redactions ?? [region({ status: 'confirmed' })];
  return normalizeDocument({
    id: 'DOC-T',
    title: '测试文档',
    bundle: '批次',
    pages: 1,
    classification: '内部',
    owner: '林清',
    updatedAt: '10:00',
    status: '去密中',
    issue: '',
    size: '1 MB',
    redactions,
    revision: over.revision ?? 1,
    contentHash: over.contentHash ?? contentHashOf(redactions),
    revisionHistory: over.revisionHistory ?? []
  });
}

function stateWith(over: Partial<ReleaseState> = {}): ReleaseState {
  return { ...createDefaultState(), ...over };
}

const passChecks = DEFAULT_CHECKS.map((c) => ({ ...c, passed: true }));

/* ---------- 内容指纹与旧草稿迁移 ---------- */

describe('内容指纹', () => {
  it('区域几何或理由变化会改变指纹；草稿→确认不改变指纹', () => {
    const draft = region();
    const confirmed = { ...draft, status: 'confirmed' as const };
    expect(contentHashOf([draft])).toBe(contentHashOf([confirmed]));
    expect(contentHashOf([{ ...draft, width: 0.5 }])).not.toBe(contentHashOf([draft]));
    expect(contentHashOf([{ ...draft, reason: '其他理由' }])).not.toBe(contentHashOf([draft]));
  });
});

describe('旧草稿补齐修订号', () => {
  it('文档缺 revision/contentHash 时按当前内容补齐，已确认区域补上依据修订', () => {
    const legacy = doc({ revision: undefined as never, contentHash: undefined as never, revisionHistory: [] });
    const migrated = normalizeDocument(legacy);
    expect(migrated.revision).toBe(1);
    expect(migrated.contentHash).toBe(contentHashOf(migrated.redactions));
    expect(migrated.redactions[0].basisRevision).toBe(1);
    expect(migrated.redactions[0].basisContentHash).toBe(migrated.contentHash);
    expect(migrated.revisionHistory).toHaveLength(1);
  });

  it('草稿区域不补依据修订', () => {
    const migrated = normalizeDocument(doc({ redactions: [region({ status: 'draft' })], revisionHistory: [] }));
    expect(migrated.redactions[0].basisRevision).toBeUndefined();
  });

  it('normalizeState 为缺指纹的旧结论按当前内容补齐', () => {
    const d = doc();
    const state = normalizeState({
      documents: [d],
      conclusions: [
        {
          id: 'QC-OLD', documentId: d.id, revision: 1, contentHash: '',
          reviewer: lin, verdict: 'pass', checks: [], metadataCleaned: true,
          status: 'active', createdAt: '09:00'
        }
      ],
      batches: [],
      manifestRegister: []
    });
    expect(state.conclusions[0].contentHash).toBe(d.contentHash);
  });
});

/* ---------- 确认依据与先到先得 ---------- */

describe('确认去密区域', () => {
  it('确认时记下依据的修订号、内容指纹和操作者', () => {
    const d = doc({ redactions: [region({ status: 'draft' })] });
    const state = stateWith({ documents: [d], conclusions: [], batches: [] });
    const result = confirmRedaction(state, d.id, 'R-T', lin, '10:01', 'draft');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = result.state.documents[0].redactions[0];
    expect(saved.status).toBe('confirmed');
    expect(saved.basisRevision).toBe(1);
    expect(saved.basisContentHash).toBe(d.contentHash);
    expect(saved.confirmedBy).toEqual(lin);
  });

  it('两人同时确认同一区域：先到者生效，后到者拿到 already-confirmed 且看到赢家', () => {
    const d = doc({ redactions: [region({ status: 'draft' })] });
    let state = stateWith({ documents: [d], conclusions: [], batches: [] });
    const first = confirmRedaction(state, d.id, 'R-T', lin, '10:01:00', 'draft');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    // 第二人几乎同时提交（都基于按下时看到的 draft 状态）
    const second = confirmRedaction(state, d.id, 'R-T', zhou, '10:01:01', 'draft');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('already-confirmed');
    expect(second.winner).toEqual(lin);
    // 状态里仍是先到者，后到者没有覆盖
    const saved = state.documents[0].redactions[0];
    expect(saved.confirmedBy).toEqual(lin);
  });
});

/* ---------- 内容一变：修订推进、结论失效、回到待复核 ---------- */

describe('修订推进与结论失效', () => {
  it('新增区域：修订 +1，未发布批次的通过结论失效并记录受影响批次', () => {
    const base = createDefaultState();
    // DOC-00427 在未发布的 BATCH-01，当前有 r1 有效结论
    const target = base.documents.find((d) => d.id === 'DOC-00427')!;
    const changed: ReleaseState = {
      ...base,
      documents: base.documents.map((d) =>
        d.id === target.id ? { ...d, redactions: [...d.redactions, region({ id: 'R-NEW', status: 'draft' })] } : d
      )
    };
    const result = bumpRevision(changed, target.id, '新增遮蔽区', '10:20');
    expect(result.invalidatedIds).toContain('QC-DOC-00427-r1');
    const updated = result.state.documents.find((d) => d.id === target.id)!;
    expect(updated.revision).toBe(2);
    expect(updated.status).toBe('待质检');
    const conclusion = result.state.conclusions.find((c) => c.id === 'QC-DOC-00427-r1')!;
    expect(conclusion.status).toBe('invalidated');
    expect(conclusion.impactedBatches).toContain('第一批披露 · 审阅中');
  });

  it('内容无变化时不推进修订、不失效结论', () => {
    const base = createDefaultState();
    const result = bumpRevision(base, 'DOC-00427', '空操作', '10:20');
    expect(result.invalidatedIds).toEqual([]);
    expect(result.state).toBe(base);
  });

  it('已冻结批次不受失效影响，但漂移可由 manifestImpact 标出', () => {
    const base = createDefaultState();
    // DOC-00435 已在 r2，BATCH-02 清单冻结在 r1
    const frozen = base.batches.find((b) => b.id === 'BATCH-02')!;
    expect(frozen.issuedManifest).toBeDefined();
    const impacts = manifestImpact(base, frozen.issuedManifest!);
    expect(impacts[0].kind).toBe('frozen-drifted');
    if (impacts[0].kind !== 'frozen-drifted') return;
    expect(impacts[0].doc.revision).toBe(2);
    expect(impacts[0].entry.revision).toBe(1);
  });
});

/* ---------- 质检结论与发布门禁 ---------- */

describe('质检结论', () => {
  it('有草稿区域时不能记录通过结论', () => {
    const d = doc({ redactions: [region({ status: 'draft' })] });
    expect(canRecordConclusion(d).ok).toBe(false);
  });

  it('记录结论时锚定当前修订；同修订再确认会取代旧结论', () => {
    const base = createDefaultState();
    const target = base.documents.find((d) => d.id === 'DOC-00427')!;
    const r1 = recordQualityConclusion(base, {
      documentId: target.id, reviewer: lin, checks: passChecks, metadataCleaned: true, verdict: 'pass', at: '10:30'
    });
    expect(r1.conclusion?.revision).toBe(1);
    const r2 = recordQualityConclusion(r1.state, {
      documentId: target.id, reviewer: zhou, checks: passChecks, metadataCleaned: true, verdict: 'pass', at: '10:31'
    });
    const active = activeConclusionFor(r2.state.conclusions, target.id);
    expect(active?.reviewer).toEqual(zhou);
    // 同文档同修订只保留一条 active，旧的那条被取代
    const actives = r2.state.conclusions.filter((c) => c.documentId === target.id && c.status === 'active');
    expect(actives).toHaveLength(1);
    const superseded = r2.state.conclusions.filter((c) => c.documentId === target.id && c.status === 'superseded');
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it('校验项未全过或元数据未清理时不能通过', () => {
    const base = createDefaultState();
    const failed = recordQualityConclusion(base, {
      documentId: 'DOC-00427', reviewer: lin,
      checks: passChecks.map((c, i) => (i === 0 ? { ...c, passed: false } : c)),
      metadataCleaned: true, verdict: 'pass', at: '10:30'
    });
    expect(failed.error).toMatch(/未通过/);
    const noMeta = recordQualityConclusion(base, {
      documentId: 'DOC-00427', reviewer: lin, checks: passChecks, metadataCleaned: false, verdict: 'pass', at: '10:30'
    });
    expect(noMeta.error).toMatch(/元数据/);
  });
});

describe('发布门禁', () => {
  it('BATCH-01：DOC-00418 旧结论已失效、当前无 active 结论，门禁阻断', () => {
    const base = createDefaultState();
    const ev = evaluateBatch(base, 'BATCH-01');
    expect(ev.ready).toBe(false);
    const block418 = ev.blocks.find((b) => b.documentId === 'DOC-00418');
    expect(block418?.kind).toBe('no-conclusion');
  });

  it('active 结论锚定旧修订时判定为 stale-conclusion（防御绕过失效流程的漂移）', () => {
    const base = createDefaultState();
    // 绕过 bumpRevision 直接构造"文档到了 r2、但 active 结论还停在 r1"的漂移态
    const drifted: ReleaseState = {
      ...base,
      documents: base.documents.map((d) =>
        d.id === 'DOC-00427'
          ? {
              ...d,
              revision: 2,
              contentHash: contentHashOf([...d.redactions, region({ id: 'R-X', status: 'confirmed' })]),
              redactions: [...d.redactions, region({ id: 'R-X', status: 'confirmed' })]
            }
          : d
      )
    };
    const ev = evaluateBatch(drifted, 'BATCH-01');
    const block427 = ev.blocks.find((b) => b.documentId === 'DOC-00427');
    expect(block427?.kind).toBe('stale-conclusion');
    if (block427?.kind !== 'stale-conclusion') return;
    expect(block427.conclusionRevision).toBe(1);
    expect(block427.currentRevision).toBe(2);
  });

  it('重新按 r2 确认后门禁通过，且生成的清单条目带新修订与结论 ID', () => {
    let base = createDefaultState();
    const targetId = 'DOC-00418';
    // 确认草稿区域 R-02
    const confirmed = confirmRedaction(base, targetId, 'R-02', lin, '10:40', 'draft');
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    base = confirmed.state;
    const recorded = recordQualityConclusion(base, {
      documentId: targetId, reviewer: lin, checks: passChecks, metadataCleaned: true, verdict: 'pass', at: '10:41'
    });
    base = recorded.state;
    const ev = evaluateBatch(base, 'BATCH-01');
    expect(ev.ready).toBe(true);
    const entry = ev.entries.find((e) => e.documentId === targetId)!;
    expect(entry.revision).toBe(2);
    expect(entry.conclusionId).toBe('QC-DOC-00418-r2');

    const built = buildManifest(base, 'BATCH-01', lin, '10:42');
    expect(built.manifest?.entries).toHaveLength(2);
    expect(built.manifest?.manifestNo).toBe('BATCH-01');
  });

  it('已发出清单的批次不能再次出清单（冻结）', () => {
    const base = createDefaultState();
    const built = buildManifest(base, 'BATCH-02', lin, '10:42');
    expect(built.error).toMatch(/冻结/);
  });

  it('没重新确认的批次不能出清单', () => {
    const base = createDefaultState();
    expect(buildManifest(base, 'BATCH-01', lin, '10:42').error).toMatch(/重新确认|门禁/);
  });
});

/* ---------- 追加登记册：失败保留草稿、重试、同号一次 ---------- */

describe('追加式登记册', () => {
  it('写入失败不改登记册；重试成功后追加一次', () => {
    const base = createDefaultState();
    const register = base.manifestRegister;
    const failing = appendManifest(register, { manifest: makeManifest('BATCH-09'), at: '11:00', fail: true });
    expect(failing.ok).toBe(false);
    if (failing.ok) return;
    expect(register).toHaveLength(1); // 未写入
    const ok = appendManifest(register, { manifest: makeManifest('BATCH-09'), at: '11:01' });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.appended).toBe(true);
    expect(ok.register).toHaveLength(2);
  });

  it('同一批次号只追加一次：再次追加返回既有记录且不重复', () => {
    const base = createDefaultState();
    const first = appendManifest(base.manifestRegister, { manifest: makeManifest('BATCH-02'), at: '11:00' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.appended).toBe(false); // BATCH-02 已在登记册
    expect(first.entry?.appendedAt).toBe('08:54');
    expect(first.register).toBe(base.manifestRegister);
  });
});

function makeManifest(manifestNo: string) {
  return {
    manifestNo,
    batchName: manifestNo,
    issuedAt: '11:00',
    issuedBy: lin,
    entries: []
  };
}
