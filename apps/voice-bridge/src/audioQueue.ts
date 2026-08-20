export class BoundedAsyncQueue<T> {
  readonly capacity: number;
  droppedCount = 0;

  private readonly items: T[] = [];
  private readonly waiters: Array<(value: T | undefined) => void> = [];
  private closed = false;

  constructor(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error("Queue capacity must be a positive integer");
    }
    this.capacity = capacity;
  }

  get size(): number {
    return this.items.length;
  }

  push(value: T): boolean {
    if (this.closed) {
      return false;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(value);
      return true;
    }
    if (this.items.length === this.capacity) {
      this.items.shift();
      this.droppedCount += 1;
    }
    this.items.push(value);
    return true;
  }

  shift(): Promise<T | undefined> {
    const value = this.items.shift();
    if (value !== undefined) {
      return Promise.resolve(value);
    }
    if (this.closed) {
      return Promise.resolve(undefined);
    }
    return new Promise<T | undefined>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter(undefined);
    }
  }
}
