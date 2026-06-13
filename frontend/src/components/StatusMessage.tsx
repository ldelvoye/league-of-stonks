interface StatusMessageProps {
  text: string;
  variant: "error" | "loading" | "info";
}

export function StatusMessage({ text, variant }: StatusMessageProps) {
  const className =
    variant === "error"
      ? "message is-error"
      : variant === "loading"
        ? "message is-loading"
        : "message";

  if (variant === "loading") {
    return (
      <div className={className} role="status" aria-live="polite">
        <span className="spinner" />
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div className={className} role="status" aria-live="polite">
      {text}
    </div>
  );
}
