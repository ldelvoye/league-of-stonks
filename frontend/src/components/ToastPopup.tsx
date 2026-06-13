import { useToast } from "../state/ToastContext";

export function ToastPopup() {
  const { toastMessage, hideToast } = useToast();
  if (!toastMessage) return null;

  return (
    <div
      className="toast-popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="toast-popup-message"
      onClick={(event) => {
        if (event.target === event.currentTarget) hideToast();
      }}
    >
      <div className="toast-popup-card">
        <p className="toast-popup-kicker" aria-hidden="true">
          Summoner Alert
        </p>
        <p id="toast-popup-message" className="toast-popup-text">
          {toastMessage}
        </p>
        <button className="btn btn-primary toast-popup-dismiss" type="button" onClick={hideToast}>
          OK
        </button>
      </div>
    </div>
  );
}
