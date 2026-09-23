interface ConfirmLine {
  variant: "before" | "after";
  label: string;
  absolutePath: string;
  csvCount: number;
}

interface Props {
  lines: ConfirmLine[];
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LuceSourceConfirmDialog({
  lines,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      className="luce-source-dialog-backdrop"
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="luce-source-dialog"
        role="dialog"
        aria-labelledby="luce-source-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="luce-source-dialog-title">使用目录下的路测数据？</h3>
        <p className="luce-source-dialog-lead">
          以下数据集未从本地上传，将改为从默认样例目录导入。取消可返回继续上传。
        </p>
        <ul className="luce-source-dialog-list">
          {lines.map((line) => (
            <li key={line.variant}>
              <strong>{line.label}</strong> 将使用目录下 {line.csvCount} 个 CSV：
              <code>{line.absolutePath}</code>
            </li>
          ))}
        </ul>
        <div className="luce-source-dialog-actions">
          <button type="button" className="ghost-btn" onClick={onCancel}>
            取消，继续上传
          </button>
          <button type="button" className="primary-btn" onClick={onConfirm}>
            确认，使用目录数据
          </button>
        </div>
      </div>
    </div>
  );
}
