import { contentHashOf, normalizeDocument, type QualityCheckInput } from './domain';
import type {
  DisclosureRecord,
  ManifestSnapshot,
  Operator,
  QualityConclusion,
  ReleaseBatch,
  ReleaseState
} from './types';

export const OPERATORS: Operator[] = [
  { id: 'U-LQ', name: '林清' },
  { id: 'U-ZX', name: '周叙' },
  { id: 'U-GY', name: '顾言' }
];

export const DEFAULT_OPERATOR = OPERATORS[0];

export function operatorByName(name: string): Operator {
  return OPERATORS.find((o) => o.name === name) ?? DEFAULT_OPERATOR;
}

export const DEFAULT_CHECKS: QualityCheckInput[] = [
  { id: 'forbidden-terms', label: '全文禁词与姓名复核', passed: true },
  { id: 'page-number', label: '页序与页码连续性', passed: true },
  { id: 'image-boundary', label: '图像边界残片', passed: true },
  { id: 'metadata', label: '文档元数据清理', passed: true }
];

function checksWith(passAll: boolean): QualityCheckInput[] {
  return DEFAULT_CHECKS.map((c) => ({ ...c, passed: passAll }));
}

/**
 * 种子状态故意覆盖基线的关键局面：
 *  - DOC-00418：修订 2（新增了草稿区域），旧的通过结论已失效，回到待复核；
 *  - DOC-00427：修订 1 结论有效；
 *  - DOC-00435：修订 2 结论有效，但第二批已发出的清单冻结在修订 1（内容漂移）；
 *  - 一份文档同时挂在多个批次（DOC-00435 属于第二批和第三批）。
 */
export function createDefaultState(): ReleaseState {
  const rawDocuments: DisclosureRecord[] = [
    {
      id: 'DOC-00418',
      title: '设备采购补充协议（第三版）',
      bundle: '北岭项目 · 第一批披露',
      pages: 3,
      classification: '严格机密',
      owner: '林清',
      updatedAt: '09:48',
      status: '待质检',
      issue: '合同主体与商业条款',
      size: '8.4 MB',
      revision: 2,
      contentHash: '',
      revisionHistory: [
        { revision: 1, contentHash: 'seed', at: '昨天 18:20', summary: '首批合同价款遮蔽区域确认' },
        { revision: 2, contentHash: 'seed', at: '09:48', summary: '追加个人手机号遮蔽区（R-02 尚为草稿）' }
      ],
      redactions: [
        { id: 'R-01', page: 1, x: 0.12, y: 0.16, width: 0.30, height: 0.04, reason: '商业秘密', privilege: '合同保密', status: 'confirmed', basisRevision: 1, confirmedBy: operatorByName('林清'), confirmedAt: '昨天 18:20' },
        { id: 'R-02', page: 1, x: 0.50, y: 0.43, width: 0.34, height: 0.06, reason: '个人手机号', privilege: '个人信息', status: 'draft' },
        { id: 'R-03', page: 2, x: 0.11, y: 0.25, width: 0.68, height: 0.05, reason: '第三方报价', privilege: '商业敏感', status: 'confirmed', basisRevision: 1, confirmedBy: operatorByName('林清'), confirmedAt: '昨天 18:20' }
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
      status: '可发布',
      issue: '事故预防与整改安排',
      size: '3.1 MB',
      revision: 1,
      contentHash: '',
      revisionHistory: [{ revision: 1, contentHash: 'seed', at: '09:31', summary: '内部调查意见遮蔽确认' }],
      redactions: [
        { id: 'R-04', page: 1, x: 0.08, y: 0.69, width: 0.74, height: 0.05, reason: '内部调查意见', privilege: '工作成果', status: 'confirmed', basisRevision: 1, confirmedBy: operatorByName('周叙'), confirmedAt: '09:31' }
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
      revision: 2,
      contentHash: '',
      revisionHistory: [
        { revision: 1, contentHash: 'seed', at: '08:12', summary: '人员姓名遮蔽确认（清单已按此修订发出）' },
        { revision: 2, contentHash: 'seed', at: '08:56', summary: '补齐第二页设备编号遮蔽' }
      ],
      redactions: [
        { id: 'R-05', page: 2, x: 0.44, y: 0.56, width: 0.26, height: 0.04, reason: '人员姓名', privilege: '个人信息', status: 'confirmed', basisRevision: 1, confirmedBy: operatorByName('顾言'), confirmedAt: '08:12' },
        { id: 'R-06', page: 2, x: 0.10, y: 0.30, width: 0.30, height: 0.04, reason: '设备编号', privilege: '商业敏感', status: 'confirmed', basisRevision: 2, confirmedBy: operatorByName('顾言'), confirmedAt: '08:56' }
      ]
    }
  ];

  const documents = rawDocuments.map(normalizeDocument);
  const docById = new Map(documents.map((d) => [d.id, d]));
  const at = (id: string) => docById.get(id)!;

  const conclusions: QualityConclusion[] = [
    {
      id: 'QC-DOC-00418-r1',
      documentId: 'DOC-00418',
      revision: 1,
      contentHash: 'r1-seed',
      reviewer: operatorByName('林清'),
      verdict: 'pass',
      checks: checksWith(true),
      metadataCleaned: true,
      status: 'invalidated',
      createdAt: '昨天 18:30',
      invalidatedAt: '09:48',
      invalidateReason: '新增个人手机号遮蔽区，去密内容已变化',
      impactedBatches: ['第一批披露 · 审阅中']
    },
    {
      id: 'QC-DOC-00427-r1',
      documentId: 'DOC-00427',
      revision: 1,
      contentHash: at('DOC-00427').contentHash,
      reviewer: operatorByName('周叙'),
      verdict: 'pass',
      checks: checksWith(true),
      metadataCleaned: true,
      status: 'active',
      createdAt: '09:31'
    },
    {
      id: 'QC-DOC-00435-r1',
      documentId: 'DOC-00435',
      revision: 1,
      contentHash: 'r1-seed',
      reviewer: operatorByName('顾言'),
      verdict: 'pass',
      checks: checksWith(true),
      metadataCleaned: true,
      status: 'superseded',
      createdAt: '08:15'
    },
    {
      id: 'QC-DOC-00435-r2',
      documentId: 'DOC-00435',
      revision: 2,
      contentHash: at('DOC-00435').contentHash,
      reviewer: operatorByName('顾言'),
      verdict: 'pass',
      checks: checksWith(true),
      metadataCleaned: true,
      status: 'active',
      createdAt: '08:58'
    }
  ];

  const issuedBatch2: ManifestSnapshot = {
    manifestNo: 'BATCH-02',
    batchName: '第二批披露 · 已发出',
    issuedAt: '08:54',
    issuedBy: operatorByName('顾言'),
    entries: [
      {
        documentId: 'DOC-00435',
        title: '设备运行数据摘录',
        revision: 1,
        contentHash: contentHashOf(
          at('DOC-00435').redactions.filter((r) => r.id === 'R-05').map((r) => ({ ...r, status: 'confirmed' }))
        ),
        redactionCount: 1,
        conclusionId: 'QC-DOC-00435-r1',
        reviewer: '顾言'
      }
    ]
  };

  const batches: ReleaseBatch[] = [
    { id: 'BATCH-01', name: '第一批披露 · 审阅中', documentIds: ['DOC-00418', 'DOC-00427'] },
    { id: 'BATCH-02', name: '第二批披露 · 已发出', documentIds: ['DOC-00435'], issuedManifest: issuedBatch2 },
    { id: 'BATCH-03', name: '专家材料 · 待补充', documentIds: ['DOC-00435'] }
  ];

  return {
    documents,
    conclusions,
    batches,
    manifestRegister: [{ ...issuedBatch2, appendedAt: '08:54' }]
  };
}
