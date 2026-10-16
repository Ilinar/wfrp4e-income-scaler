// WFRP4e: Reguły zarobku (skalowanie, PS, talenty, pensy/ćwierćpens, podgląd)
// v1.3.0
//
// Dwie nakładki (lib-wrapper, z ręcznym fallbackiem):
//  1) game.wfrp4e.market.rollIncome  — mnoży bazowy zarobek przez współczynnik
//     (mnożnik/dzielnik) i zapamiętuje rzut. Pokrywa też ścieżki spoza testu (BN/Rynek).
//  2) TestWFRP.prototype.handleIncomeTest — po wykonaniu natywnej metody koryguje
//     wynik: modyfikator PS (liniowy/natywny) → przeliczenie na pensy → podgląd.
// Natywna metoda jest wołana NAJPIERW, więc przy wyłączeniu/błędzie zostaje poprawny
// wynik systemowy (zarobek nigdy się nie psuje).

const MODULE_ID = "wfrp4e-income-scaler";
const TIER_BP = { b: 1, s: 12, g: 240 }; // ile pensów (mosiądza) za 1 monetę poziomu

const loc = (k) => game.i18n.localize(k);

/* -------------------------------------------- */
/*  Ustawienia (świat, GM)                      */
/* -------------------------------------------- */
Hooks.once("init", () => {
  const reg = (key, data) =>
    game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });

  reg("enabled", { name: "WIS.Settings.Enabled.Name", hint: "WIS.Settings.Enabled.Hint", type: Boolean, default: true });
  reg("multiplier", { name: "WIS.Settings.Multiplier.Name", hint: "WIS.Settings.Multiplier.Hint", type: Number, default: 1 });
  reg("divisor", { name: "WIS.Settings.Divisor.Name", hint: "WIS.Settings.Divisor.Hint", type: Number, default: 1 });
  reg("slMode", {
    name: "WIS.Settings.SLMode.Name", hint: "WIS.Settings.SLMode.Hint", type: String, default: "linear",
    choices: { linear: "WIS.Settings.SLMode.Linear", native: "WIS.Settings.SLMode.Native" },
  });
  reg("slPlusPct", { name: "WIS.Settings.SLPlus.Name", hint: "WIS.Settings.SLPlus.Hint", type: Number, default: 5 });
  reg("slMinusPct", { name: "WIS.Settings.SLMinus.Name", hint: "WIS.Settings.SLMinus.Hint", type: Number, default: 10 });
  reg("failPenaltyPct", { name: "WIS.Settings.FailPenalty.Name", hint: "WIS.Settings.FailPenalty.Hint", type: Number, default: 25 });
  reg("minOneOnSuccess", { name: "WIS.Settings.MinOne.Name", hint: "WIS.Settings.MinOne.Hint", type: Boolean, default: true });
  reg("breakdownVisibility", {
    name: "WIS.Settings.Visibility.Name", hint: "WIS.Settings.Visibility.Hint", type: String, default: "playerGM",
    choices: {
      playerGM: "WIS.Settings.Visibility.PlayerGM",
      gm: "WIS.Settings.Visibility.GM",
      public: "WIS.Settings.Visibility.Public",
      off: "WIS.Settings.Visibility.Off",
    },
  });
  reg("applyButton", { name: "WIS.Settings.ApplyButton.Name", hint: "WIS.Settings.ApplyButton.Hint", type: Boolean, default: true });
  reg("talentBonuses", { name: "WIS.Settings.TalentBonuses.Name", hint: "WIS.Settings.TalentBonuses.Hint", type: Boolean, default: true });
  reg("pennyGranularity", {
    name: "WIS.Settings.PennyGranularity.Name", hint: "WIS.Settings.PennyGranularity.Hint", type: String, default: "whole",
    choices: { whole: "WIS.Settings.PennyGranularity.Whole", quarter: "WIS.Settings.PennyGranularity.Quarter" },
  });
});

/* -------------------------------------------- */
/*  Pomocnicze                                  */
/* -------------------------------------------- */
/** Współczynnik = mnożnik / dzielnik, z zabezpieczeniami (dzielnik ≤ 0 → 1). */
function getFactor() {
  let m = Number(game.settings.get(MODULE_ID, "multiplier"));
  let d = Number(game.settings.get(MODULE_ID, "divisor"));
  if (!Number.isFinite(m) || m < 0) m = 1;
  if (!Number.isFinite(d) || d <= 0) d = 1;
  const f = m / d;
  return Number.isFinite(f) && f >= 0 ? f : 1;
}

/**
 * Mnożnik z PS (liniowy). Zwraca null, gdy tryb 'native' (użyj reguły systemu).
 * Sukces: +slPlusPct% za każdy dodatni PS. Porażka: −failPenaltyPct% (baza) − slMinusPct% za każdy |PS|.
 * Rozróżnia sukces/porażkę (nie tylko znak PS — porażka może mieć PS 0).
 */
function getSLFactor(sl, succeeded) {
  if (game.settings.get(MODULE_ID, "slMode") === "native") return null;
  const plus = Number(game.settings.get(MODULE_ID, "slPlusPct")) || 0;
  const minus = Number(game.settings.get(MODULE_ID, "slMinusPct")) || 0;
  const failPen = Number(game.settings.get(MODULE_ID, "failPenaltyPct")) || 0;
  const f = succeeded
    ? 1 + (plus / 100) * Math.max(0, sl)
    : 1 - failPen / 100 - (minus / 100) * Math.abs(sl);
  return Math.max(0, f);
}

// Pamięć ostatniego rzutu z rollIncome (testy zarobku są sekwencyjne → korelacja bezpieczna).
let _lastIncome = null;

/** Parsuje "15b" / "7.5s" / "3g" → { amount:Number, tier }. */
function parseEarned(str) {
  const s = String(str ?? "");
  const tier = s.slice(-1);
  const amount = Number(s.slice(0, -1));
  return { amount: Number.isFinite(amount) ? amount : 0, tier };
}

/** Skrót jednostki poziomu: bp / ss / gc. */
function unitAbbr(tier) {
  return tier === "g" ? "gc" : tier === "s" ? "ss" : "bp";
}

/** Skonsolidowany skrót kwoty w pensach: „2 ss, 1 bp" (pomija zera). */
function shortCoins(bp) {
  const c = game.wfrp4e?.market?.makeSomeChange?.(bp, 0) ?? { gc: 0, ss: 0, bp };
  const parts = [];
  if (c.gc) parts.push(`${c.gc} gc`);
  if (c.ss) parts.push(`${c.ss} ss`);
  if (c.bp || parts.length === 0) parts.push(`${c.bp} bp`);
  return parts.join(", ");
}

/** Liczba: max 2 miejsca po przecinku, bez końcowych zer, przecinek dziesiętny. */
function fmt(n) {
  const r = Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  return String(r).replace(".", ",");
}

/** Odmiana słowa „pens" (PL: pens/pensy/pensów; EN: penny/pennies). */
function pennyWord(n) {
  const a = Math.abs(n) % 100, b = Math.abs(n) % 10;
  if (n === 1) return loc("WIS.Unit.Penny1");
  if (b >= 2 && b <= 4 && !(a >= 12 && a <= 14)) return loc("WIS.Unit.PennyFew");
  return loc("WIS.Unit.PennyMany");
}

/* -------------------------------------------- */
/*  Granulacja i monety (z sub-pensem 0,5/0,25) */
/* -------------------------------------------- */
/** Jednostka zaokrąglenia: 0,25 (quarter) lub 1 (whole). */
function granUnit() {
  return game.settings.get(MODULE_ID, "pennyGranularity") === "quarter" ? 0.25 : 1;
}
/** Zaokrąglenie pensów wg granulacji. */
function roundGran(bpFloat) {
  return granUnit() === 0.25 ? Math.round(bpFloat * 4) / 4 : Math.round(bpFloat);
}

/** Rozkład pensów na monety: {gc, ss, bp, fa}. Ułamek wyłącznie w ćwierćpensach (półpens = 2 ćwierci). */
function coinsFromBp(bpExact) {
  const q = Math.max(0, Math.round((Number(bpExact) || 0) * 4)); // suma w ćwiartkach (0,25)
  let whole = Math.floor(q / 4);
  const fa = q % 4; // 0..3 ćwierćpensy
  const gc = Math.floor(whole / 240); whole %= 240;
  const ss = Math.floor(whole / 12); const bp = whole % 12;
  return { gc, ss, bp, fa };
}

/** Nazwa monety o danej wartości (coinValue) z karty postaci; fallback gdy brak. */
function coinNameByValue(actor, value, fallback) {
  const money = actor?.itemTypes?.money ?? actor?.itemTags?.money ?? [];
  const it = money.find?.((m) => Number(m.system?.coinValue?.value) === value);
  return it?.name ?? fallback;
}

/** Skonsolidowany skrót kwoty „2 ss, 1 bp, 2 Okrawki" (pomija zera; ćwierćpens nazwą monety z karty). */
function coinsToText(bpExact, actor) {
  const c = coinsFromBp(bpExact);
  const parts = [];
  if (c.gc) parts.push(`${c.gc} gc`);
  if (c.ss) parts.push(`${c.ss} ss`);
  if (c.bp) parts.push(`${c.bp} bp`);
  if (c.fa) parts.push(`${c.fa} ${coinNameByValue(actor, 0.25, "¼p")}`);
  return parts.length ? parts.join(", ") : "0 bp";
}

/** Kwota główna: liczba pensów + (skrót skonsolidowany) gdy ≥ 12 lub ułamkowa. */
function moneyMain(bpExact, actor) {
  const n = Number(bpExact) || 0;
  const isFrac = n % 1 !== 0;
  if (!isFrac) {
    const i = Math.round(n);
    let s = `${i} ${pennyWord(i)}`;
    if (i >= 12) s += ` (${coinsToText(i, actor)})`;
    return s;
  }
  return `${fmt(n)} ${loc("WIS.Unit.PennyMany")} (${coinsToText(n, actor)})`;
}

/** Lista id odbiorców szeptu wg ustawienia. null → nie wysyłaj, [] → publicznie. */
function whisperIds(actor) {
  const mode = game.settings.get(MODULE_ID, "breakdownVisibility");
  if (mode === "off") return null;
  if (mode === "public") return [];
  const gms = game.users.filter((u) => u.isGM);
  const owners = mode === "playerGM" && actor
    ? game.users.filter((u) => !u.isGM && actor.testUserPermission?.(u, "OWNER"))
    : [];
  return [...new Set([...gms, ...owners].map((u) => u.id))];
}

/* -------------------------------------------- */
/*  Skalowanie bazy (rollIncome)                */
/* -------------------------------------------- */
function applyIncomeScaling(res) {
  if (!game.settings.get(MODULE_ID, "enabled")) return res;
  if (res && typeof res.earned === "number") {
    const factor = getFactor();
    const factored = res.earned * factor;               // precyzyjna baza (dla ścieżki testu)
    const rounded = Math.max(0, Math.round(factored));  // całkowita liczba monet
    _lastIncome = { raw: res.earned, factor, factored, tier: res.type };
    // earned/quantity MUSZĄ być całkowite: ścieżki bez testu (BN/stworzenia/Rynek) wklejają
    // earned do napisu kwoty (`${earned}bp.`) i parsują przez creditCommand — ułamek psuje parsowanie.
    // Precyzję dla przeliczenia na pensy (ścieżka testu) trzymamy w _lastIncome.factored.
    res.earned = rounded;
    if (res.item?.system?.quantity) res.item.system.quantity.value = rounded;
  }
  return res;
}

/* -------------------------------------------- */
/*  Talenty zarobkowe (Majętny / Przestępca)    */
/* -------------------------------------------- */
// Id z kompendium rdzenia (odporne na język), + nazwy PL/EN jako fallback.
const TALENT_IDS = { wealthy: "OROfMcVqRnZHINkU", criminal: "r180vP86SlwyJc8W" };
const TALENT_NAMES = { wealthy: ["majętny", "wealthy"], criminal: ["przestępca", "criminal"] };

function findTalent(actor, key) {
  const talents = actor?.itemTypes?.talent ?? [];
  const id = TALENT_IDS[key];
  const names = TALENT_NAMES[key];
  return talents.find((t) => {
    const src = t._stats?.compendiumSource || t.flags?.core?.sourceId || "";
    if (id && typeof src === "string" && src.endsWith(id)) return true;
    return names.includes((t.name || "").toLowerCase());
  }) ?? null;
}

/** Liczba rang talentu (Advances zawiera bonusy; talent można brać wielokrotnie). */
function talentRanks(t) {
  const a = t?.system?.Advances ?? t?.system?.advances?.value;
  const n = Number(a);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Bonus z talentów w pensach: {bp, parts:[{key,name,bp}]}. Majętny: +1 zk × rangi. Przestępca: wg poziomu kariery × rangi. */
async function talentBonusBp(actor) {
  if (!game.settings.get(MODULE_ID, "talentBonuses") || !actor) return { bp: 0, parts: [] };
  let bp = 0; const parts = [];

  const wealthy = findTalent(actor, "wealthy");
  if (wealthy) {
    const r = talentRanks(wealthy);
    if (r > 0) { const w = r * 240; bp += w; parts.push({ key: "wealthy", name: wealthy.name, bp: w }); }
  }

  const criminal = findTalent(actor, "criminal");
  if (criminal) {
    const r = talentRanks(criminal);
    const lvl = Number(actor.system?.currentCareer?.system?.level?.value) || 0;
    const map = { 1: { coin: "b", dice: 2 }, 2: { coin: "s", dice: 1 }, 3: { coin: "s", dice: 2 }, 4: { coin: "g", dice: 1 } }[lvl];
    if (r > 0 && map) {
      if (map.coin === "g") {
        const amt = map.dice * r;                                     // złoto: bez rzutu (rangi × 1 zk)
        const cbp = amt * 240;
        bp += cbp; parts.push({ key: "criminal", name: criminal.name, bp: cbp, gold: amt });
      } else {
        const dice = map.dice * r;
        const total = (await new Roll(`${dice}d10`).evaluate()).total; // rzut Przestępcy (pokazujemy jak rzut dochodu)
        const cbp = total * (TIER_BP[map.coin] ?? 1);
        bp += cbp; parts.push({ key: "criminal", name: criminal.name, bp: cbp, dice, total, coin: map.coin });
      }
    }
  }
  return { bp, parts };
}

/* -------------------------------------------- */
/*  Wypłata zarobku (z sub-pensem)              */
/* -------------------------------------------- */
/** Wypłaca dokładną kwotę (w pensach), rozkładając na nominały OBECNE na karcie: zł (240), srebro (12), pens (1),
 *  ćwierćpens (0,25). Dokłada tylko monety z tego zarobku (reszta sakiewki nietknięta). Brak monet → natywny addMoneyTo. */
async function addIncomeToActor(actor, bpExact) {
  const money = (actor?.itemTypes?.money ?? actor?.itemTags?.money ?? []).map((m) => m.toObject());
  const byVal = (v) => money.find((m) => Number(m.system?.coinValue?.value) === v);

  let remainingQ = Math.max(0, Math.round((Number(bpExact) || 0) * 4)); // suma w ćwiartkach (0,25)
  const addByVal = {}; // coinValue → ile dodać
  for (const v of [240, 12, 1, 0.25]) {            // zachłannie od największej monety obecnej na karcie
    if (!byVal(v)) continue;
    const vq = v * 4;                              // wartość monety w ćwiartkach
    const n = Math.floor(remainingQ / vq);
    if (n > 0) { addByVal[v] = n; remainingQ -= n * vq; }
  }
  // reszta (gdy brak najmniejszej monety, np. ćwierćpensa) → dolej do mosiądzu, zaokrąglona
  if (remainingQ > 0 && byVal(1)) { addByVal[1] = (addByVal[1] || 0) + Math.round(remainingQ / 4); }

  const updates = [];
  for (const v of [240, 12, 1, 0.25]) {
    if (!addByVal[v]) continue;
    const item = byVal(v);
    updates.push({ _id: item._id, "system.quantity.value": (Number(item.system.quantity.value) || 0) + addByVal[v] });
  }
  if (!updates.length) { // postać nie ma żadnej monety → natywne (zaokrąglone do pensa)
    return actor.updateEmbeddedDocuments("Item", game.wfrp4e.market.addMoneyTo(actor, `${Math.round(bpExact)}b`));
  }
  return actor.updateEmbeddedDocuments("Item", updates);
}

/* -------------------------------------------- */
/*  Korekta wyniku testu (po natywnym)          */
/* -------------------------------------------- */
async function processIncome(test) {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  const income = test?.options?.income;
  if (!income) return;
  const tier = income.tier;
  const standing = income.standing;
  const sl = Number(test.result?.SL) || 0;
  const succeeded = test.result?.outcome === "success";
  const actor = test?.actor;

  // Bazowy rzut W PENSACH (przed współczynnikiem). Fallback: parse natywnego wyniku.
  let raw, rawBp;
  if (_lastIncome && _lastIncome.tier === tier) {
    raw = _lastIncome.raw; rawBp = _lastIncome.raw * (TIER_BP[tier] ?? 1);
  } else {
    const p = parseEarned(test.result?.earned);
    raw = p.amount; rawBp = p.amount * (TIER_BP[p.tier] ?? 1);
  }

  const factor = getFactor();
  const slf = getSLFactor(sl, succeeded); // null → tryb natywny
  const slMult = slf === null ? (succeeded ? 1 : sl > -6 ? 0.5 : 0) : slf;

  // Talenty (w pensach). PS ich NIE skaluje — tylko współczynnik. Wzór:
  //   bpFloat = (baza × PS + talenty) × współczynnik
  let talent = { bp: 0, parts: [] };
  try { talent = await talentBonusBp(actor); } catch (e) { console.error(`${MODULE_ID} | talenty`, e); }

  const bpFloat = (rawBp * slMult + talent.bp) * factor;
  let bp = Math.max(0, roundGran(bpFloat));
  const unit = granUnit();
  // minimum 1 jednostka (1 pens lub 0,25) tylko przy sukcesie (porażka może zejść do 0)
  if (game.settings.get(MODULE_ID, "minOneOnSuccess") && rawBp + talent.bp > 0 && succeeded && bp < unit) bp = unit;

  // Zapis wyniku — karta pokaże kwotę i przeciągany link.
  test.result.earned = `${bp}b`;
  test.result.incomeResult = bp > 0
    ? `${loc("INCOME.YouEarn")} ${moneyMain(bp, actor)}`
    : loc("INCOME.Failure");

  await postBreakdown(test, { tier, standing, raw, factor, sl, slf, slMult, bp, succeeded, talent, actor });
}

/* -------------------------------------------- */
/*  Podgląd obliczeń (szept/publicznie)         */
/* -------------------------------------------- */
async function postBreakdown(test, info) {
  const recips = whisperIds(test?.actor);
  if (recips === null) return; // wyłączone
  const { tier, standing, raw, factor, sl, slf, bp, succeeded, talent, actor } = info;
  const u = unitAbbr(tier);
  const m = Number(game.settings.get(MODULE_ID, "multiplier"));
  const d = Number(game.settings.get(MODULE_ID, "divisor"));
  const per = parseInt(game.wfrp4e?.config?.earningValues?.[tier]) || 0;
  const factorLabel = d === 1 ? `×${m}` : `×${m}/${d}`;
  const slSign = sl >= 0 ? "+" : "";
  const outcomeTag = succeeded ? loc("WIS.Breakdown.Success") : loc("WIS.Breakdown.Failure");

  const lines = [`<b>${loc("WIS.Breakdown.Title")}</b>`];

  // 1) Rzut (z jednostką skróconą); złoto bez rzutu
  if (tier === "g") lines.push(`${loc("WIS.Breakdown.Base")}: ${raw} gc (${loc("WIS.Breakdown.NoRoll")})`);
  else lines.push(`${loc("WIS.Breakdown.Roll")}: ${per * standing}k10 = ${raw} ${u}`);

  const hasTalent = talent && talent.bp > 0;

  // 2) PS
  if (slf === null) lines.push(`${loc("WIS.Breakdown.SL")} ${slSign}${sl} (${outcomeTag}): ${loc("WIS.Breakdown.Native")}`);
  else lines.push(`${loc("WIS.Breakdown.SL")} ${slSign}${sl} (${outcomeTag}): ×${fmt(slf)} → ${fmt(raw * slf)} ${u}`);

  // 3) Talenty — POD PS (PS ich nie skaluje, działa tylko współczynnik)
  if (hasTalent) {
    const detail = talent.parts.map((p) => {
      if (p.dice) return `${p.name} ${p.dice}k10 = ${p.total} ${unitAbbr(p.coin)}`; // Przestępca: rzut jak dochód
      if (p.gold) return `${p.name} +${p.gold} gc`;                                 // Przestępca lvl4 (złoto)
      return `${p.name} +${coinsToText(p.bp, actor)}`;                              // Majętny
    }).join(", ");
    lines.push(`${loc("WIS.Breakdown.Talents")}: ${detail}`);
  }

  // 4) Współczynnik (wartość bieżąca tylko bez talentów, tryb liniowy — jednostki spójne)
  if (slf !== null && !hasTalent) lines.push(`${loc("WIS.Breakdown.Factor")} ${factorLabel} → ${fmt(raw * slf * factor)} ${u}`);
  else lines.push(`${loc("WIS.Breakdown.Factor")} ${factorLabel}`);

  // 5) Wynik (pensy + skrót, z ćwierćpensem)
  lines.push(`<b>${loc("WIS.Breakdown.Result")}: ${moneyMain(bp, actor)}</b>`);

  const content = `<div class="wis-breakdown" style="font-size:0.95em">${lines.join("<br>")}</div>`;
  const data = { speaker: ChatMessage.getSpeaker({ actor: test?.actor }), content };
  if (recips.length) data.whisper = recips;
  await ChatMessage.create(data);
}

/* -------------------------------------------- */
/*  Rejestracja nakładek                        */
/* -------------------------------------------- */
let _wired = false;
Hooks.once("ready", () => {
  if (_wired) return;
  if (game.system?.id !== "wfrp4e") return;
  const market = game.wfrp4e?.market;
  const TestCls = game.wfrp4e?.rolls?.TestWFRP;
  if (!market || typeof market.rollIncome !== "function" || typeof TestCls?.prototype?.handleIncomeTest !== "function") {
    console.warn(`${MODULE_ID} | API systemu WFRP4e niedostępne — pomijam nakładki.`);
    return;
  }

  const useLW = typeof libWrapper !== "undefined" && game.modules.get("lib-wrapper")?.active;

  if (useLW) {
    libWrapper.register(MODULE_ID, "game.wfrp4e.market.rollIncome", async function (wrapped, ...args) {
      const res = await wrapped(...args);
      try { applyIncomeScaling(res); } catch (e) { console.error(`${MODULE_ID} | rollIncome wrapper błąd`, e); }
      return res;
    }, "WRAPPER");

    libWrapper.register(MODULE_ID, "game.wfrp4e.rolls.TestWFRP.prototype.handleIncomeTest", async function (wrapped, ...args) {
      await wrapped(...args); // natywne: rzut + baza + (natywne PS) + ustawienie wyniku
      try { await processIncome(this); } catch (e) { console.error(`${MODULE_ID} | processIncome błąd — wynik natywny`, e); }
    }, "WRAPPER");

    console.log(`${MODULE_ID} | nakładki przez lib-wrapper.`);
  } else {
    // Ręczny fallback (gdy lib-wrapper nieaktywny).
    if (!market.rollIncome.__wisWrapped) {
      const origRI = market.rollIncome.bind(market);
      const w = async function (...args) {
        const res = await origRI(...args);
        try { applyIncomeScaling(res); } catch (e) { console.error(`${MODULE_ID} | rollIncome wrapper błąd`, e); }
        return res;
      };
      w.__wisWrapped = true;
      market.rollIncome = w;
    }
    const proto = TestCls.prototype;
    if (!proto.handleIncomeTest.__wisWrapped) {
      const origHIT = proto.handleIncomeTest;
      const w = async function (...args) {
        await origHIT.apply(this, args);
        try { await processIncome(this); } catch (e) { console.error(`${MODULE_ID} | processIncome błąd — wynik natywny`, e); }
      };
      w.__wisWrapped = true;
      proto.handleIncomeTest = w;
    }
    console.warn(`${MODULE_ID} | lib-wrapper nieaktywny — nakładki ręczne.`);
  }

  _wired = true;
});

/* -------------------------------------------- */
/*  Przycisk „Zastosuj zarobek" na karcie czatu */
/* -------------------------------------------- */
/** Wartość liczbowa z napisu kwoty „25b" → 25 (0 gdy brak/niepoprawna). */
function incomeAmountValue(amtStr) {
  const n = parseFloat(amtStr);
  return Number.isFinite(n) ? n : 0;
}

/** Dodaje przycisk dodający zarobek na kartę z wynikiem (.money-drag) — wzorzec systemu (renderChatMessageHTML). */
function injectApplyButton(message, html) {
  if (!game.settings.get(MODULE_ID, "applyButton")) return;
  if (game.system?.id !== "wfrp4e") return;
  const drag = html.querySelector?.(".money-drag");
  if (!drag) return;
  if (html.querySelector(".wis-apply-income")) return; // już dodany
  if (incomeAmountValue(drag.dataset.amt) <= 0) return; // brak/zero — nie dodawaj (chroni też przed wyzerowaniem kasy)

  const actor = ChatMessage.getSpeakerActor?.(message.speaker) ?? game.actors.get(message.speaker?.actor);
  if (!actor?.isOwner) return; // tylko właściciel może dodać kasę

  const amt = drag.dataset.amt;
  const applied = !!message.getFlag(MODULE_ID, "applied");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "wis-apply-income";
  btn.style.cssText = "display:block;width:100%;margin-top:4px";
  const setLabel = (done) => {
    btn.innerHTML = done
      ? `<i class="fa-solid fa-check"></i> ${loc("WIS.ApplyIncome.Done")}`
      : `<i class="fa-solid fa-coins"></i> ${loc("WIS.ApplyIncome.Label")}`;
  };
  setLabel(applied);
  btn.disabled = applied;
  if (!applied) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await addIncomeToActor(actor, incomeAmountValue(amt)); // rozkład na zł/srebro/pens/ćwierć (lub natywne, gdy brak monet)
        setLabel(true);
        try { await message.setFlag(MODULE_ID, "applied", true); } catch (_) { /* brak uprawnień do flagi — wystarczy lokalnie */ }
        ui.notifications?.info(`${actor.name}: +${amt}`);
      } catch (e) {
        console.error(`${MODULE_ID} | dodawanie zarobku nie powiodło się`, e);
        btn.disabled = false;
        ui.notifications?.error(loc("WIS.ApplyIncome.Error"));
      }
    });
  }
  (drag.closest("b") ?? drag).insertAdjacentElement("afterend", btn);
}

Hooks.on("renderChatMessageHTML", (message, html) => {
  try { injectApplyButton(message, html); } catch (e) { console.error(`${MODULE_ID} | przycisk zarobku`, e); }
});
