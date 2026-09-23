import { useRef, useState } from "react";

interface FileUploadZoneProps {
  label: string;
  hint: string;
  accept: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

export default function FileUploadZone({
  label,
  hint,
  accept,
  files,
  onChange,
  disabled,
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    const merged = [...files];
    for (const f of Array.from(incoming)) {
      if (!merged.some((x) => x.name === f.name && x.size === f.size)) {
        merged.push(f);
      }
    }
    onChange(merged);
  };

  return (
    <div
      className={`upload-zone${dragOver ? " drag-over" : ""}${disabled ? " disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!disabled) addFiles(e.dataTransfer.files);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="upload-zone-title">{label}</div>
      <div className="upload-zone-hint">{hint}</div>
      {files.length > 0 && (
        <ul className="upload-file-list">
          {files.map((f) => (
            <li key={`${f.name}-${f.size}`}>
              <span>{f.name}</span>
              <button
                type="button"
                className="link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(files.filter((x) => x !== f));
                }}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
