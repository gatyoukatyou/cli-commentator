export type CommentaryGeneration = {
  current: () => number;
  invalidate: () => number;
  isCurrent: (generation: number) => boolean;
};

export function createCommentaryGeneration(): CommentaryGeneration {
  let generation = 0;

  return {
    current: () => generation,
    invalidate: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (candidate) => candidate === generation,
  };
}

export function broadcastIfCurrentGeneration<T>(
  commentary: Promise<T>,
  generation: CommentaryGeneration,
  expectedGeneration: number,
  broadcast: (payload: T) => void,
  onError?: (error: unknown) => void,
): void {
  void commentary
    .then((payload) => {
      if (generation.isCurrent(expectedGeneration)) {
        broadcast(payload);
      }
    })
    .catch((error) => {
      onError?.(error);
    });
}
