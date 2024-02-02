export class BlockQueue<T> {
  private readonly _queue: T[] = [];
  private readonly _maxPoolSize: number;

  public onEmpty?: (sender: BlockQueue<T>) => void;
  public onFull?: (item: T, sender: BlockQueue<T>) => void;
  public onItemQueued?: (item: T, sender: BlockQueue<T>) => boolean;

  public constructor(maxPoolSize: number) {
    this._maxPoolSize = maxPoolSize;
  }

  public get length() {
    return this._queue.length;
  }

  private _destroyed = false;

  public destroy() {
    this.onEmpty = null;
    this.onFull = null;
    this.onItemQueued = null;

    this._queue.length = 0;

    this._destroyed = true;
  }

  public get isEmpty() {
    return this._queue.length === 0;
  }

  public enqueue(value: T) {
    if (this._destroyed) throw new Error("destroyed");

    // if the onItemQueued callback returns false, do not enqueue the item
    if (this.onItemQueued && !this.onItemQueued(value, this)) return;

    this._queue.push(value);

    // when the queue is full, remove the first element
    if (this._queue.length > this._maxPoolSize) {
      const item = this.dequeue();
      if (this.onFull) this.onFull(item, this);
    }
  }

  private dequeue() {
    const item = this._queue.shift();

    if (this.isEmpty && this.onEmpty) this.onEmpty(this);

    return item;
  }

  public async pull(timeout: number = 5000): Promise<T> {
    if (this._destroyed) throw new Error("destroyed");

    const now = Date.now();
    while (this.isEmpty) {
      if (Date.now() - now > timeout) throw new QueueTimeoutError();

      await this.wait(50);
    }

    const popup = this.dequeue();
    if (popup === undefined) throw new QueueTimeoutError();

    return popup;
  }

  private async wait(timeout: number) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }
}

export class QueueTimeoutError extends Error {
  public constructor() {
    super("Timeout");
  }
}
