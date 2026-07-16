/**
 * Small generation guard for client-side requests that can overlap.
 * Only the most recently started request is allowed to commit UI state.
 */
export class LatestRequestGuard {
  private generation = 0;

  begin() {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(requestId: number) {
    return requestId === this.generation;
  }

  invalidate() {
    this.generation += 1;
  }
}
