/**
 * 发布基线领域模型
 *
 * 把三件以前互相独立的东西绑成同一条基线：
 *   去密区域（内容）  -> 文档修订号 revision + 内容指纹 contentHash
 *   发布批次          -> 成员文档 + 已发出清单的冻结快照
 *   质检结论          -> 锚定结论作出时的修订号/指纹
 */

export type Operator = {
  id: string;
  name: string;
};

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
  /** 确认该区域时所依据的文档修订号（确认时写入，草稿为空） */
  basisRevision?: number;
  /** 确认依据的内容指纹 */
  basisContentHash?: string;
  confirmedBy?: Operator;
  confirmedAt?: string;
};

export type RevisionHistoryEntry = {
  revision: number;
  contentHash: string;
  at: string;
  summary: string;
};

export type DocumentStatus = '去密中' | '待质检' | '可发布';

export type DisclosureRecord = {
  id: string;
  title: string;
  bundle: string;
  pages: number;
  classification: '内部' | '机密' | '严格机密';
  owner: string;
  updatedAt: string;
  status: DocumentStatus;
  issue: string;
  size: string;
  redactions: Redaction[];
  /** 当前修订号，区域内容一变就递增 */
  revision: number;
  /** 当前去密区域集合的内容指纹 */
  contentHash: string;
  revisionHistory: RevisionHistoryEntry[];
};

/** 质检结论：作出结论时锚定当时的修订号与指纹 */
export type QualityConclusion = {
  id: string;
  documentId: string;
  revision: number;
  contentHash: string;
  reviewer: Operator;
  verdict: 'pass' | 'reject';
  /** 当时逐项核对的结果快照 */
  checks: { id: string; label: string; passed: boolean }[];
  metadataCleaned: boolean;
  status: 'active' | 'invalidated' | 'superseded';
  createdAt: string;
  invalidatedAt?: string;
  invalidateReason?: string;
  /** 失效时受影响的未发布批次名称（审计用） */
  impactedBatches?: string[];
};

export type ManifestEntry = {
  documentId: string;
  title: string;
  revision: number;
  contentHash: string;
  redactionCount: number;
  conclusionId: string;
  reviewer: string;
};

/** 已发出的发布清单：不可变快照 */
export type ManifestSnapshot = {
  manifestNo: string;
  batchName: string;
  issuedAt: string;
  issuedBy: Operator;
  entries: ManifestEntry[];
};

/** 写入失败后保留在本机的清单草稿，重试时原样追加 */
export type ManifestDraft = {
  manifest: ManifestSnapshot;
  attempts: number;
  lastError?: string;
  savedAt: string;
};

export type ManifestRegisterEntry = ManifestSnapshot & {
  appendedAt: string;
};

export type ReleaseBatch = {
  id: string;
  name: string;
  documentIds: string[];
  /** 一旦发出清单即冻结，永不再写 */
  issuedManifest?: ManifestSnapshot;
};

export type ReleaseState = {
  documents: DisclosureRecord[];
  conclusions: QualityConclusion[];
  batches: ReleaseBatch[];
  /** 追加式清单登记册 */
  manifestRegister: ManifestRegisterEntry[];
};
