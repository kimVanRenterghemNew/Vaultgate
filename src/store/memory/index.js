// In-memory store (tests, en een kluis die nooit de schijf mag raken). Zelfde contract als ./local.
import { checkName, quarantineName } from '../index.js';

export function createMemoryStore() {
    const files = new Map();
    let seq = 0;
    return Object.freeze({
        read: async name => { checkName(name); return files.has(name) ? Buffer.from(files.get(name)) : null; },
        write: async (name, data) => { checkName(name); files.set(name, Buffer.from(data)); },
        append: async (name, data) => { checkName(name); files.set(name, Buffer.concat([files.get(name) ?? Buffer.alloc(0), data])); },
        list: async prefix => [...files.keys()].filter(name => name.startsWith(prefix)).sort(),
        remove: async name => { checkName(name); files.delete(name); },
        quarantine: async name => {
            checkName(name);
            const target = quarantineName(name, `${Date.now()}-${seq++}`);
            files.set(target, files.get(name) ?? Buffer.alloc(0));
            files.delete(name);
            return target;
        },
    });
}
