export class BlockQueue<T> {
  private readonly _queue: T[] = [];
  private readonly _maxPoolSize: number;

  public constructor(maxPoolSize: number) {
    this._maxPoolSize = maxPoolSize;
  }

  public get length() {
    return this._queue.length;
  }

  public get isEmpty() {
    return this._queue.length === 0;
  }

  public enqueue(value: T) {
    this._queue.push(value);

    // when the queue is full, remove the first element
    if (this._queue.length > this._maxPoolSize) this.dequeue();
  }

  private dequeue() {
    return this._queue.shift();
  }

  public async pull(timeout: number = 5000): Promise<T> {
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
    return new Promise(resolve => setTimeout(resolve, timeout));
  }
}

export class QueueTimeoutError extends Error {
  public constructor() {
    super("Timeout");
  }
}
