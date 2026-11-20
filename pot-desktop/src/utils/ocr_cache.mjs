// One short-lived successful image per window; failures and empty detections are never cached.
// Subscribers share an in-flight job, but cancelling one view cannot cancel another active view.
export function createOcrRecognizer(run, { now = Date.now, ttlMs = 120000 } = {}) {
    let cached = null;
    const pending = new Set();
    const same = (entry, image, key) => entry.image === image && entry.key === key;
    return async (image, config, isCurrent = () => true) => {
        const key = JSON.stringify(config);
        if (!isCurrent()) throw new Error('已取消文字识别。');
        if (cached && (cached.until <= now() || cached.key !== key)) cached = null;
        if (cached && same(cached, image, key)) return cached.result;
        let entry = [...pending].find((item) => same(item, image, key) && [...item.users].some((active) => active()));
        const subscriber = () => isCurrent();
        if (!entry) {
            entry = { image, key, users: new Set([subscriber]) };
            pending.add(entry);
            entry.promise = Promise.resolve()
                .then(() => run(image, config, () => [...entry.users].some((active) => active())))
                .then((result) => {
                    if (result.text?.trim() && [...entry.users].some((active) => active())) {
                        cached = { image, key, result, until: now() + ttlMs };
                    }
                    return result;
                })
                .finally(() => pending.delete(entry));
        } else entry.users.add(subscriber);
        try {
            const result = await entry.promise;
            if (!isCurrent()) throw new Error('已取消文字识别。');
            return result;
        } finally {
            entry.users.delete(subscriber);
        }
    };
}
