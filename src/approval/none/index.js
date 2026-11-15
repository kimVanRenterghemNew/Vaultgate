// Notifier zonder tray (bv. Linux, of een proces zonder bureaublad): niemand kan goedkeuren, dus elke nieuwe combinatie
// krijgt 'unavailable' (503 approval-unavailable). Standaard dicht: toekenningen kunnen alleen via het portaal.
export function createNoNotifier() {
    return Object.freeze({ ask: async () => 'unavailable' });
}
