import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
  useParams
} from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Eye,
  FileCheck2,
  FileLock2,
  FileText,
  Highlighter,
  History,
  Layers3,
  Menu,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  Snowflake,
  Stamp,
  Tags,
  Trash2,
  UploadCloud,
  Users
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Badge, Button, Card, Dialog, Tabs, X } from './components/ui';
import { NoticeStack } from './components/NoticeStack';
import {
  activeConclusionFor,
  canRecordConclusion,
  documentBaselineState,
  evaluateBatch,
  latestConclusionFor,
  manifestImpact,
  useDisclosureStore
} from './store';
import { DEFAULT_CHECKS, OPERATORS } from './baseline/seed';
import type { DisclosureRecord, Operator } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const bundleQuery = async () => ({
  queue: [
    { id: 'Q-31', name: '第三批补充材料', count: 128, owner: '林清', progress: 68, due: '今日 16:00' },
    { id: 'Q-32', name: '证人材料图像件', count: 47, owner: '周叙', progress: 34, due: '明日 11:00' },
    { id: 'Q-33', name: '专家报告附件', count: 19, owner: '顾言', progress: 91, due: '09-30 18:00' }
  ]
});

/* ----------------------------- 小组件 ----------------------------- */

function RevisionTag({ doc, tone }: { doc: DisclosureRecord; tone?: 'blue' | 'amber' }) {
  return (
    <span className={`revision-tag ${tone ?? 'blue'}`} title={`当前内容指纹 ${doc.contentHash}`}>
      <History size={10} /> r{doc.revision} · {doc.contentHash.slice(0, 6)}
    </span>
  );
}

function DocStatusBadge({ doc }: { doc: DisclosureRecord }) {
  const conclusions = useDisclosureStore((s) => s.conclusions);
  const state = documentBaselineState(doc, conclusions);
  if (state === 'releasable') return <Badge tone="green">可发布</Badge>;
  if (state === 'recheck') return <Badge tone="red">结论失效 · 待复核</Badge>;
  if (state === 'await-qc') return <Badge tone="amber">待质检</Badge>;
  return <Badge tone="blue">去密中</Badge>;
}

function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);
  const conclusions = useDisclosureStore((s) => s.conclusions);
  const documents = useDisclosureStore((s) => s.documents);
  const recheck = documents.filter((d) => documentBaselineState(d, conclusions) === 'recheck').length;
  const drafts = useDisclosureStore((s) => s.drafts.length);
  const links = [
    { to: '/', label: '文档集', icon: Layers3 },
    { to: '/review/$documentId', label: '去密审阅', icon: Highlighter },
    { to: '/quality', label: '发布质检', icon: ScanSearch },
    { to: '/batches', label: '发布基线', icon: Tags }
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Stamp size={18} /></div>
          <div><strong>披露质控台</strong><span>North Ridge / Litigation Support</span></div>
        </div>
        <div className="top-actions">
          {recheck > 0 && <Badge tone="red">{recheck} 份文档结论已失效 · 待重新确认</Badge>}
          {drafts > 0 && <Badge tone="amber">{drafts} 份清单草稿待重试写入</Badge>}
          <OperatorSwitch />
        </div>
        <button className="mobile-menu" onClick={() => setMobileNav(!mobileNav)} aria-label="菜单"><Menu /></button>
      </header>
      <div className="shell-body">
        <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
          <div className="workspace-title">
            <span>当前工作区</span>
            <strong>北岭项目 · 诉讼披露</strong>
          </div>
          <nav>
            {links.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to as '/'}
                params={to.includes('$') ? { documentId: useDisclosureStore.getState().activeDocumentId } : undefined}
                activeProps={{ className: 'active' }}
                onClick={() => setMobileNav(false)}
              >
                <Icon size={17} /> <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div><ShieldCheck size={16} /><span>修订与结论基线已锁定</span></div>
            <small>清单追加登记册只增不改</small>
          </div>
        </aside>
        <main className="main-content">
          <Outlet />
          <NoticeStack />
        </main>
      </div>
    </div>
  );
}

function OperatorSwitch() {
  const activeOperatorId = useDisclosureStore((s) => s.activeOperatorId);
  const setOperator = useDisclosureStore((s) => s.setOperator);
  return (
    <label className="operator-switch" title="切换操作者，用于演示两人同时确认同一区域的先到先得">
      <Users size={14} />
      <select value={activeOperatorId} onChange={(e) => setOperator(e.target.value)}>
        {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

/* ---------------------------- 文档集页 ---------------------------- */

function DocumentsPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const conclusions = useDisclosureStore((state) => state.conclusions);
  const resetDemo = useDisclosureStore((s) => s.resetDemo);
  const { data } = useQuery({ queryKey: ['document-queues'], queryFn: bundleQuery });
  const [filter, setFilter] = useState('全部');
  const visible = filter === '全部'
    ? documents
    : documents.filter((doc) => {
        if (filter === '待复核') {
          return documentBaselineState(doc, conclusions) === 'recheck';
        }
        return doc.status === filter;
      });
  const invalidatedCount = conclusions.filter((c) => c.status === 'invalidated').length;
  const issuedCount = useDisclosureStore((s) => s.manifestRegister.length);
  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <small>DISCLOSURE CONTROL / DOCUMENT SET</small>
          <h1>披露文档集</h1>
          <p>每份文档以修订号 + 内容指纹入基线；区域一变，未发布批次的结论立即失效。</p>
        </div>
        <div className="heading-actions">
          <Button variant="outline" onClick={resetDemo}><RefreshCw size={15} /> 重置演示数据</Button>
          <Button><UploadCloud size={16} /> 导入文档集</Button>
        </div>
      </header>
      <section className="summary-strip">
        <div><span>文档总数</span><strong>{documents.length}</strong><small>基线纳管 100%</small></div>
        <div><span>当前修订</span><strong>{documents.reduce((n, d) => n + d.revision, 0)}</strong><small>全部区域均有指纹</small></div>
        <div><span>失效结论</span><strong className="warning-text">{invalidatedCount}</strong><small>须按新修订重新确认</small></div>
        <div><span>已冻结清单</span><strong>{issuedCount}</strong><small>追加登记，不再改写</small></div>
      </section>
      <div className="two-column">
        <Card className="document-table-card">
          <div className="card-heading">
            <div>
              <Tabs.Root value={filter} onValueChange={setFilter}>
                <Tabs.List className="segmented">
                  {['全部', '去密中', '待质检', '可发布', '待复核'].map((item) => <Tabs.Trigger key={item} value={item}>{item}</Tabs.Trigger>)}
                </Tabs.List>
              </Tabs.Root>
            </div>
            <span>{visible.length} 份文档</span>
          </div>
          <div className="document-table">
            {visible.map((doc) => {
              const drifted = documentBaselineState(doc, conclusions) === 'recheck';
              return (
                <div className="document-row" key={doc.id}>
                  <div className="file-icon"><FileText size={19} /></div>
                  <div className="doc-main">
                    <strong>{doc.title}</strong>
                    <span>{doc.id} · {doc.bundle} · {doc.size}</span>
                    <RevisionTag doc={doc} tone={drifted ? 'amber' : 'blue'} />
                  </div>
                  <div className="doc-field"><span>密级</span><Badge tone={doc.classification === '严格机密' ? 'red' : doc.classification === '机密' ? 'amber' : 'neutral'}>{doc.classification}</Badge></div>
                  <div className="doc-field"><span>负责人员</span><strong>{doc.owner}</strong></div>
                  <div className="doc-field"><span>基线状态</span><DocStatusBadge doc={doc} /></div>
                  <div className="doc-actions">
                    <Link to="/review/$documentId" params={{ documentId: doc.id }}><Button variant="outline">审阅</Button></Link>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <aside className="side-stack">
          <Card className="queue-card">
            <div className="card-title"><ClipboardCheck size={17} /><strong>去密任务队列</strong></div>
            {(data?.queue ?? []).map((item) => (
              <div className="queue-item" key={item.id}>
                <div><strong>{item.name}</strong><span>{item.count} 份 · {item.owner}</span></div>
                <div className="progress"><i style={{ width: `${item.progress}%` }} /></div>
                <small>{item.progress}% · 截止 {item.due}</small>
              </div>
            ))}
          </Card>
          <Card className="audit-card">
            <div className="card-title"><ShieldCheck size={17} /><strong>基线审计要点</strong></div>
            <p><b>确认</b>区域时写入当时修订号与指纹作为依据。</p>
            <p><b>变更</b>区域内容即推进修订，未发布批次结论失效、回到待复核。</p>
            <p><b>冻结</b>已发出清单永不重写，只标出当前内容漂移影响。</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

/* ---------------------------- PDF 渲染 ---------------------------- */

function useDemoPdf() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let alive = true;
    PDFDocument.create().then(async (pdf) => {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let pageNo = 1; pageNo <= 3; pageNo += 1) {
        const page = pdf.addPage([612, 792]);
        page.drawText('NORTH RIDGE PROJECT - DISCLOSURE EXHIBIT', { x: 54, y: 728, size: 14, font, color: rgb(0.12, 0.16, 0.2) });
        page.drawText(`Document page ${pageNo} / 3`, { x: 54, y: 704, size: 10, font, color: rgb(0.35, 0.39, 0.43) });
        page.drawLine({ start: { x: 54, y: 690 }, end: { x: 558, y: 690 }, thickness: 1, color: rgb(0.75, 0.78, 0.8) });
        const lines = [
          'Commercial terms and operational records',
          'Parties: North Ridge Equipment Co. and Haiyang Logistics',
          'Reference No. NR-2026-0819 / Confidentiality class: strictly confidential',
          '',
          'The supplier shall provide maintenance records, operating data and',
          'incident reports within ten business days after each quarterly review.',
          '',
          'Contact: [redacted personal information]',
          'Commercial consideration: [redacted third-party quotation]',
          '',
          'This copy is prepared solely for disclosure review. Every marked region',
          'must be confirmed against the original before approval and release.'
        ];
        lines.forEach((line, index) => page.drawText(line, { x: 54, y: 655 - index * 24, size: 10, font, color: rgb(0.1, 0.13, 0.16) }));
        page.drawText(`Control stamp: REVIEW-${String(pageNo).padStart(2, '0')}`, { x: 54, y: 72, size: 9, font, color: rgb(0.5, 0.53, 0.56) });
      }
      return pdf.save();
    }).then((data) => {
      if (alive) {
        const copy = new Uint8Array(data);
        setBytes(copy.buffer as ArrayBuffer);
      }
    });
    return () => { alive = false; };
  }, []);
  return bytes;
}

function PdfPage({ pageNumber, redacted = false, onDraw }: { pageNumber: number; redacted?: boolean; onDraw?: (region: { x: number; y: number; width: number; height: number }) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bytes = useDemoPdf();
  const [drawing, setDrawing] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const start = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (!bytes || !canvasRef.current) return;
    let task: ReturnType<typeof pdfjs.getDocument> | null = null;
    const render = async () => {
      task = pdfjs.getDocument({ data: bytes.slice(0) });
      const pdf = await task.promise;
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = canvasRef.current!;
      const ratio = window.devicePixelRatio || 1;
      canvas.width = viewport.width * ratio;
      canvas.height = viewport.height * ratio;
      canvas.style.width = '100%';
      canvas.style.aspectRatio = `${viewport.width}/${viewport.height}`;
      const context = canvas.getContext('2d')!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
    };
    render().catch(console.error);
    return () => { task?.destroy(); };
  }, [bytes, pageNumber]);

  const pointerDown = (event: React.PointerEvent) => {
    if (!onDraw) return;
    const rect = event.currentTarget.getBoundingClientRect();
    start.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    setDrawing({ x: start.current.x / rect.width, y: start.current.y / rect.height, width: 0, height: 0 });
  };
  const pointerMove = (event: React.PointerEvent) => {
    if (!drawing || !onDraw) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(start.current.x, event.clientX - rect.left) / rect.width;
    const y = Math.min(start.current.y, event.clientY - rect.top) / rect.height;
    const width = Math.abs(event.clientX - rect.left - start.current.x) / rect.width;
    const height = Math.abs(event.clientY - rect.top - start.current.y) / rect.height;
    setDrawing({ x, y, width, height });
  };
  const pointerUp = () => {
    if (drawing && onDraw && drawing.width > 0.015 && drawing.height > 0.01) onDraw(drawing);
    setDrawing(null);
  };
  return (
    <div className={`pdf-page ${onDraw ? 'drawable' : ''}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}>
      <canvas ref={canvasRef} />
      {redacted && <div className="page-redaction-demo"><span>已发布区域掩码</span></div>}
      {drawing && <i className="drawing-region" style={{ left: `${drawing.x * 100}%`, top: `${drawing.y * 100}%`, width: `${drawing.width * 100}%`, height: `${drawing.height * 100}%` }} />}
    </div>
  );
}

/* ---------------------------- 去密审阅页 ---------------------------- */

function ReviewPage() {
  const { documentId } = useParams({ from: '/review/$documentId' });
  const navigate = useNavigate();
  const documents = useDisclosureStore((s) => s.documents);
  const activePage = useDisclosureStore((s) => s.activePage);
  const redactionMode = useDisclosureStore((s) => s.redactionMode);
  const activeRedactionId = useDisclosureStore((s) => s.activeRedactionId);
  const store = useDisclosureStore();
  const doc = documents.find((item) => item.id === documentId) ?? documents[0];
  const pageRegions = doc.redactions.filter((item) => item.page === activePage);
  const active = doc.redactions.find((item) => item.id === activeRedactionId);
  const conclusion = activeConclusionFor(store.conclusions, doc.id);
  const drifted = documentBaselineState(doc, store.conclusions) === 'recheck';
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('商业秘密');
  const [privilege, setPrivilege] = useState('合同保密');
  const gate = canRecordConclusion(doc);

  const submitQuality = () => {
    if (!gate.ok) {
      store.pushNotice('danger', `暂不能提交质检：${gate.reason}`);
      return;
    }
    store.recordQuality(doc.id, 'pass');
    navigate({ to: '/quality' });
  };

  return (
    <div className="page review-page">
      <header className="review-header">
        <div className="review-title">
          <Button variant="ghost" onClick={() => navigate({ to: '/' })}><ArrowLeft size={16} /></Button>
          <div>
            <small>{doc.id} / 去密审阅 · <RevisionTag doc={doc} tone={drifted ? 'amber' : 'blue'} /></small>
            <h1>{doc.title}</h1>
          </div>
          <Badge tone={doc.classification === '严格机密' ? 'red' : 'amber'}>{doc.classification}</Badge>
          {drifted && <Badge tone="red">旧结论已失效 · 待复核</Badge>}
        </div>
        <div className="review-actions">
          <Button variant="outline" onClick={() => store.toggleRedactionMode()} className={redactionMode ? 'active-button' : ''}>
            <Highlighter size={16} /> {redactionMode ? '取消绘制' : '绘制去密区'}
          </Button>
          <Button variant="outline" onClick={() => setDialogOpen(true)}><FileCheck2 size={16} /> 发布前校验</Button>
          <Button onClick={submitQuality} disabled={!gate.ok}><Check size={16} /> 提交质检</Button>
        </div>
      </header>
      {drifted && (
        <div className="baseline-banner danger">
          <AlertTriangle size={15} />
          <span>
            {conclusion
              ? <>去密内容在结论作出后发生变化（结论依据 r{conclusion.revision}，当前 r{doc.revision}）。</>
              : <>依据 r{latestConclusionFor(store.conclusions, doc.id)?.revision} 的质检结论已失效。</>}
            未发布批次的结论已回到待复核；请确认新增区域后重新出具质检结论。
          </span>
        </div>
      )}
      <div className="review-layout">
        <aside className="page-thumbs">
          <div className="side-label">页级预览 <span>{doc.pages} 页</span></div>
          {[1, 2, 3].map((page) => (
            <button key={page} className={activePage === page ? 'active' : ''} onClick={() => store.setPage(page)}>
              <div className="mini-page"><span>{page}</span><i style={{ width: `${45 + page * 9}%` }} /><i style={{ width: `${70 - page * 5}%` }} /><i style={{ width: `${55 + page * 4}%` }} /></div>
              <small>第 {page} 页</small>
            </button>
          ))}
        </aside>
        <section className="viewer-column">
          <div className="viewer-toolbar">
            <div>
              <button onClick={() => store.setPage(Math.max(1, activePage - 1))} disabled={activePage === 1}><ChevronLeft size={16} /></button>
              <strong>{activePage} / {doc.pages}</strong>
              <button onClick={() => store.setPage(Math.min(doc.pages, activePage + 1))} disabled={activePage === doc.pages}><ChevronRight size={16} /></button>
            </div>
            <span>125%</span>
            <span>原页 · 掩码叠加 · r{doc.revision}</span>
          </div>
          <div className="pdf-stage">
            <PdfPage
              pageNumber={activePage}
              onDraw={redactionMode ? (region) => store.addRedaction({ ...region, page: activePage, reason, privilege }) : undefined}
            />
            {pageRegions.map((region) => (
              <button
                key={region.id}
                className={`redaction-region ${region.status} ${activeRedactionId === region.id ? 'selected' : ''}`}
                style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                onClick={() => store.selectRedaction(region.id)}
                title={`${region.reason} / ${region.privilege}${region.basisRevision ? ` · 依据 r${region.basisRevision}` : ''}`}
              />
            ))}
          </div>
        </section>
        <aside className="inspector">
          <div className="side-label">区域属性 · 确认即留修订依据</div>
          {active ? (
            <>
              <div className="inspector-title">
                <strong>{active.reason}</strong>
                <Badge tone={active.status === 'confirmed' ? 'green' : 'amber'}>{active.status === 'confirmed' ? '已确认' : '草稿'}</Badge>
              </div>
              <label>保密级别<select value={doc.classification} onChange={(event) => store.updateClassification(event.target.value as DisclosureRecord['classification'])}><option>内部</option><option>机密</option><option>严格机密</option></select></label>
              <label>去密原因<input value={active.reason} readOnly /></label>
              <label>特权标签<input value={active.privilege} readOnly /></label>
              <label>责任人员<input value={doc.owner} readOnly /></label>
              <div className="coordinate-grid"><div><span>X</span><b>{Math.round(active.x * 100)}%</b></div><div><span>Y</span><b>{Math.round(active.y * 100)}%</b></div><div><span>宽</span><b>{Math.round(active.width * 100)}%</b></div><div><span>高</span><b>{Math.round(active.height * 100)}%</b></div></div>
              {active.status === 'confirmed' ? (
                <div className="basis-box">
                  <ShieldCheck size={15} />
                  <div>
                    <strong>确认依据已固定</strong>
                    <span>修订 r{active.basisRevision} · 指纹 {active.basisContentHash?.slice(0, 8)}</span>
                    <small>{active.confirmedBy?.name} · {active.confirmedAt} 先提交生效</small>
                  </div>
                </div>
              ) : (
                <>
                  <label>新区域原因<select value={reason} onChange={(e) => setReason(e.target.value)}><option>商业秘密</option><option>个人手机号</option><option>第三方报价</option><option>人员姓名</option></select></label>
                  <Button onClick={() => store.confirmRedaction(active.id)}>
                    <Check size={15} /> 确认并记录依据（r{doc.revision}）
                  </Button>
                  <button
                    className="ghost-link"
                    onClick={() => {
                      // 两人同时提交同一区域：第二笔必败，先到者生效
                      const rival = OPERATORS.find((o) => o.id !== store.activeOperatorId) ?? OPERATORS[0];
                      store.setOperator(rival.id);
                      store.confirmRedaction(active.id, 'draft');
                    }}
                  >
                    <Users size={13} /> 模拟另一操作者同时确认
                  </button>
                </>
              )}
              <Button variant="outline"><Copy size={15} /> 批量复制到同类页</Button>
            </>
          ) : <p className="muted">在文档页面上选择一个去密区域查看属性。</p>}
          <div className="revision-history">
            <div className="side-label">修订历史 <span>{doc.revisionHistory.length} 版</span></div>
            {doc.revisionHistory.slice().reverse().map((h) => (
              <div key={h.revision} className={`revision-row ${h.revision === doc.revision ? 'current' : ''}`}>
                <b>r{h.revision}</b>
                <div><span>{h.summary}</span><small>{h.at} · {h.contentHash.slice(0, 8)}</small></div>
              </div>
            ))}
          </div>
          <div className="rule-note"><AlertTriangle size={16} /><span>新增或修改区域会推进修订并使未发布批次的结论失效；已发出清单不受影响，只在基线页标出漂移。</span></div>
        </aside>
      </div>
      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>发布前校验</Dialog.Title>
            <Dialog.Description>核对原始页与发布页，结论将锚定当前修订 r{doc.revision}（{doc.contentHash.slice(0, 8)}）。</Dialog.Description>
            <div className="dialog-checks">
              <p><Check /> {doc.redactions.length} 个去密区域已定位</p>
              <p><Check /> 文档版本与操作者记录完整</p>
              <p className={doc.redactions.some((item) => item.status === 'draft') ? 'failed' : ''}>
                {doc.redactions.some((item) => item.status === 'draft') ? <AlertTriangle /> : <Check />}
                {doc.redactions.some((item) => item.status === 'draft') ? '仍有未确认区域' : '所有区域已确认'}
              </p>
              {drifted && <p className="failed"><AlertTriangle /> 既有结论依据 r{conclusion?.revision ?? latestConclusionFor(store.conclusions, doc.id)?.revision}，须重新质检</p>}
            </div>
            <Dialog.Close asChild><Button>返回检查 <X size={15} /></Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

/* ---------------------------- 发布质检页 ---------------------------- */

function QualityPage() {
  const documents = useDisclosureStore((s) => s.documents);
  const conclusions = useDisclosureStore((s) => s.conclusions);
  const store = useDisclosureStore();
  const [docId, setDocId] = useState(documents[0]?.id);
  const doc = documents.find((d) => d.id === docId) ?? documents[0];
  const conclusion = activeConclusionFor(conclusions, doc.id);
  const drifted = conclusion && (conclusion.revision !== doc.revision || conclusion.contentHash !== doc.contentHash);
  const gate = canRecordConclusion(doc);
  const checks = DEFAULT_CHECKS.map((c) => ({ ...c, detail: checkDetails[c.id] }));
  const allChecksPass = DEFAULT_CHECKS.every((c) => store.reviewChecks[c.id]);

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <small>QUALITY ASSURANCE / BASELINE</small>
          <h1>发布质检双人复核</h1>
          <p>复核结论写入时锚定修订号与内容指纹；区域一变，结论自动失效并回到本页重新确认。</p>
        </div>
        <Link to="/batches"><Button variant="outline"><Tags size={16} /> 前往发布基线</Button></Link>
      </header>

      <Card className="quality-doc-picker">
        <span>复核文档</span>
        <select value={doc.id} onChange={(e) => setDocId(e.target.value)}>
          {documents.map((d) => <option key={d.id} value={d.id}>{d.id} · {d.title}（r{d.revision}）</option>)}
        </select>
        <RevisionTag doc={doc} tone={drifted ? 'amber' : 'blue'} />
        <DocStatusBadge doc={doc} />
      </Card>

      {drifted && (
        <div className="baseline-banner danger">
          <AlertTriangle size={15} />
          {(() => {
            const latest = latestConclusionFor(conclusions, doc.id);
            return (
              <span>
                生效于 r{conclusion?.revision ?? latest?.revision} 的结论（{conclusion?.reviewer.name ?? latest?.reviewer.name}）已失效
                {latest?.impactedBatches?.length ? <>，受影响的未发布批次：{latest.impactedBatches.join('、')}</> : null}。
                当前 r{doc.revision} 须重新复核后才能出清单。
              </span>
            );
          })()}
        </div>
      )}

      <div className="comparison-banner">
        <div><Eye size={17} /><strong>{doc.title}</strong><span>修订 r{doc.revision} · 双人复核 · 操作者 {OPERATORS.find((o) => o.id === store.activeOperatorId)?.name}</span></div>
        {conclusion && !drifted ? <Badge tone="green">结论有效 · 锚定 r{conclusion.revision}</Badge> : <Badge tone="amber">等待复审结论</Badge>}
      </div>
      <div className="compare-grid">
        <Card className="compare-panel"><div className="compare-head"><span>原始页</span><Badge tone="neutral">源文件</Badge></div><div className="compare-page"><PdfPage pageNumber={1} /></div></Card>
        <Card className="compare-panel"><div className="compare-head"><span>发布页</span><Badge tone="green">已遮蔽</Badge></div><div className="compare-page redacted-preview"><PdfPage pageNumber={1} redacted /><div className="demo-mask mask-one" /><div className="demo-mask mask-two" /></div></Card>
      </div>
      <div className="quality-bottom">
        <Card className="checks-card">
          <div className="card-title"><ClipboardCheck size={17} /><strong>发布前校验项</strong><span>逐项核对后写入结论</span></div>
          {checks.map((check) => (
            <button className="check-row" key={check.id} onClick={() => store.toggleReviewCheck(check.id)}>
              <span className={store.reviewChecks[check.id] ? 'checked' : ''}>{store.reviewChecks[check.id] && <Check size={13} />}</span>
              <div><strong>{check.label}</strong><small>{check.detail}</small></div>
            </button>
          ))}
        </Card>
        <Card className="decision-card">
          <div className="card-title"><ShieldCheck size={17} /><strong>复核结论</strong><span>依据 r{doc.revision} · {doc.contentHash.slice(0, 8)}</span></div>
          <p>本份文档共 <b>{doc.redactions.length}</b> 个去密区域，已确认 {doc.redactions.filter((item) => item.status === 'confirmed').length} 个。结论仅对当前修订有效。</p>
          <label><input type="checkbox" checked={store.metadataCleaned} onChange={store.toggleMetadata} /> 已确认元数据清理</label>
          {!gate.ok && <p className="gate-hint"><AlertTriangle size={13} /> {gate.reason}，暂时无法通过</p>}
          <div className="decision-actions">
            <Button variant="outline" onClick={() => store.recordQuality(doc.id, 'reject')}><ArrowLeft size={15} /> 退回补件</Button>
            <Button disabled={!gate.ok || !store.metadataCleaned || !allChecksPass} onClick={() => store.recordQuality(doc.id, 'pass')}><Check size={15} /> 通过并锚定 r{doc.revision}</Button>
          </div>
          {conclusion && !drifted && <p className="muted conclusion-line">当前有效结论：{conclusion.id} · {conclusion.reviewer.name} · {conclusion.createdAt}</p>}
        </Card>
      </div>
    </div>
  );
}

const checkDetails: Record<string, string> = {
  'forbidden-terms': '扫描原始页和发布页文本层',
  'page-number': '检查拆页、合并及漏页情况',
  'image-boundary': '逐页比较遮蔽边界 2mm 区域',
  metadata: '作者、修订人、批注和隐藏字段'
};

/* ---------------------------- 发布基线页 ---------------------------- */

function BatchesPage() {
  const documents = useDisclosureStore((s) => s.documents);
  const batches = useDisclosureStore((s) => s.batches);
  const register = useDisclosureStore((s) => s.manifestRegister);
  const drafts = useDisclosureStore((s) => s.drafts);
  const nextWriteFails = useDisclosureStore((s) => s.nextWriteFails);
  const issueStatus = useDisclosureStore((s) => s.issueStatus);
  const store = useDisclosureStore();
  const [activeBatchId, setActiveBatchId] = useState(batches[0]?.id);
  const batch = batches.find((b) => b.id === activeBatchId) ?? batches[0];
  const evaluation = evaluateBatch(
    { documents, conclusions: store.conclusions, batches, manifestRegister: register },
    batch.id
  );
  const activeDraft = drafts.find((d) => d.manifest.manifestNo === batch.id);

  return (
    <div className="page">
      <header className="page-heading">
        <div>
          <small>RELEASE BATCH / BASELINE</small>
          <h1>发布基线：批次 · 清单 · 冻结登记</h1>
          <p>门禁全部通过才生成清单；清单一旦发出即冻结，之后的内容变化只标注影响、不改写清单。</p>
        </div>
        <label className="fail-toggle">
          <input type="checkbox" checked={nextWriteFails} onChange={store.toggleNextWriteFailure} />
          <span>模拟下一次清单写入失败（验证草稿保留与重试）</span>
        </label>
      </header>
      <div className="batch-layout">
        <Card className="batch-list">
          <div className="card-title"><Layers3 size={17} /><strong>发布批次</strong></div>
          {batches.map((b) => {
            const frozen = Boolean(b.issuedManifest);
            const ev = evaluateBatch({ documents, conclusions: store.conclusions, batches, manifestRegister: register }, b.id);
            return (
              <button key={b.id} className={b.id === batch.id ? 'active' : ''} onClick={() => setActiveBatchId(b.id)}>
                <span>{b.id} {frozen && <Snowflake size={9} />}</span>
                <strong>{b.name}</strong>
                <small>{b.documentIds.length} 份文档{frozen ? ' · 清单已冻结' : ev.ready ? ' · 门禁通过' : ' · 未重新确认'}</small>
              </button>
            );
          })}
          <div className="register-mini">
            <div className="side-label">追加登记册</div>
            {register.length === 0 && <small>尚无已发出清单</small>}
            {register.map((m) => (
              <div key={m.manifestNo} className="register-row">
                <FileLock2 size={12} />
                <div><strong>{m.manifestNo}</strong><small>{m.appendedAt} 追加 · 只追加一次</small></div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="batch-content">
          <div className="card-title">
            <Tags size={17} /><strong>{batch.name}</strong>
            {batch.issuedManifest ? <Badge tone="neutral"><Snowflake size={10} /> 已冻结</Badge> : evaluation.ready ? <Badge tone="green">可出清单</Badge> : <Badge tone="red">门禁未过</Badge>}
          </div>

          {!batch.issuedManifest && (
            <div className="batch-table">
              {documents.map((d) => {
                const member = batch.documentIds.includes(d.id);
                const c = activeConclusionFor(store.conclusions, d.id);
                const ok = member && c && c.revision === d.revision && c.contentHash === d.contentHash && c.verdict === 'pass';
                return (
                  <label key={d.id} className={`batch-row ${member ? '' : 'dimmed'}`}>
                    <input
                      type="checkbox"
                      checked={member}
                      onChange={() => store.setBatchDocuments(
                        batch.id,
                        member ? batch.documentIds.filter((id) => id !== d.id) : [...batch.documentIds, d.id]
                      )}
                    />
                    <FileText size={17} />
                    <div><strong>{d.title}</strong><span>{d.id} · {d.issue} · <RevisionTag doc={d} /></span></div>
                    {member ? (ok ? <Badge tone="green">结论有效</Badge> : <Badge tone="red">待重新确认</Badge>) : <Badge tone="neutral">未纳入</Badge>}
                  </label>
                );
              })}
            </div>
          )}

          {batch.issuedManifest && <FrozenManifest manifestNo={batch.id} />}

          {!batch.issuedManifest && (
            <div className="gate-panel">
              <h3><ShieldCheck size={14} /> 发布门禁</h3>
              {evaluation.blocks.length === 0 ? (
                <p className="gate-ok"><Check size={14} /> {evaluation.entries.length} 份文档结论均锚定当前修订，可以出清单。</p>
              ) : (
                <ul className="gate-blocks">
                  {evaluation.blocks.map((b) => (
                    <li key={b.documentId}>
                      <AlertTriangle size={13} />
                      {b.kind === 'no-conclusion'
                        ? `${b.title}（${b.documentId}）尚无有效通过结论，不能出清单`
                        : `${b.title}（${b.documentId}）结论依据 r${b.conclusionRevision}，当前已是 r${b.currentRevision}，必须重新确认`}
                    </li>
                  ))}
                </ul>
              )}
              <div className="issue-row">
                <Button disabled={!evaluation.ready || issueStatus?.state === 'writing'} onClick={() => store.issueManifest(batch.id)}>
                  <Send size={14} /> {activeDraft ? `重试写入（已保留草稿 · 第 ${activeDraft.attempts + 1} 次）` : '生成并追加发布清单'}
                </Button>
                {activeDraft && <Button variant="outline" onClick={() => store.discardDraft(batch.id)}><Trash2 size={14} /> 放弃草稿</Button>}
                {issueStatus?.batchId === batch.id && <small className={`issue-status ${issueStatus.state}`}>{issueStatus.message}</small>}
              </div>
              {activeDraft && (
                <div className="draft-box">
                  <AlertTriangle size={14} />
                  <span>写入失败后草稿已保留（批次号 {batch.id}，{activeDraft.manifest.entries.length} 份文档，已尝试 {activeDraft.attempts} 次）。重试不会改变批次号，登记册只接受第一次追加。</span>
                </div>
              )}
            </div>
          )}
        </Card>

        <Card className="batch-summary">
          <div className="side-label">当前批次摘要</div>
          <strong>{batch.name}</strong>
          <dl>
            <div><dt>纳入文档</dt><dd>{batch.documentIds.length}</dd></div>
            <div><dt>结论有效</dt><dd>{evaluation.entries.length}</dd></div>
            <div><dt>门禁阻断</dt><dd className={evaluation.blocks.length ? 'warning-text' : ''}>{evaluation.blocks.length}</dd></div>
            <div><dt>清单状态</dt><dd>{batch.issuedManifest ? '冻结' : '未发出'}</dd></div>
          </dl>
          {batch.issuedManifest ? (
            <div className="summary-note frozen"><Snowflake size={15} /><span>清单 {batch.id} 已于 {batch.issuedManifest.issuedAt} 冻结，不能重新出具。</span></div>
          ) : evaluation.ready ? (
            <div className="summary-note ok"><Check size={15} /><span>门禁通过，可追加清单；追加后立即冻结。</span></div>
          ) : (
            <div className="summary-note"><AlertTriangle size={15} /><span>未重新确认的文档不能出清单。</span></div>
          )}
        </Card>
      </div>
    </div>
  );
}

function FrozenManifest({ manifestNo }: { manifestNo: string }) {
  const state = useDisclosureStore();
  const batch = state.batches.find((b) => b.id === manifestNo);
  const impacts = manifestImpact(
    { documents: state.documents, conclusions: state.conclusions, batches: state.batches, manifestRegister: state.manifestRegister },
    batch!.issuedManifest!
  );
  return (
    <div className="frozen-panel">
      <div className="frozen-head"><Snowflake size={14} /><strong>已发出清单（冻结快照）</strong><span>{batch!.issuedManifest!.issuedAt} · {batch!.issuedManifest!.issuedBy.name}</span></div>
      <div className="frozen-table">
        {impacts.map((impact) => (
          <div key={impact.entry.documentId} className="frozen-row">
            <FileText size={15} />
            <div>
              <strong>{impact.entry.title}</strong>
              <small>冻结于 r{impact.entry.revision} · {impact.entry.contentHash.slice(0, 8)} · 结论 {impact.entry.conclusionId} · 复核 {impact.entry.reviewer}</small>
            </div>
            {impact.kind === 'frozen-drifted' ? (
              <Badge tone="red">内容已漂移至 r{impact.doc.revision} · 冻结不覆盖</Badge>
            ) : (
              <Badge tone="green">与当前一致</Badge>
            )}
          </div>
        ))}
      </div>
      <p className="frozen-note">
        <AlertTriangle size={13} />
        清单不可改写。若需按新修订披露，请另立新批次并重新质检；漂移文档的新结论{' '}
        {impacts.some((i) => i.kind === 'frozen-drifted' && i.activeConclusion) ? '已就绪，可纳入新批次。' : '尚未完成，须回到质检页重新确认。'}
      </p>
    </div>
  );
}

/* ------------------------------ 路由 ------------------------------ */

const rootRoute = createRootRoute({ component: AppShell });
const documentsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: DocumentsPage });
const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: '/review/$documentId', component: ReviewPage });
const qualityRoute = createRoute({ getParentRoute: () => rootRoute, path: '/quality', component: QualityPage });
const batchesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/batches', component: BatchesPage });
const routeTree = rootRoute.addChildren([documentsRoute, reviewRoute, qualityRoute, batchesRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

export default function App() {
  return <RouterProvider router={router} />;
}
