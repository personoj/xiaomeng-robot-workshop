// Live-region content changes only for a new semantic message, not every SSE
// animation sample. Keeping the existing text node also avoids needless churn.
export function setTextIfChanged(element, value) {
  const text = String(value ?? "");
  if (element.textContent !== text) element.textContent = text;
}
