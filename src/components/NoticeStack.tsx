import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useDisclosureStore } from '../store';

const toneMeta = {
  info: { Icon: Info, cls: 'notice info' },
  success: { Icon: CheckCircle2, cls: 'notice success' },
  warning: { Icon: AlertTriangle, cls: 'notice warning' },
  danger: { Icon: XCircle, cls: 'notice danger' }
};

export function NoticeStack() {
  const notices = useDisclosureStore((s) => s.notices);
  const dismiss = useDisclosureStore((s) => s.dismissNotice);
  if (!notices.length) return null;
  return (
    <div className="notice-stack">
      {notices.map((n) => {
        const { Icon, cls } = toneMeta[n.tone];
        return (
          <div key={n.id} className={cls} role="status">
            <Icon size={16} />
            <span>{n.text}</span>
            <button onClick={() => dismiss(n.id)} aria-label="关闭"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
