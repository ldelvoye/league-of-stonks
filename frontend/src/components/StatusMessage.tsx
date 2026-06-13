interface StatusMessageProps {
  text: string;
  variant: "error" | "loading" | "info";
  loadingWidget?: "spinner" | "lp-bar";
}

export function StatusMessage({ text, variant, loadingWidget = "spinner" }: StatusMessageProps) {
  const className =
    variant === "error"
      ? "message is-error"
      : variant === "loading"
        ? `message is-loading${loadingWidget === "lp-bar" ? " is-lp-loading" : ""}`
        : "message";

  if (variant === "loading") {
    const widget =
      loadingWidget === "lp-bar" ? (
        <span className="lp-loading" aria-hidden="true">
          <span className="lp-loading-track" />
          <span className="lp-loading-pips">
            <span />
            <span />
            <span />
            <span />
            <span />
          </span>
        </span>
      ) : (
        <span className="hextech-spinner" aria-hidden="true">
          <span className="hextech-spinner-inner" />
        </span>
      );

    return (
      <div className={className} role="status" aria-live="polite">
        {widget}
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
