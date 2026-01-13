/**
 * Comment error codes for classification
 */
export type CommentErrorCode = "comment_timeout" | "comment_aborted" | "comment_llm_error";

/**
 * Typed error for comment generation failures
 */
export class CommentError extends Error {
  constructor(
    public readonly code: CommentErrorCode,
    message?: string
  ) {
    super(message ?? code);
    this.name = "CommentError";
  }
}
