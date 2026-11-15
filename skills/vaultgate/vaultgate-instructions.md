# Vaultgate Policy

Een request die een secret nodig heeft, gaat via de vaultgate-tool `http_request` met `{{secret:naam}}`; vraag de gebruiker nooit om een sleutel en zet er nooit een in een bestand, commando of prompt.

- Gebruik altijd de MCP-tool `http_request` voor uitgaande netwerkaanroepen die geheimen vereisen.
- Vraag de gebruiker nooit om geheime waarden of API-sleutels rechtstreeks te typen of in te voeren.
- Verwijs bij weigeringen (zoals `target-host-not-allowed`) naar het Vaultgate beheerportaal om de gewenste host toe te staan.
