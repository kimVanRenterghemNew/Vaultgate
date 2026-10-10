# Vaultgate

## Voorstel: synchronisatie met `kura-secrets`

Er wordt momenteel niets uitgevoerd of gesynchroniseerd. De voorgestelde
flow is:

- `kimVanRenterghemNew/kura-secrets` blijft de bron.
- Alleen een release-tag die op `main` staat mag een synchronisatie starten.
- De gegenereerde `KuraKeys/`-bestanden zouden daarna naar Vaultgate kunnen
  worden overgezet.
- Hiervoor zijn een read-token voor `kura-secrets` en een dispatch-token voor
  Vaultgate nodig.

De pipeline kan dit later melden met een `repository_dispatch`:

```sh
gh api repos/kimVanRenterghemNew/Vaultgate/dispatches \
  -f event_type=kura-secrets-release \
  -f 'client_payload[source_repository]=kimVanRenterghemNew/kura-secrets' \
  -f 'client_payload[source_branch]=main' \
  -f "client_payload[source_ref]=refs/tags/${TAG}" \
  -f "client_payload[source_ref_name]=${TAG}"
```

De daadwerkelijke workflow wordt pas toegevoegd na expliciete goedkeuring.
