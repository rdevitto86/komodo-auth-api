export function omit(obj, keys) {
    const keySet = new Set(keys);
    return Object.fromEntries(Object.entries(obj).filter(([k]) => !keySet.has(k)));
}
export function pick(obj, keys) {
    const result = {};
    for (const key of keys) {
        if (key in obj)
            result[key] = obj[key];
    }
    return result;
}
export function groupBy(arr, key) {
    const result = {};
    for (const item of arr) {
        const k = key(item);
        const group = result[k];
        if (group !== undefined) {
            group.push(item);
        }
        else {
            result[k] = [item];
        }
    }
    return result;
}
export function deepMerge(target, source) {
    const output = { ...target };
    const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        const tgtVal = output[key];
        if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
            output[key] = deepMerge(tgtVal, srcVal);
        }
        else if (srcVal !== undefined) {
            output[key] = srcVal;
        }
    }
    return output;
}
export const shallowCopy = (obj) => ({ ...obj });
export const deepCopy = (obj) => JSON.parse(JSON.stringify(obj));
//# sourceMappingURL=objects.js.map