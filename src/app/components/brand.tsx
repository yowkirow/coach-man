/** CoachMan mark: a lime pickleball with its perforations (echoes the reference's lime logo mark). */
export function BallMark({
  className = "size-9",
  holes = "#0e0e0f",
}: {
  className?: string;
  holes?: string;
}) {
  const dots = [
    [16, 7.2],
    [9.6, 10.6],
    [22.4, 10.6],
    [16, 16],
    [8.4, 18.4],
    [23.6, 18.4],
    [12, 24.4],
    [20, 24.4],
  ];
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <circle cx="16" cy="16" r="15" fill="#daee63" />
      {dots.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" fill={holes} />
      ))}
    </svg>
  );
}

export function Wordmark({ className = "", dark = false }: { className?: string; dark?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <BallMark className="size-9" holes={dark ? "#0e0e0f" : "#111111"} />
      <span
        className={`text-[1.375rem] font-medium tracking-[-0.02em] ${dark ? "text-night-ink" : "text-ink"}`}
      >
        CoachMan
      </span>
    </span>
  );
}
