# WFRP4e: Reguły zarobku (`wfrp4e-income-scaler`)

Moduł do **Foundry VTT** dla systemu **Warhammer Fantasy Roleplay 4e**. Daje MG kontrolę nad
zarobkiem („zarobek") liczonym przez system — regułami domowymi.

## Instalacja

W Foundry: **Setup → Moduły dodatkowe → Zainstaluj moduł**, w polu *Adres URL manifestu* wklej:

```
https://github.com/Ilinar/wfrp4e-income-scaler/releases/latest/download/module.json
```

Nowe wersje pojawiają się potem przy **Sprawdź aktualizacje** na liście modułów.

## Co potrafi

1. **Mnożnik / dzielnik** — skaluje bazowy zarobek. Przykład: zarobek dzienny **6× mniejszy** → mnożnik 1, dzielnik 6.
2. **Modyfikator za PS (poziom sukcesu)** — tryb **liniowy**: **sukces** = +5% za każdy dodatni PS;
   **porażka** = −25% (kara bazowa) − 10% za każdy |PS| (np. PS 0 = −25%, PS −1 = −35%, PS −3 = −55%).
   Procenty edytowalne, dolny limit 0. Zastępuje natywną regułę pełny/połowa/zero. Dostępny też tryb **natywny**.
3. **Przeliczanie na pensy** — wynik liczony i zaokrąglany w pensach (mosiądzu); wypłata w mosiądzu, podgląd pokazuje
   też ile to złotych/srebrnych. Można potem skonsolidować monety na karcie.
4. **Podgląd obliczeń** — osobna wiadomość: rzut (np. „8k10 = 37") → ×współczynnik → ×PS% → wynik w pensach.
   Domyślnie **szept do gracza-właściciela i MG**; widoczność do zmiany w ustawieniach.
5. **Przycisk „Zastosuj zarobek"** — na karcie wyniku dodaje kasę na kartę postaci jednym kliknięciem (zamiast
   przeciągania), na wzór przycisków odpoczynku/leczenia. Widoczny tylko dla właściciela; po użyciu blokuje się
   („Zastosowano"), więc nie da się dodać podwójnie.
6. **Talenty Majętny i Przestępca** — doliczane do **bazowego** dochodu (więc skalowane ÷ i PS): Majętny +1 zk za
   rangę; Przestępca wg poziomu kariery (rzut) × rangi. (W czystym systemie te talenty nie wpływają na zarobek —
   Majętny nie ma skryptu, a trigger Przestępcy nie jest wywoływany.)
7. **Granulacja ćwierćpensa (opcjonalnie)** — zaokrąglanie do 0,25 zamiast pełnego pensa; ułamek wyrażany **tylko w
   ćwierćpensach** (0,5 = dwa ćwierćpensy, np. 1,5 = 1 pens + 2 ćwierci). Przy włączonej granulacji przycisk „Zastosuj
   zarobek" dodaje ćwierćpensy (jeśli masz taką monetę na karcie). Wykrywa monetę po wartości **0,25**, więc możesz ją
   nazwać dowolnie (np. „Okrawki"). Brak monety → zaokrąglenie do pensa.

Obejmuje zarobek z **karty postaci** oraz z modułu **`wfrp4e-downtime-timeline`** (wspólna ścieżka testu),
a płaski mnożnik/dzielnik także bezpośrednie „Roll Income" (BN / okno Rynku).

## Bezpieczeństwo

- Nakłada się przez **lib-wrapper**, jeśli jest aktywny (standard, odporne na konflikty); w razie jego braku —
  ręczny fallback. **Nie wymaga** instalacji dodatkowych modułów.
- Natywna funkcja systemu jest wołana **najpierw**; przy wyłączeniu modułu lub błędzie zostaje poprawny wynik
  systemowy — zarobek nigdy się nie psuje.
- Włącznik **„Włącz reguły zarobku"** w każdej chwili przywraca zachowanie czystego systemu.

## Ustawienia (Konfiguracja → Ustawienia modułu; zasięg świata / MG)

| Ustawienie | Domyślnie | Opis |
|---|---|---|
| Włącz reguły zarobku | wł. | Wyłączone → liczenie jak w czystym systemie. |
| Mnożnik | 1 | Licznik współczynnika. |
| Dzielnik | 1 | Mianownik (≤ 0 traktowane jak 1). |
| Reguła PS | Liniowo | „Liniowo (% za PS)" lub „Natywnie (pełny/połowa/zero)". |
| % za dodatni PS (sukces) | 5 | Tryb liniowy: bonus za każdy dodatni PS. |
| % za ujemny PS (porażka) | 10 | Tryb liniowy: dodatkowa kara za każdy \|PS\| przy porażce. |
| Kara za porażkę (%) | 25 | Tryb liniowy: bazowa kara za nieudany test (dolny limit wyniku = 0). |
| Minimum 1 pens przy sukcesie | wł. | Sukces nie wypłaci 0 przez agresywne skalowanie. |
| Widoczność podglądu | Gracz + MG | Gracz (właściciel) + MG / tylko MG / publicznie / nie pokazuj. |
| Przycisk „Zastosuj zarobek" | wł. | Dodaje na karcie wyniku przycisk dodający kasę jednym kliknięciem. |
| Bonusy z talentów | wł. | Dolicza Majętny (+1 zk/rangę) i Przestępcę (poziom kariery × rangi) do bazy. |
| Granulacja zaokrąglania | Pełny pens | „Pełny pens (1)" lub „Ćwierćpens (0,25)" (wymaga monet sub-pens na karcie). |

## Kompatybilność

- Foundry VTT v12–v14, system `wfrp4e` (testowane na 9.5.0).

---

## English (summary)

House-rules for WFRP4e income: multiplier/divisor scaling, a per-SL modifier (linear: +5% per positive SL,
−10% per negative SL; replaces the native full/half/zero rule), pennies-based rounding, and a calculation
breakdown whispered to the actor's owner and the GM (configurable). Applies to character-sheet income and the
`wfrp4e-downtime-timeline` module; the flat multiplier/divisor also covers direct "Roll Income". Wraps via
lib-wrapper when active (manual fallback otherwise); native function runs first, so disabling the module or any
error safely falls back to vanilla income. Foundry v12–v14.

## Zastrzeżenie

Nieoficjalny moduł fanowski, niezwiązany z Games Workshop ani Cubicle 7. Warhammer Fantasy Roleplay jest znakiem towarowym Games Workshop Ltd.
