interface ContinueBarProps {
  count: number;
  onSkip: () => void;
  onContinue: () => void;
}

export function ContinueBar({ count, onSkip, onContinue }: ContinueBarProps) {
  return (
    <div className="bar-wrap">
      <div className="bar">
        <button type="button" className="skip" onClick={onSkip}>
          No thanks, continue
        </button>
        {/* aria-label pins the accessible name to "Continue" so this button's name
            doesn't collide with a product card's "Added ✓" button once the visible
            label becomes "Continue (N added)" — both would otherwise match /added/i. */}
        <button type="button" className="continue" aria-label="Continue" onClick={onContinue}>
          {count > 0 ? `Continue (${count} added)` : 'Continue'}
        </button>
      </div>
    </div>
  );
}
