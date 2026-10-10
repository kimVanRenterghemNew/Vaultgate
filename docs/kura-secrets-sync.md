# Kura secrets synchronisatie

Vaultgate synchroniseert alleen gegenereerde `KuraKeys/`-bestanden nadat de
pipeline van `kura-secrets` een `repository_dispatch` verstuurt voor een tag
die op `main` staat.

## Eenmalige configuratie

1. Maak in Vaultgate een repository secret `KURA_SECRETS_TOKEN`. Deze token
   moet `Contents: read` hebben op `kura-secrets`.
2. Geef de pipeline van `kura-secrets` een token met `Actions: write` op
   Vaultgate (een fine-grained PAT of GitHub App-token).
3. Laat de release-stap van `kura-secrets` na het maken van de tag dit event
   versturen:

```sh
gh api repos/<owner>/Vaultgate/dispatches \
  -f event_type=kura-secrets-release \
  -f 'client_payload[source_repository]=<owner>/kura-secrets' \
  -f 'client_payload[source_branch]=main' \
  -f "client_payload[source_ref=refs/tags/${TAG}" \
  -f "client_payload[source_ref_name=${TAG}"
```

De workflow controleert bovendien dat de tag een ancestor van `main` is.
Events voor branches, niet-release tags of andere repositories worden
genegeerd. De token en de bronbestanden worden niet naar de workflow-log
geschreven.
