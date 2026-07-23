/**
 * What a confirmation dialog asks. Rendered by <ConfirmDialog>, produced by
 * helpers like closeWindowConfirm() or inline at a call site.
 */
export interface ConfirmSpec {
  title: string;
  /** The consequence of confirming, in a sentence. */
  body: string;
  /** Label of the destructive action button (e.g. "Delete", "Quit"). */
  confirmLabel: string;
}
