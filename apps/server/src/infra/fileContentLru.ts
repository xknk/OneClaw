/**
 * read_file 小型 LRU：降低重复读盘（optimize §3）
 */
type Entry = { content: string; at: number };

export class FileContentLru {
    private readonly maxEntries: number;
    private readonly map = new Map<string, Entry>();

    constructor(maxEntries: number) {
        this.maxEntries = Math.max(4, maxEntries);
    }

    get(key: string): string | undefined {
        const e = this.map.get(key);
        if (!e) return undefined;
        e.at = Date.now();
        this.map.set(key, e);
        return e.content;
    }

    set(key: string, content: string): void {
        this.map.set(key, { content, at: Date.now() });
        while (this.map.size > this.maxEntries) {
            let oldestK: string | undefined;
            let oldestT = Infinity;
            for (const [k, v] of this.map) {
                if (v.at < oldestT) {
                    oldestT = v.at;
                    oldestK = k;
                }
            }
            if (oldestK) this.map.delete(oldestK);
            else break;
        }
    }
}
