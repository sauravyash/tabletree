export interface SizeOption {
  key: string;
  label: string;
  sub?: string;
  dotSize?: number;
}

interface SizeSelectorProps {
  kind: 'tt' | 'box';
  options: SizeOption[];
  selected: string;
  onSelect: (key: string) => void;
}

export function SizeSelector({ kind, options, selected, onSelect }: SizeSelectorProps) {
  return (
    <div className="sizes">
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`size-btn ${kind}`}
          aria-pressed={opt.key === selected}
          onClick={() => onSelect(opt.key)}
        >
          {kind === 'tt' ? (
            <>
              <span className="dot" style={{ width: opt.dotSize, height: opt.dotSize }} />
              <span className="name">{opt.label}</span>
            </>
          ) : (
            <>
              <span className="name">{opt.label}</span>
              {opt.sub ? <span className="sub">{opt.sub}</span> : null}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
