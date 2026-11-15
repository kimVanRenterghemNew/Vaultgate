// Een secret hernoemen, of er een domein bij zetten. Bij hernoemen gaan toekenningen, routes en blokkades mee
// (stilgezette meldingen gaan per toekenning-id en blijven kloppen), zodat er niets stilletjes ophoudt te werken of open
// komt te staan. De waarde blijft waar ze is. Deel van de registry.

/** @param {{ vault, clock, all: Function, must: Function, checkName: Function, tagged: Function, duplicate: string, getSettings: Function, updateSettings: Function }} deps */
export function createRename({ vault, clock, all, must, checkName, tagged, duplicate, getSettings, updateSettings }) {
    /** Hernoemt secret `id` naar `name`; een naam die al bestaat MOET geweigerd worden. */
    async function renameSecret(id, name) {
        checkName(name);
        const current = await must('secret', id);
        const old = current.name;
        if (name === old) return id;
        if ((await all('secret', ['name'])).some(s => s.name === name)) throw tagged(duplicate, `secret ${name} exists`);
        for (const g of await all('grant', ['secretName'])) {
            if (g.secretName === old) await vault.put({ ...(await must('grant', g.id)), secretName: name }, g.id);
        }
        const s = await getSettings();
        const move = x => (x.secretName === old ? { ...x, secretName: name } : x);
        await updateSettings({
            routes: s.routes.map(r => (r.secret === old ? { ...r, secret: name } : r)),
            blocks: s.blocks.map(move),
        });
        return vault.put({ ...current, name, updatedAt: clock.now() }, id);
    }
    /** Een domein bij een secret (ja op een nieuw subdomein): het komt bij de domeinen, zoals een chip in Edit. */
    async function addSecretHost(name, host) {
        const id = (await all('secret', ['name'])).find(s => s.name === name)?.id;
        const current = await must('secret', id);
        if (!current.hosts.includes(host)) await vault.put({ ...current, hosts: [...current.hosts, host], updatedAt: clock.now() }, id);
    }
    return Object.freeze({ renameSecret, addSecretHost });
}
