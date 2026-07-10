interface HandleToggleProps {
  on: boolean;
  onToggle: () => void;
}

export function HandleToggle({ on, onToggle }: HandleToggleProps) {
  return (
    <div className="handle-row">
      <span className="handle-label">Add a handle</span>
      <button
        type="button"
        className="toggle"
        aria-pressed={on}
        aria-label="Add a handle"
        onClick={onToggle}
      >
        <span className="knob" />
      </button>
    </div>
  );
}
