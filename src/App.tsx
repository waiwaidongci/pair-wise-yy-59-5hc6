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
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Eye,
  FileCheck2,
  FileText,
  Highlighter,
  History,
  Layers3,
  Lock,
  Menu,
  PanelLeftClose,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Stamp,
  Tags,
  Unlock,
  UploadCloud,
  User,
  XCircle
} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Badge, Button, Card, Dialog, Tabs, X } from './components/ui';
import { useDisclosureStore, docBaseline, type DisclosureRecord } from './store';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const bundleQuery = async () => ({
  queue: [
    { id: 'Q-31', name: '第三批补充材料', count: 128, owner: '林清', progress: 68, due: '今日 16:00' },
    { id: 'Q-32', name: '证人材料图像件', count: 47, owner: '周叙', progress: 34, due: '明日 11:00' },
    { id: 'Q-33', name: '专家报告附件', count: 19, owner: '顾言', progress: 91, due: '09-30 18:00' }
  ]
});

function ToastHost() {
  const toasts = useDisclosureStore((state) => state.toasts);
  const dismissToast = useDisclosureStore((state) => state.dismissToast);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), 6000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismissToast]);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.kind === 'conflict' ? <XCircle size={15} /> : t.kind === 'success' ? <CheckCircle2 size={15} /> : t.kind === 'warn' ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function RevisionBadge({ revision }: { revision: number }) {
  return <Badge tone="blue">修订 r{revision}</Badge>;
}

function StaleNote({ children }: { children: React.ReactNode }) {
  return <span className="stale-note"><AlertTriangle size={12} /> {children}</span>;
}

function AppShell() {
  const [mobileNav, setMobileNav] = useState(false);
  const links = [
    { to: '/', label: '文档集', icon: Layers3 },
    { to: '/review/$documentId', label: '去密审阅', icon: Highlighter },
    { to: '/quality', label: '发布质检', icon: ScanSearch },
    { to: '/batches', label: '批次与标签', icon: Tags }
  ];
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-symbol"><Stamp size={18} /></div>
          <div><strong>披露质控台</strong><span>North Ridge / Litigation Support</span></div>
        </div>
        <div className="top-actions">
          <Badge tone="amber">2 项待质检</Badge>
          <div className="operator"><span>质控员</span><strong>林清 · 审核组</strong></div>
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
              <Link key={to} to={to as '/'} activeProps={{ className: 'active' }} onClick={() => setMobileNav(false)}>
                <Icon size={17} /> <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div><ShieldCheck size={16} /><span>审计记录已开启</span></div>
            <small>草稿自动保存在本机</small>
          </div>
        </aside>
        <main className="main-content"><Outlet /></main>
      </div>
      <ToastHost />
    </div>
  );
}

function DocumentsPage() {
  const documents = useDisclosureStore((state) => state.documents);
  const { data } = useQuery({ queryKey: ['document-queues'], queryFn: bundleQuery });
  const [filter, setFilter] = useState('全部');
  const visible = filter === '全部' ? documents : documents.filter((doc) => doc.status === filter);
  return (
    <div className="page">
      <header className="page-heading">
        <div><small>DISCLOSURE CONTROL / DOCUMENT SET</small><h1>披露文档集</h1><p>分批完成密级复核、敏感区域去密与发布版本比对。</p></div>
        <Button><UploadCloud size={16} /> 导入文档集</Button>
      </header>
      <section className="summary-strip">
        <div><span>文档总数</span><strong>194</strong><small>12.8 GB</small></div>
        <div><span>去密区域</span><strong>2,481</strong><small>较上版 +34</small></div>
        <div><span>待质检</span><strong className="warning-text">17</strong><small>4 项高风险</small></div>
        <div><span>已批准批次</span><strong>6</strong><small>本周 +2</small></div>
      </section>
      <div className="two-column">
        <Card className="document-table-card">
          <div className="card-heading">
            <div><Tabs.Root value={filter} onValueChange={setFilter}><Tabs.List className="segmented">
              {['全部', '去密中', '待质检', '可发布'].map((item) => <Tabs.Trigger key={item} value={item}>{item}</Tabs.Trigger>)}
            </Tabs.List></Tabs.Root></div>
            <span>{visible.length} 份文档</span>
          </div>
          <div className="document-table">
            {visible.map((doc) => (
              <div className="document-row" key={doc.id}>
                <div className="file-icon"><FileText size={19} /></div>
                <div className="doc-main">
                  <strong>{doc.title}</strong>
                  <span>{doc.id} · {doc.bundle} · {doc.size}</span>
                </div>
                <div className="doc-field"><span>密级</span><Badge tone={doc.classification === '严格机密' ? 'red' : doc.classification === '机密' ? 'amber' : 'neutral'}>{doc.classification}</Badge></div>
                <div className="doc-field"><span>负责人员</span><strong>{doc.owner}</strong></div>
                <div className="doc-field"><span>状态</span><Badge tone={doc.status === '可发布' ? 'green' : doc.status === '待质检' ? 'amber' : 'blue'}>{doc.status}</Badge></div>
                <div className="doc-actions">
                  <Link to="/review/$documentId" params={{ documentId: doc.id }}><Button variant="outline">审阅</Button></Link>
                </div>
              </div>
            ))}
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
            <div className="card-title"><ShieldCheck size={17} /><strong>最近操作</strong></div>
            <p><b>09:48</b> 林清确认 DOC-00418 的合同价款遮蔽区域。</p>
            <p><b>09:31</b> 周叙提交会议纪要待质检。</p>
            <p><b>08:54</b> 顾言导出 DOC-00435 发布清单。</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function useDemoPdf() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let alive = true;
    PDFDocument.create().then(async (pdf) => {
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let pageNo = 1; pageNo <= 3; pageNo += 1) {
        const page = pdf.addPage([612, 792]);
        page.drawText(`NORTH RIDGE PROJECT - DISCLOSURE EXHIBIT`, { x: 54, y: 728, size: 14, font, color: rgb(0.12, 0.16, 0.2) });
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

function ReviewPage() {
  const { documentId } = useParams({ from: '/review/$documentId' });
  const navigate = useNavigate();
  const { documents, activePage, redactionMode, activeRedactionId, pendingWrites } = useDisclosureStore();
  const store = useDisclosureStore();
  const doc = documents.find((item) => item.id === documentId) ?? documents[0];
  const pageRegions = doc.redactions.filter((item) => item.page === activePage);
  const active = doc.redactions.find((item) => item.id === activeRedactionId);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState('商业秘密');
  const [privilege, setPrivilege] = useState('合同保密');

  // 确认时依据的修订：选中区域时记录，用于先到者生效判定
  const baseRevisionRef = useRef(doc.revision);
  useEffect(() => {
    baseRevisionRef.current = doc.revision;
  }, [activeRedactionId, documentId]);

  const pendingConfirm = pendingWrites.find((w) => w.kind === 'confirm' && w.documentId === doc.id);
  const confirmedCount = doc.redactions.filter((item) => item.status === 'confirmed' && item.confirmedRevision === doc.revision).length;

  return (
    <div className="page review-page">
      <header className="review-header">
        <div className="review-title">
          <Button variant="ghost" onClick={() => navigate({ to: '/' })}><ArrowLeft size={16} /></Button>
          <div><small>{doc.id} / 去密审阅</small><h1>{doc.title}</h1></div>
          <RevisionBadge revision={doc.revision} />
          <Badge tone={doc.classification === '严格机密' ? 'red' : 'amber'}>{doc.classification}</Badge>
        </div>
        <div className="review-actions">
          <Button variant="outline" onClick={() => store.toggleRedactionMode()} className={redactionMode ? 'active-button' : ''}><Highlighter size={16} /> {redactionMode ? '取消绘制' : '绘制去密区'}</Button>
          <Button variant="outline" onClick={() => setDialogOpen(true)}><FileCheck2 size={16} /> 发布前校验</Button>
          <Button><Check size={16} /> 提交质检</Button>
        </div>
      </header>
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
            <div><button onClick={() => store.setPage(Math.max(1, activePage - 1))} disabled={activePage === 1}><ChevronLeft size={16} /></button><strong>{activePage} / {doc.pages}</strong><button onClick={() => store.setPage(Math.min(doc.pages, activePage + 1))} disabled={activePage === doc.pages}><ChevronRight size={16} /></button></div>
            <span>125%</span>
            <span>原页 · 掩码叠加</span>
            <span className="revision-hint">确认依据修订 r{baseRevisionRef.current} · 已确认 {confirmedCount}/{doc.redactions.length}</span>
          </div>
          <div className="pdf-stage">
            <PdfPage
              pageNumber={activePage}
              onDraw={redactionMode ? (region) => store.addRedaction({ ...region, page: activePage, reason, privilege }) : undefined}
            />
            {pageRegions.map((region) => {
              const stale = region.status === 'draft' && region.confirmedRevision !== undefined && region.confirmedRevision < doc.revision;
              return (
                <button
                  key={region.id}
                  className={`redaction-region ${region.status} ${activeRedactionId === region.id ? 'selected' : ''} ${stale ? 'stale' : ''}`}
                  style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                  onClick={() => store.selectRedaction(region.id)}
                  title={`${region.reason} / ${region.privilege}`}
                />
              );
            })}
          </div>
        </section>
        <aside className="inspector">
          <div className="side-label">区域属性</div>
          {active ? (
            <>
              <div className="inspector-title">
                <strong>{active.reason}</strong>
                {active.status === 'confirmed' && active.confirmedRevision === doc.revision
                  ? <Badge tone="green">已确认 r{active.confirmedRevision}</Badge>
                  : active.status === 'draft' && active.confirmedRevision !== undefined && active.confirmedRevision < doc.revision
                    ? <Badge tone="amber">待复核</Badge>
                    : <Badge tone="amber">草稿</Badge>}
              </div>
              {active.status === 'draft' && active.confirmedRevision !== undefined && active.confirmedRevision < doc.revision && (
                <div className="stale-banner"><StaleNote>曾确认于 r{active.confirmedRevision}，内容已变更至 r{doc.revision}，需重新确认。</StaleNote></div>
              )}
              <label>保密级别<select value={doc.classification} onChange={(event) => store.updateClassification(event.target.value as DisclosureRecord['classification'])}><option>内部</option><option>机密</option><option>严格机密</option></select></label>
              <label>去密原因<input value={active.reason} readOnly /></label>
              <label>特权标签<input value={active.privilege} readOnly /></label>
              <label>责任人员<input value={doc.owner} readOnly /></label>
              <div className="coordinate-grid"><div><span>X</span><b>{Math.round(active.x * 100)}%</b></div><div><span>Y</span><b>{Math.round(active.y * 100)}%</b></div><div><span>宽</span><b>{Math.round(active.width * 100)}%</b></div><div><span>高</span><b>{Math.round(active.height * 100)}%</b></div></div>
              <Button
                onClick={() => store.confirmRedaction(active.id, baseRevisionRef.current)}
                disabled={active.status === 'confirmed' && active.confirmedRevision === doc.revision}
              ><Check size={15} /> 确认此区域（依据 r{baseRevisionRef.current}）</Button>
              <Button variant="outline" onClick={() => active && store.simulateTeammateConfirm(doc.id, active.id)} disabled={active.status === 'confirmed' && active.confirmedRevision === doc.revision}><User size={15} /> 模拟队友先提交</Button>
              <Button variant="outline"><Copy size={15} /> 批量复制到同类页</Button>
              {pendingConfirm && (
                <div className="retry-banner">
                  <RefreshCw size={14} />
                  <span>与队友提交冲突，草稿已保留（依据 r{pendingConfirm.baseRevision}）。</span>
                  <Button variant="outline" onClick={() => store.retryWrite(pendingConfirm.id)}><RefreshCw size={13} /> 重试</Button>
                </div>
              )}
            </>
          ) : <p className="muted">在文档页面上选择一个去密区域查看属性。</p>}
          <div className="rule-note"><AlertTriangle size={16} /><span>发布版本不得包含原始文本层或图片残片。</span></div>
        </aside>
      </div>
      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="dialog-content">
            <Dialog.Title>发布前校验</Dialog.Title>
            <Dialog.Description>系统将核对原始页与发布页的一致性，并检查元数据残留。</Dialog.Description>
            <div className="dialog-checks">
              <p><Check /> {doc.redactions.length} 个去密区域已定位</p>
              <p><Check /> 文档版本与操作者记录完整（当前修订 r{doc.revision}）</p>
              <p className={doc.redactions.some((item) => item.status === 'draft') ? 'failed' : ''}><AlertTriangle /> {doc.redactions.some((item) => item.status === 'draft') ? '仍有未确认区域' : '所有区域已确认'}</p>
            </div>
            <Dialog.Close asChild><Button>返回检查 <X size={15} /></Button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function QualityPage() {
  const { documents, batches, activeBatchId, reviewChecks, metadataCleaned, pendingWrites } = useDisclosureStore();
  const store = useDisclosureStore();
  const activeBatch = batches.find((b) => b.id === activeBatchId) ?? batches[0];
  const batchDocs = activeBatch.documentIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is DisclosureRecord => !!d);
  const [selectedDocId, setSelectedDocId] = useState<string>(batchDocs[0]?.id ?? '');
  const doc = documents.find((d) => d.id === selectedDocId) ?? batchDocs[0];

  // 质检依据的修订：切换文档/批次时记录
  const baseRevisionRef = useRef(doc?.revision ?? 1);
  useEffect(() => {
    baseRevisionRef.current = doc?.revision ?? 1;
  }, [selectedDocId, activeBatchId]);

  const checks = [
    { id: 'forbidden-terms', label: '全文禁词与姓名复核', detail: '扫描原始页和发布页文本层' },
    { id: 'page-number', label: '页序与页码连续性', detail: '检查拆页、合并及漏页情况' },
    { id: 'image-boundary', label: '图像边界残片', detail: '逐页比较遮蔽边界 2mm 区域' },
    { id: 'metadata', label: '文档元数据清理', detail: '作者、修订人、批注和隐藏字段' }
  ];

  if (!doc) return <div className="page"><p className="muted">请先在批次中加入文档。</p></div>;

  const baseline = docBaseline(activeBatch, doc);
  const confirmedAtRevision = doc.redactions.filter((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision).length;
  const pendingQc = pendingWrites.find((w) => w.kind === 'qc' && w.batchId === activeBatch.id && w.documentId === doc.id);
  const allChecksDone = Object.values(reviewChecks).every(Boolean) && metadataCleaned;

  return (
    <div className="page">
      <header className="page-heading"><div><small>QUALITY ASSURANCE / SIDE-BY-SIDE</small><h1>发布质控双人复核</h1><p>并排检查原始页与发布页，所有差异必须留下绑定修订的复核结论。</p></div>
        <div className="batch-select">
          <label>质检批次</label>
          <select value={activeBatch.id} onChange={(e) => store.setActiveBatch(e.target.value)}>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.id} · {b.name}{b.manifest ? '（已冻结）' : ''}</option>)}
          </select>
        </div>
      </header>

      {activeBatch.manifest && (
        <div className="frozen-banner">
          <Lock size={15} />
          <span>批次 {activeBatch.id} 清单已于 {activeBatch.manifest.issuedAt} 冻结发出，质检结论不再变更。</span>
        </div>
      )}

      <div className="comparison-banner">
        <div><Eye size={17} /><strong>{doc.title}</strong><span>修订 r{doc.revision} · 双人复核</span></div>
        <div className="banner-badges">
          <RevisionBadge revision={doc.revision} />
          {baseline.qcValid
            ? <Badge tone="green">质检通过 r{baseline.qc?.revision}</Badge>
            : baseline.qcStale
              ? <Badge tone="amber">质检失效（依据 r{baseline.qc?.revision}）</Badge>
              : <Badge tone="amber">等待复审员 2/2</Badge>}
        </div>
      </div>

      {batchDocs.length > 0 && (
        <div className="qc-doc-tabs">
          {batchDocs.map((d) => {
            const b = docBaseline(activeBatch, d);
            return (
              <button key={d.id} className={d.id === doc.id ? 'active' : ''} onClick={() => setSelectedDocId(d.id)}>
                <span>{d.id}</span>
                <strong>{d.title}</strong>
                {b.qcValid ? <Badge tone="green">通过</Badge> : b.qcStale ? <Badge tone="amber">失效</Badge> : <Badge tone="neutral">待质检</Badge>}
              </button>
            );
          })}
        </div>
      )}

      <div className="compare-grid">
        <Card className="compare-panel"><div className="compare-head"><span>原始页</span><Badge tone="neutral">源文件</Badge></div><div className="compare-page"><PdfPage pageNumber={1} /></div></Card>
        <Card className="compare-panel"><div className="compare-head"><span>发布页</span><Badge tone="green">已遮蔽</Badge></div><div className="compare-page redacted-preview"><PdfPage pageNumber={1} redacted /><div className="demo-mask mask-one" /><div className="demo-mask mask-two" /></div></Card>
      </div>
      <div className="quality-bottom">
        <Card className="checks-card"><div className="card-title"><ClipboardCheck size={17} /><strong>发布前校验项</strong></div>{checks.map((check) => <button className="check-row" key={check.id} onClick={() => store.toggleReviewCheck(check.id)}><span className={store.reviewChecks[check.id] ? 'checked' : ''}>{store.reviewChecks[check.id] && <Check size={13} />}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div></button>)}</Card>
        <Card className="decision-card">
          <div className="card-title"><ShieldCheck size={17} /><strong>复核结论</strong></div>
          <p>本批次共有 <b>{doc.redactions.length}</b> 个去密区域，当前修订 r{doc.revision} 下已确认 {confirmedAtRevision} 个。</p>
          {!baseline.allConfirmed && <div className="stale-banner"><StaleNote>仍有区域未按当前修订 r{doc.revision} 确认，不能通过质检。</StaleNote></div>}
          {baseline.qcStale && <div className="stale-banner"><StaleNote>质检结论依据 r{baseline.qc?.revision}，内容已变更至 r{doc.revision}，结论失效需重新质检。</StaleNote></div>}
          <label><input type="checkbox" checked={store.metadataCleaned} onChange={store.toggleMetadata} /> 已确认元数据清理</label>
          <div className="decision-actions">
            <Button variant="outline"><ArrowLeft size={15} /> 退回补件</Button>
            <Button
              disabled={activeBatch.manifest != null || !allChecksDone || !baseline.allConfirmed}
              onClick={() => store.submitQc(activeBatch.id, doc.id, 'passed', baseRevisionRef.current)}
            ><Check size={15} /> 通过并标记可发布（依据 r{baseRevisionRef.current}）</Button>
          </div>
          {pendingQc && (
            <div className="retry-banner">
              <RefreshCw size={14} />
              <span>质检提交时内容已变更（依据 r{pendingQc.baseRevision}），草稿已保留。</span>
              <Button variant="outline" onClick={() => store.retryWrite(pendingQc.id)}><RefreshCw size={13} /> 重试</Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function BatchesPage() {
  const { documents, batches, activeBatchId } = useDisclosureStore();
  const store = useDisclosureStore();
  const activeBatch = batches.find((b) => b.id === activeBatchId) ?? batches[0];
  const [selected, setSelected] = useState<string[]>(activeBatch?.documentIds ?? []);

  const batchDocs = activeBatch.documentIds
    .map((id) => documents.find((d) => d.id === id))
    .filter((d): d is DisclosureRecord => !!d);

  const baselineReady = batchDocs.length > 0 && batchDocs.every((d) => docBaseline(activeBatch, d).ready);
  const diverged = activeBatch.manifest?.divergedDocuments ?? [];

  return (
    <div className="page">
      <header className="page-heading"><div><small>RELEASE BATCH / TAXONOMY</small><h1>发布批次与标签</h1><p>按案件问题、辖区和披露对象组织文档，生成绑定发布基线的可追溯清单。</p></div>
        <Button disabled={!baselineReady || !!activeBatch.manifest} onClick={() => store.issueManifest(activeBatch.id)}>
          {activeBatch.manifest ? <Lock size={16} /> : <Unlock size={16} />}
          {activeBatch.manifest ? '清单已冻结发出' : '生成发布清单'}
        </Button>
      </header>
      <div className="batch-layout">
        <Card className="batch-list"><div className="card-title"><Layers3 size={17} /><strong>发布批次</strong></div>
          {batches.map((batch) => {
            const docs = batch.documentIds.map((id) => documents.find((d) => d.id === id)).filter((d): d is DisclosureRecord => !!d);
            const ready = docs.length > 0 && docs.every((d) => docBaseline(batch, d).ready);
            return (
              <button key={batch.id} className={batch.id === activeBatch.id ? 'active' : ''} onClick={() => { store.setActiveBatch(batch.id); setSelected(batch.documentIds); }}>
                <span>{batch.id}</span>
                <strong>{batch.name}</strong>
                <small>{docs.length} 份文档 · {batch.manifest ? '已冻结' : ready ? '基线完整' : '待复核'}</small>
              </button>
            );
          })}
        </Card>
        <Card className="batch-content">
          <div className="card-title">
            <Tags size={17} /><strong>文档与发布基线</strong>
            <span>{selected.length} 已选择</span>
          </div>

          {activeBatch.manifest ? (
            <div className="frozen-manifest">
              <div className="frozen-head">
                <Lock size={16} />
                <div><strong>已发出清单（冻结）</strong><small>{activeBatch.manifest.batchId} · 发出于 {activeBatch.manifest.issuedAt}</small></div>
              </div>
              <div className="batch-table">
                {activeBatch.manifest.snapshot.map((s) => (
                  <div className="batch-row" key={s.documentId}>
                    <FileText size={17} />
                    <div><strong>{s.title}</strong><span>{s.documentId} · 发出时修订 r{s.revision} · {s.redactionCount} 个区域</span></div>
                    <Badge tone="neutral">已冻结</Badge>
                  </div>
                ))}
              </div>
              {diverged.length > 0 && (
                <div className="diverge-banner">
                  <AlertTriangle size={15} />
                  <div>
                    <strong>发出后内容已变更，影响已标出：</strong>
                    <ul>
                      {diverged.map((d) => {
                        const doc = documents.find((x) => x.id === d.documentId);
                        return <li key={d.documentId}>{d.documentId}（{doc?.title}）：r{d.fromRevision} → r{d.toRevision}，冻结清单与当前内容分歧。</li>;
                      })}
                    </ul>
                    <span className="diverge-note">冻结清单不再改写；如需按当前内容重新发布，须重新确认并新建批次。</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="batch-table">
                {batchDocs.length === 0 && <p className="muted empty-batch">本批次暂无文档。</p>}
                {batchDocs.map((doc) => {
                  const b = docBaseline(activeBatch, doc);
                  const confirmedAtRevision = doc.redactions.filter((r) => r.status === 'confirmed' && r.confirmedRevision === doc.revision).length;
                  return (
                    <div className="batch-row" key={doc.id}>
                      <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => setSelected((ids) => ids.includes(doc.id) ? ids.filter((id) => id !== doc.id) : [...ids, doc.id])} />
                      <FileText size={17} />
                      <div>
                        <strong>{doc.title}</strong>
                        <span>{doc.id} · {doc.issue} · 修订 r{doc.revision} · 区域 {confirmedAtRevision}/{doc.redactions.length} 已确认</span>
                      </div>
                      {b.ready
                        ? <Badge tone="green">基线完整</Badge>
                        : b.qcStale
                          ? <Badge tone="amber">质检失效</Badge>
                          : !b.allConfirmed
                            ? <Badge tone="red">待重新确认</Badge>
                            : <Badge tone="amber">待质检</Badge>}
                    </div>
                  );
                })}
              </div>
              <div className="tag-editor">
                <h3>标签与分发级</h3>
                <div className="tag-options">{(['合同问题', '设备缺陷', '现场安全', '损害赔偿', '仅律师可见']).map((tag, index) => <span key={tag} className={index < 3 ? 'selected' : ''}>{tag}</span>)}</div>
                <label>导出清单说明<textarea defaultValue="按案卷编号升序导出，保留去密版本、操作者与审批时间。" /></label>
                <Button>保存批次设置</Button>
              </div>
            </>
          )}
        </Card>
        <Card className="batch-summary">
          <div className="side-label">当前批次摘要</div>
          <strong>{activeBatch.name}</strong>
          <dl>
            <div><dt>文档</dt><dd>{batchDocs.length}</dd></div>
            <div><dt>页数</dt><dd>{batchDocs.reduce((sum, doc) => sum + doc.pages, 0)}</dd></div>
            <div><dt>基线状态</dt><dd>{activeBatch.manifest ? '已冻结发出' : baselineReady ? '完整可发出' : '待复核'}</dd></div>
            <div><dt>风险项</dt><dd>{activeBatch.manifest ? diverged.length : batchDocs.filter((d) => !docBaseline(activeBatch, d).ready).length}</dd></div>
          </dl>
          {!activeBatch.manifest && !baselineReady && (
            <div className="summary-note"><AlertTriangle size={15} /><span>发布基线不完整，存在未重新确认或质检未通过的文档，不能出清单。</span></div>
          )}
          {activeBatch.manifest && diverged.length > 0 && (
            <div className="summary-note diverge"><AlertTriangle size={15} /><span>冻结清单与当前内容有 {diverged.length} 处分歧，影响已标出。</span></div>
          )}
          {activeBatch.manifest && diverged.length === 0 && (
            <div className="summary-note ok"><CheckCircle2 size={15} /><span>清单已冻结发出，内容未再变更。</span></div>
          )}
        </Card>
      </div>
    </div>
  );
}

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
