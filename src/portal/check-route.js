import { decideAccess } from '../policy/index.js';

export function checkRoute({ registry, policy, httpError }) {
    return ['POST', /^\/api\/check$/, 'unlocked', async ({ body }) => {
        const tool = (await registry.listTools()).find(t => t.id === body.toolId);
        if (!tool) throw httpError('NOT_FOUND', 'unknown tool');
        const secret = await registry.findSecret(body.secretName);
        const target = new URL(secret ? `${secret.hosts[0].origin}${secret.hosts[0].pathPrefix}` : 'https://unknown.invalid/');
        const grant = secret ? await registry.findGrant(tool.id, secret.name, target.origin) : null;
        const granted = Boolean(grant) && !grant.expired && grant.mode !== 'confirm';
        const decision = decideAccess({
            vaultUnlocked: true,
            tool,
            client: '127.0.0.1',
            secret: { name: body.secretName, hosts: secret?.hosts ?? null },
            target,
            granted,
            ...policy.checkContext({ toolId: tool.id, secretName: body.secretName, host: target.origin }),
        });
        return { rule: decision.rule, host: secret ? target.origin : null };
    }];
}
