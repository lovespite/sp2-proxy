export class BlockMap<TValue> {
  private readonly _map = new Map<string, TValue>();
  private readonly _maxPoolSize: number;

  public onItemQueued?: (item: TValue, sender: BlockMap<TValue>) => boolean;
  public onFull?: (item: TValue, sender: BlockMap<TValue>) => void;

  public constructor(maxPoolSize: number) {
    this._maxPoolSize = maxPoolSize;
  }

  public get length() {
    return this._map.size;
  }

  public get isEmpty() {
    return this._map.size === 0;
  }

  private _destroyed = false;

  public destroy() {
    this.onItemQueued = null;
    this.onFull = null;

    this._map.clear();

    this._destroyed = true;
  }

  public set(key: string, value: TValue) {
    if (this._destroyed) throw new Error("destroyed");

    // if the onItemQueued callback returns false, do not enqueue the item
    if (this.onItemQueued && !this.onItemQueued(value, this)) return;

    this._map.set(key, value);

    // when the queue is full, remove the first element
    if (this._map.size > this._maxPoolSize) {
      const firstKey = this._map.keys().next().value;
      const firstValue = this._map.get(firstKey);
      this._map.delete(firstKey);
      if (this.onFull) this.onFull(firstValue, this);
    }
  }

  public tryGet(key: string) {
    return this._map.get(key);
  }

  public async get(key: string, timeout: number = 5000) {
    const now = Date.now();

    while (!this._map.has(key)) {
      if (Date.now() - now > timeout) throw new MapTimeoutError();

      await this.wait(50);
    }

    return this._map.get(key);
  }

  public delete(key: string) {
    this._map.delete(key);
  }

  private async wait(timeout: number) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
  }
}

export class MapTimeoutError extends Error {
  public constructor() {
    super("Timeout");
  }
}
