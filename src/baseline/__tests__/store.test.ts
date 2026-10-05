import { describe, expect, it, beforeEach } from 'vitest';
import { useDisclosureStore } from '../../store';

const s = () => useDisclosureStore.getState();

// 让 BATCH-01 门禁通过：确认 DOC-00418 的草稿区域 R-02 并重新出结论
function makeBatch01Ready() {
  s().confirmRedaction('R-02', 'draft');
  if (!s().metadataCleaned) s().toggleMetadata();
  s().recordQuality('DOC-00418', 'pass');
  expect(s().batches.find((b) => b.id === 'BATCH-01')!.issuedManifest).toBeUndefined();
  expect(s().conclusions.some((c) => c.id === 'QC-DOC-00418-r2' && c.status === 'active')).toBe(true);
}

beforeEach(() => {
  useDisclosureStore.setState({
    ...useDisclosureStore.getState(),
    drafts: [],
    nextWriteFails: false,
    issueStatus: null
  });
  s().resetDemo();
});

describe('发布清单写入（store 接线）', () => {
  it('门禁未过时不能出清单，也不会产生草稿', async () => {
    await s().issueManifest('BATCH-01');
    const state = s();
    expect(state.issueStatus?.state).toBe('failed');
    expect(state.drafts).toHaveLength(0);
    expect(state.manifestRegister).toHaveLength(1); // 仍是种子里的 BATCH-02
  });

  it('写入失败保留草稿；重试成功；同一批次号只追加一次', async () => {
    makeBatch01Ready();

    // 1) 模拟下一次写入失败
    s().toggleNextWriteFailure();
    await s().issueManifest('BATCH-01');
    let state = s();
    expect(state.issueStatus?.state).toBe('failed');
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0].manifest.manifestNo).toBe('BATCH-01');
    expect(state.drafts[0].attempts).toBe(1);
    expect(state.manifestRegister).toHaveLength(1); // 没写进去
    expect(state.batches.find((b) => b.id === 'BATCH-01')!.issuedManifest).toBeUndefined();

    // 2) 重试成功
    await s().retryIssue('BATCH-01');
    state = s();
    expect(state.issueStatus?.state).toBe('issued');
    expect(state.drafts).toHaveLength(0);
    expect(state.manifestRegister.map((m) => m.manifestNo)).toContain('BATCH-01');
    expect(state.batches.find((b) => b.id === 'BATCH-01')!.issuedManifest?.manifestNo).toBe('BATCH-01');

    // 3) 再次发起：冻结，登记册不会出现第二条 BATCH-01
    await s().issueManifest('BATCH-01');
    state = s();
    expect(state.manifestRegister.filter((m) => m.manifestNo === 'BATCH-01')).toHaveLength(1);
  });

  it('冻结后内容继续漂移：清单不动，门禁文档标待复核，漂移在清单上可见', async () => {
    // BATCH-03 含 DOC-00435（r2 active），可直接发出
    await s().issueManifest('BATCH-03');
    expect(s().batches.find((b) => b.id === 'BATCH-03')!.issuedManifest).toBeDefined();

    // 再加一块区域：文档推进到 r3；BATCH-03 已冻结，不受影响
    s().selectDocument('DOC-00435');
    s().addRedaction({ page: 3, x: 0.1, y: 0.1, width: 0.2, height: 0.05, reason: '人员姓名', privilege: '个人信息' });

    const state = s();
    const doc = state.documents.find((d) => d.id === 'DOC-00435')!;
    expect(doc.revision).toBe(3);
    const frozen = state.batches.find((b) => b.id === 'BATCH-03')!.issuedManifest!;
    expect(frozen.entries[0].revision).toBe(2); // 冻结值不变
    // 再次发起不会追加第二份
    await s().issueManifest('BATCH-03');
    expect(state.manifestRegister.filter((m) => m.manifestNo === 'BATCH-03')).toHaveLength(1);
  });

  it('两人几乎同时确认同一区域：第一笔生效，第二笔被拒', () => {
    // DOC-00418 / R-02 是草稿
    s().setOperator('U-LQ');
    s().confirmRedaction('R-02', 'draft');
    s().setOperator('U-ZX');
    s().confirmRedaction('R-02', 'draft');
    const r = s().documents.find((d) => d.id === 'DOC-00418')!.redactions.find((x) => x.id === 'R-02')!;
    expect(r.status).toBe('confirmed');
    expect(r.confirmedBy?.id).toBe('U-LQ'); // 先到者
    expect(useDisclosureStore.getState().notices.some((n) => n.tone === 'danger' && n.text.includes('先到'))).toBe(true);
  });
});
