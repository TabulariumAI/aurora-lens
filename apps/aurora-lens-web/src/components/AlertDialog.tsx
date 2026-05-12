import { useId } from "react";

interface AlertDialogProps {
  message: string;
  title: string;
  onOk: () => void;
}

export function AlertDialog({ message, title, onOk }: AlertDialogProps) {
  const titleId = useId();

  return (
    <div className="alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="alert-dialog">
        <h2 id={titleId}>{title}</h2>
        <p>{message}</p>
        <button type="button" onClick={onOk}>OK</button>
      </div>
    </div>
  );
}
